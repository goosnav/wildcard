// The regression eval runner (Doc 06, RSK-02). Generates every prompt in
// corpus.jsonl through the SAME orchestrator + validator the server uses, then
// scores first-try success, overall success, latency, and a per-category
// breakdown. Writes a timestamped JSON report and exits non-zero if the overall
// pass rate falls below EVAL_MIN_PASS_RATE — so it can gate CI.
//
// Run (live, costs a few cents per case):
//   npm run eval
//   npm run eval -- --limit 5 --concurrency 2
// Offline smoke-test of the runner itself (no API, deterministic stub):
//   WC_PROVIDER=stub npm run eval

import "../server/src/env.js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateTool } from "../server/src/generate.js";
import { closeValidator } from "../server/src/validate.js";
import { createModel, activeProviderName } from "../server/src/provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  resolve(here, "../server/prompts/system.md"),
  "utf8"
);

interface Case {
  id: string;
  category: string;
  prompt: string;
}

interface CaseResult extends Case {
  ok: boolean;
  firstTry: boolean; // passed validation on turn 0 (no repair needed)
  turns: number;
  latencyMs: number;
  reason?: string;
}

function parseArgs(argv: string[]): { limit?: number; concurrency: number } {
  let limit: number | undefined;
  let concurrency = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i] === "--concurrency") concurrency = Number(argv[++i]);
  }
  return { limit, concurrency };
}

function loadCorpus(limit?: number): Case[] {
  const raw = readFileSync(resolve(here, "corpus.jsonl"), "utf8");
  const cases = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);
  return limit ? cases.slice(0, limit) : cases;
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run)
  );
  return results;
}

async function runCase(model: ReturnType<typeof createModel>, c: Case): Promise<CaseResult> {
  const started = Date.now();
  try {
    const result = await generateTool({ prompt: c.prompt, system: SYSTEM_PROMPT, model });
    return {
      ...c,
      ok: result.ok,
      firstTry: result.ok && result.turns === 0,
      turns: result.turns,
      latencyMs: Date.now() - started,
      reason: result.ok ? undefined : result.reason,
    };
  } catch (e) {
    return {
      ...c,
      ok: false,
      firstTry: false,
      turns: -1,
      latencyMs: Date.now() - started,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const { limit, concurrency } = parseArgs(process.argv.slice(2));
  const cases = loadCorpus(limit);
  const provider = activeProviderName();
  const model = createModel();

  console.log(
    `eval · provider=${provider} model=${process.env.WC_MODEL ?? "(default)"} ` +
      `cases=${cases.length} concurrency=${concurrency}\n`
  );

  let done = 0;
  const results = await pool(cases, concurrency, async (c) => {
    const r = await runCase(model, c);
    done++;
    const mark = r.ok ? (r.firstTry ? "✓" : "✓~") : "✗";
    console.log(
      `[${String(done).padStart(2)}/${cases.length}] ${mark} ${r.id} ` +
        `(${r.turns >= 0 ? r.turns + " turns" : "error"}, ${r.latencyMs}ms)` +
        (r.ok ? "" : `\n      ${r.reason ?? ""}`)
    );
    return r;
  });

  await closeValidator();

  // --- aggregate ---
  const n = results.length;
  const passed = results.filter((r) => r.ok).length;
  const firstTry = results.filter((r) => r.firstTry).length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / (n || 1));

  const byCategory = new Map<string, { n: number; passed: number; firstTry: number }>();
  for (const r of results) {
    const g = byCategory.get(r.category) ?? { n: 0, passed: 0, firstTry: 0 };
    g.n++;
    if (r.ok) g.passed++;
    if (r.firstTry) g.firstTry++;
    byCategory.set(r.category, g);
  }

  console.log("\n── summary ──────────────────────────────");
  console.log(`overall pass : ${passed}/${n}  (${pct(passed, n)})`);
  console.log(`first-try    : ${firstTry}/${n}  (${pct(firstTry, n)})`);
  console.log(`latency      : avg ${avgLatency}ms · p50 ${percentile(latencies, 50)}ms · p95 ${percentile(latencies, 95)}ms`);
  console.log("\nby category:");
  for (const [cat, g] of [...byCategory].sort()) {
    console.log(`  ${cat.padEnd(12)} pass ${pct(g.passed, g.n).padStart(4)}  first-try ${pct(g.firstTry, g.n).padStart(4)}  (n=${g.n})`);
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ✗ ${f.id} — ${f.reason ?? "unknown"}`);
  }

  // --- report ---
  const reportsDir = resolve(here, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = {
    runAt: new Date().toISOString(),
    provider,
    model: process.env.WC_MODEL ?? null,
    totals: {
      n,
      passed,
      passRate: n ? passed / n : 0,
      firstTry,
      firstTryRate: n ? firstTry / n : 0,
      avgLatencyMs: avgLatency,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
    },
    byCategory: Object.fromEntries(byCategory),
    cases: results,
  };
  const reportPath = resolve(reportsDir, `eval-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${reportPath}`);

  // --- gate ---
  const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? "0.7");
  const passRate = n ? passed / n : 0;
  if (passRate < minPassRate) {
    console.error(
      `\nGATE FAILED: pass rate ${(passRate * 100).toFixed(0)}% < ` +
        `threshold ${(minPassRate * 100).toFixed(0)}%`
    );
    process.exit(1);
  }
  console.log(`\nGATE PASSED: ${(passRate * 100).toFixed(0)}% ≥ ${(minPassRate * 100).toFixed(0)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
