// CMP-03 — the Tier-1 generation orchestrator. Single model call + a bounded,
// validator-gated repair loop. The repair loop is gated by the CONCRETE
// pass/fail from CMP-05, never the model's self-assessment — that is the
// reliability backbone (REQ-GEN-002/004/008).

import type { Bundle } from "@wildcard/runtime";
import { parseBundle, ContractError } from "./contract.js";
import { validate, type ValidationResult } from "./validate.js";
import { screenGeneratedSource } from "./safety.js";

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
  /** When set, this is an EDIT of an existing tool (REQ-EDIT-003): `prompt` is
   *  the change request and the model is given the current source as context.
   *  The result reuses the same manifest id so it overwrites the same tool. */
  editBase?: Bundle;
}

/** Compose the turn-0 user message. For an edit, hand the model the full current
 *  source and ask for the complete updated tool (not a diff) so packaging stays
 *  deterministic. */
function buildUserMessage(prompt: string, editBase?: Bundle): string {
  if (!editBase) return prompt;
  const files = Object.entries(editBase.files)
    .map(([name, content]) => `\`\`\`file:${name}\n${content}\n\`\`\``)
    .join("\n");
  return (
    `You are EDITING an existing tool named "${editBase.manifest.name}". ` +
    `Here is its current source:\n\n${files}\n\n` +
    `Apply this change: ${prompt}\n\n` +
    `Return the COMPLETE updated <wc-app> block (every file in full, not a diff), ` +
    `keeping everything that still works and changing only what the request needs.`
  );
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
    editBase,
  } = opts;

  const userMessage = buildUserMessage(prompt, editBase);
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
        user: userMessage,
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
      // On an edit, keep the original tool's id so it overwrites in place.
      bundle = parseBundle(raw, editBase?.manifest.id);
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
      // Output post-screen (CMP-12 / web-gate G1): never ship a bundle whose
      // source trips the unambiguous-malware blocklist, even if it ran cleanly.
      const screen = screenGeneratedSource(bundle.files);
      if (!screen.allowed) {
        const reason = screen.message ?? "I can't ship that one.";
        onEvent({ type: "failed", reason });
        return { ok: false, reason, turns: turn };
      }
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
