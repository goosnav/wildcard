// CMP-03 — the Tier-1 generation orchestrator. Single model call + a bounded,
// validator-gated repair loop. The repair loop is gated by the CONCRETE
// pass/fail from CMP-05, never the model's self-assessment — that is the
// reliability backbone (REQ-GEN-002/004/008).

import type { Bundle } from "@wildcard/runtime";
import { parseBundle, ContractError } from "./contract.js";
import { validate, type ValidationResult } from "./validate.js";

/** A model is anything that can turn messages into a text completion. Injectable
 *  so the repair loop can be tested with a fake model (no API key needed). */
export interface Model {
  complete(input: {
    system: string;
    user: string;
    /** Prior assistant output + validation errors, for repair turns. */
    repair?: { lastOutput: string; errors: string[] };
  }): Promise<string>;
}

export type GenEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; turn: number }
  | { type: "validated"; pass: boolean; errors: string[] }
  | { type: "done"; bundle: Bundle }
  | { type: "failed"; reason: string };

export interface GenerateResult {
  ok: boolean;
  bundle?: Bundle;
  /** Honest, non-technical explanation when we cannot ship a working tool. */
  reason?: string;
  turns: number;
}

export interface GenerateOptions {
  prompt: string;
  system: string;
  model: Model;
  maxRepairTurns?: number; // default 3 (REQ-GEN-004)
  onEvent?: (e: GenEvent) => void;
  validateFn?: (b: Bundle) => Promise<ValidationResult>;
}

export async function generateTool(
  opts: GenerateOptions
): Promise<GenerateResult> {
  const {
    prompt,
    system,
    model,
    maxRepairTurns = 3,
    onEvent = () => {},
    validateFn = validate,
  } = opts;

  let lastOutput = "";
  let lastErrors: string[] = [];

  for (let turn = 0; turn <= maxRepairTurns; turn++) {
    onEvent({ type: "attempt", turn });
    onEvent({
      type: "status",
      message: turn === 0 ? "Building your tool…" : "Fixing a couple of things…",
    });

    let raw: string;
    try {
      raw = await model.complete({
        system,
        user: prompt,
        repair: turn > 0 ? { lastOutput, errors: lastErrors } : undefined,
      });
    } catch (e) {
      return {
        ok: false,
        reason: "The tool builder is temporarily unavailable. Please try again.",
        turns: turn,
      };
    }
    lastOutput = raw;

    let bundle: Bundle;
    try {
      bundle = parseBundle(raw);
    } catch (e) {
      if (e instanceof ContractError) {
        lastErrors = [e.message];
        onEvent({ type: "validated", pass: false, errors: lastErrors });
        continue; // malformed output -> treat as a repairable failure
      }
      throw e;
    }

    const result = await validateFn(bundle);
    onEvent({ type: "validated", pass: result.pass, errors: result.errors });

    if (result.pass) {
      onEvent({ type: "done", bundle });
      return { ok: true, bundle, turns: turn };
    }
    lastErrors = result.errors;
  }

  // Never hand over a dead icon: explain honestly and offer a smaller version.
  const reason =
    "I couldn't get this one working reliably. Want to try a simpler version — " +
    "for example, fewer features or a single screen?";
  onEvent({ type: "failed", reason });
  return { ok: false, reason, turns: maxRepairTurns + 1 };
}
