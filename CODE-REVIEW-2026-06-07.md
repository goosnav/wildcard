# Wild Card Code Review — 2026-06-07

Reviewer: opencode
Scope: `server/src/`, `runtime/src/`, `host-web/src/`, `eval/run.ts`

---

## BUGS

### B1 — Quota-count race condition on concurrent builds

`server/src/server.ts:205` reads `user.buildsUsed` at request time, increments it
by 1, and writes the result. Two concurrent requests read the same value, both
write `buildsUsed=3`, and one build escapes counting.

```typescript
// server.ts:205 — stale read
const updated = await updateUser(user.id, { buildsUsed: user.buildsUsed + 1 });
```

Neither `json-backend.ts` nor `pg-backend.ts` use an atomic delta — they both
write a literal value. Fix: pass a delta `{ buildsUsed: user.buildsUsed + 1 }`
and have the backend apply an atomic SQL `SET builds_used = builds_used + 1`
(PG) or mutex (JSON). Impact: revenue leak (free users can build more times
than permitted). Severity: **high** for paid tier.

### B2 — `validate.ts` ready-signal check is dead code

`server/src/validate.ts:96` sets `ready = !!frame`, but `frame` (from `mounted.frame`)
is always the `HTMLIFrameElement` that `mountTool` just created — never nullish.
The `errs.push("Tool frame failed to mount")` branch is unreachable.

```typescript
// validate.ts:93-97
const frame = mounted.frame as HTMLIFrameElement;
await new Promise((r) => setTimeout(r, settleMs));
ready = !!frame; // always true
if (!ready) errs.push("Tool frame failed to mount"); // dead
```

Impact: if `mountTool` fails to inject the srcdoc (e.g. stage div not in DOM),
the error goes uncaught by this check. Severity: **low** (the surrounding
try/catch and `onError` callback catch most failure modes).

### B3 — `validate.ts` singleton browser never recovered on crash

`server/src/validate.ts:23-26` caches a single `Browser` instance for the
process lifetime. If the Chromium process crashes (OOM, segfault), the promise
resolves to a dead browser and every subsequent `validate()` call fails with a
connection error. `closeValidator()` exists but is only called by `eval/run.ts`
at end-of-run — the server never calls it.

```typescript
// validate.ts:21-27 — no recovery path
let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ channel: "chromium" });
  return browserPromise;
}
```

Fix: add a health-check wrapper that resets the promise on failure, or pool
browsers. Severity: **medium** (production server stops validating until
restart).

### B4 — Magic-link token in URL, no referrer-policy

`server/src/auth.ts:33` appends a raw magic token as a URL query parameter.
The site has no `Referrer-Policy` header set, so the token could leak via the
`Referer` header if the page loads external resources or the user clicks an
external link.

```typescript
// auth.ts:33
const link = `${APP_URL}/?token=${mt.token}`;
```

The SPA scrubs the param from `window.history` (`App.tsx:63-66`) but the referrer
leak happens before JS runs. Fix: set `<meta name="referrer" content="no-referrer">`
or `Referrer-Policy: no-referrer` on the SPA. Severity: **medium**.

---

## ARCHITECTURAL

### A1 — Chromium browser lifecycle not managed by server

The server imports `validate.ts` which lazily starts a headless Chromium browser
on first `generate()` call. There is no:
- Health-check or recovery from browser crash (see B3)
- Graceful shutdown hook (`process.on("SIGTERM", ...)`) to close the browser
- Configurable launch args (sandbox, memory limits)
- Concurrency limit on browser usage

Impact: the server has an unmanaged subprocess that can leak. For a single-
container v1 deploy this is tolerable but fragile. Severity: **medium**.

### A2 — Rate limiter and build ceiling are in-process only

`server/src/guard.ts` stores counters in a local `Map<string, ...>` and a local
`number`. Horizontal scaling (multiple Node processes) will give each process
its own counters, allowing N× the intended rate.

The `guard.ts` comment acknowledges this ("Horizontal scaling later needs a
shared store"). For v1 single-container: acceptable. But the global
`buildCeiling` in particular is the COGS backstop — a multi-process deploy
without fixing this would blow the budget.

### A3 — `validate.ts` uses Playwright's `channel: "chromium"` — not available in all envs

`server/src/validate.ts:25` requests `channel: "chromium"` which requires the
full Chrome install (not just `playwright`'s bundled chromium). In Docker
(slim images) or CI without Chrome installed, this will fail.

```typescript
chromium.launch({ channel: "chromium" });
```

The DEPLOY.md or Dockerfile should document the Chrome dependency. Severity:
**low** (documented gap, not a code bug).

### A4 — `WC_WEB_DIR` path is relative to CWD, not script location

`server/src/server.ts:267` uses `process.env.WC_WEB_DIR` as-is. In Docker the
CWD is predictable, but running the server from a different directory breaks
static file serving.

### A5 — SSE parser is not a full SSE implementation

`host-web/src/api.ts:176-192` parses SSE events with a simple `\n\n` split.
It does not handle:
- `id:` fields (event IDs for reconnection)
- `retry:` fields (reconnection timing)
- Multi-line `data:` blocks joined with newlines (they are joined, but without
  the trailing newline the spec requires)

For the current structured output (single connection, no reconnection) this is
sufficient. But if SSE output is ever consumed by a third-party client, the
parser will fail.

---

## DESIGN / SECURITY

### S1 — `postMessage` origin not verified in host

`runtime/src/host.ts` — the `message` event handler checks for `__wc__` channel
but does not verify `event.source` or `event.origin`. While the sandboxed iframe
has `null` origin (making origin checks difficult), there is no guard against
other windows (popups, other iframes on the page) injecting fake WC messages.

For the current architecture (single SPA, no third-party content), this is
acceptable. If the host page ever embeds external content, this becomes
exploitable.

### S2 — `any` type on route handler context parameters

`server/src/server.ts:89,98,122` uses `c: any` for the Hono context parameter
in `requireUser`, `rateLimit`, and `requireAdmin`. This violates the AGENTS.md
invariant "No `any` except at the postMessage boundary".

```typescript
async function requireUser(c: any): Promise<User | Response> {
```

Fix: import `Context` from `hono`. Severity: **low** (code quality, not a
runtime bug).

### S3 — `pg-backend.ts` disables TLS certificate verification

`server/src/store/pg-backend.ts:91` sets `rejectUnauthorized: false`, accepting
any self-signed certificate. This is necessary for some hosted Postgres providers
(Supabase, Neon) but means MITM attacks on the database connection are not
detected.

The comment "allow self-signed chains" explains the intent. Ideally, use the
provider's CA cert instead. Severity: **medium**.

### S4 — CORS `origin: *` on all API routes

`server/src/server.ts:52`:
```typescript
app.use("/v1/*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));
```

When `WC_WEB_DIR` is set, the SPA and API share an origin, so CORS is
unnecessary. The `*` origin is harmless in that case but means the API is
callable from any origin in dev/debugging. If the API is ever exposed without
the SPA, this must be locked down.

### S5 — Emoji icon in `stub-model.ts` can corrupt XML

`server/src/stub-model.ts:20` hard-codes `icon="📝"` in an XML attribute. HTML
attribute values are CDATA, so the emoji renders correctly. But if the XML
parser ever changes (e.g., to a true XML parser), multi-byte characters could
cause issues. Low severity.

### S6 — `AdminDashboard` has no auto-refresh or stale-data indication

`host-web/src/components/AdminDashboard.tsx` fetches data once on mount and
only refreshes on button click. For an operational dashboard this is fine, but
it should indicate when data might be stale.

### S7 — No `console.error`/`console.warn` suppression in validator

`server/src/validate.ts:63-65` captures all `console.error` calls from the
sandboxed page and treats them as validation errors. Some third-party code or
browser extensions could inject console.error calls unrelated to the tool,
causing false-positive validation failures.

---

## BEST PRACTICE / CODE QUALITY

### Q1 — `__name` polyfill is fragile

`server/src/validate.ts:72-74`:
```typescript
await page.addScriptTag({
  content: "globalThis.__name = globalThis.__name || ((target) => target);",
});
```

This works around esbuild's `__name` helper that `tsx` injects. If the
bundler or tsx version changes, the helper name might change (`__name` → `__name2`),
causing the polyfill to miss. Consider using `keepNames: false` in tsx/esbuild
config instead.

### Q2 — `idbStorageForTool.keys()` enumerates ALL KV keys

`host-web/src/idb.ts:101` calls `s.getAllKeys()` which returns every key in
the KV store across all tools, then filters by prefix. As the number of tools
grows, this becomes O(n) in total keys. For v1 (typically <50 tools) this is
fine; for scaling, a ranged IDB query would be more efficient.

### Q3 — `ToolRunner.tsx` creates a new Blob + URL for every export

`host-web/src/components/ToolRunner.tsx:39` creates a `Blob` and object URL on
every export button click. The object URL is revoked after download, but Blob
memory is freed only when the last reference is dropped. For frequent exports
of large data, this could accumulate memory pressure.

### Q4 — `context.json` sample data has unused `stripeSubscriptionId` field

(User mentioned this earlier — not a bug, just a now-unnecessary field on the
free-tier user seed data. Low priority.)

### Q5 — `stub-model.ts` escapeHtml handles only 4 characters

`server/src/stub-model.ts:9-15` only escapes `&`, `<`, `>`, `"`. If the model
output is ever interpolated into an attribute value that uses single quotes
(not the case currently), `'` would not be escaped. For the current template
(which always uses double-quoted attributes), this is sufficient.

### Q6 — `FixedWindow.maybeSweep` uses strict equality for sweep counter

`server/src/guard.ts:57`:
```typescript
if (++this.sinceSweep < 256) return;
```

If `sinceSweep` wraps past `Number.MAX_SAFE_INTEGER` (which would take
thousands of years of uptime), the sweep would stop. Essentially impossible.
Nit.

### Q7 — `PeriodCeiling.release()` can decrement below zero (defensive)

`server/src/guard.ts:98`:
```typescript
if (this.enabled && this.used > 0) this.used--;
```

If `release()` is called more times than `tryReserve()`, `used` is guarded at
0. This is defensive and correct.

---

## TESTING GAPS

### T1 — No test for concurrent quota race (B1)

No existing test exercises parallel `generateTool` calls that would expose the
quota race. The `Model` interface is injectable, so this is testable with
`stubModel`.

### T2 — No test for browser crash recovery (B3)

No test validates that `validate()` re-launches the browser when the current
instance dies. (Hard to test without mocking, but a simulator could close the
browser between calls.)

### T3 — No test for `consumeMagicToken` expiry edge cases

Neither backend has a test verifying that an expired token returns null, or
that expired tokens are pruned during consume (both backends do this, but
without coverage).

### T4 — No integration test for the full `generate → validate → client` pipeline

`eval/run.ts` tests generation-to-validation but skips the HTTP layer, auth,
quota, and the client-side IndexedDB persistence. An e2e test using the running
server + Playwright would catch route-level errors (e.g., SSE format mismatch,
CORS, auth flow).

---

## SUMMARY

| Severity | Count |
|----------|-------|
| High     | 1     |
| Medium   | 5     |
| Low      | 12    |
| Note     | 7     |

The codebase is remarkably clean for a solo-AI-assisted build. The one high-
severity item (B1 — quota race) could cause revenue loss and should be fixed
before launch. Medium items (B3/B4/S3, A1) are production-readiness concerns
that won't block a dev deploy but should be addressed before public launch.
