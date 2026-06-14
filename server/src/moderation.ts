// In-memory moderation telemetry for the admin /v1/reports view. Counts safety
// refusals (input pre-screen and output post-screen) since process start, broken
// down by category. This is intentionally lightweight — a durable moderation
// queue with per-event records would need a table; that's deferred. Counters
// reset on restart, which is fine for an at-a-glance operational signal.

export type RefusalStage = "input" | "output";

interface ModerationState {
  startedAt: number;
  inputRefusals: number;
  outputRefusals: number;
  byCategory: Record<string, number>;
  lastRefusalAt: number | null;
}

const state: ModerationState = {
  startedAt: Date.now(),
  inputRefusals: 0,
  outputRefusals: 0,
  byCategory: {},
  lastRefusalAt: null,
};

/** Record a safety refusal. `category` is the safety category (e.g. "malware"). */
export function recordRefusal(stage: RefusalStage, category: string, now = Date.now()): void {
  if (stage === "input") state.inputRefusals++;
  else state.outputRefusals++;
  state.byCategory[category] = (state.byCategory[category] ?? 0) + 1;
  state.lastRefusalAt = now;
}

export interface ModerationReport {
  since: number; // process start (epoch ms)
  inputRefusals: number;
  outputRefusals: number;
  totalRefusals: number;
  byCategory: Record<string, number>;
  lastRefusalAt: number | null;
}

export function moderationReport(): ModerationReport {
  return {
    since: state.startedAt,
    inputRefusals: state.inputRefusals,
    outputRefusals: state.outputRefusals,
    totalRefusals: state.inputRefusals + state.outputRefusals,
    byCategory: { ...state.byCategory },
    lastRefusalAt: state.lastRefusalAt,
  };
}
