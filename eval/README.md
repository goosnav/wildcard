# eval — the regression quality backbone (Doc 06, RSK-02)

A versioned corpus of representative prompts plus a runner that generates each
through the **same** orchestrator + validator the server uses, then scores
first-try success, overall success, latency, and a per-category breakdown.

Every real production failure should become a permanent case here.

**Progress toward the v1.0 target:** 27 / ≥200 prompts in the corpus (Doc 06
§6.2). The corpus-growth plan and the eval-gate tightening are in
[`ROADMAP.md`](../ROADMAP.md). The live eval headline and the latest report
are in [`STATUS.md`](../STATUS.md).

## Files

- `corpus.jsonl` — one case per line: `{ "id", "category", "prompt" }`. Tracked
  in git; grow it whenever you find a prompt that should keep working.
- `run.ts` — the runner. Generates each case, scores it, writes a JSON report to
  `reports/` (gitignored), and exits non-zero if the overall pass rate drops
  below the gate threshold (so it can fail CI).

## Running

```bash
# Live, through the configured provider (OpenRouter/Anthropic from .env).
# Costs a few cents per case.
npm run eval

# A subset / different concurrency:
npm run eval -- --limit 6 --concurrency 2

# Offline plumbing check — deterministic stub model, no API, no cost.
# (The stub returns a fixed tool, so every case trivially passes; use it to
#  verify the runner itself, not to measure quality.)
WC_PROVIDER=stub npm run eval
```

## Gate

The runner exits non-zero when `passRate < EVAL_MIN_PASS_RATE` (default `0.7`).
The Doc 05 / §7 target for the live corpus is **≥ 85%** first-try success; raise
the threshold as the prompt + corpus mature:

```bash
EVAL_MIN_PASS_RATE=0.85 npm run eval
```

## Report shape

`reports/eval-<timestamp>.json` records `runAt`, `provider`, `model`, aggregate
`totals` (pass/first-try rates, avg/p50/p95 latency), a `byCategory` breakdown,
and the full per-`case` results (including the honest failure `reason` for any
case that didn't ship). Diff two reports to see whether a prompt/model change
regressed the corpus.
