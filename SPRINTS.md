# SPRINTS

**The 2-week iteration log.** Phases (Doc 05) are milestones; sprints are calendar. Each entry: dates, theme, items done, items carried, eval results, notes.

For the live state of each requirement, see [`STATUS.md`](STATUS.md). For the long-term plan, see [`ROADMAP.md`](ROADMAP.md). For the v1.1 vs v1.0 framing, see [`dev/10_WEB_SLICE_BASELINE_v1.1.txt`](dev/10_WEB_SLICE_BASELINE_v1.1.txt).

Sprint length: 2 weeks. Backfilled from git log where the history supports it; future sprints start with a blank template.

---

## Sprint 1 — 2026-06-06 to 2026-06-07 — "Walking skeleton + auth/quota/paywall + eval harness"

**Theme:** Stand up the entire v1.1 spine end-to-end and prove it: runtime isolation, Tier-1 generation with a validator-gated repair loop, a React + Vite PWA shell, magic-link auth, free-build quota, Stripe paywall, an eval harness that proves quality, and a single-container deploy.

### Done

- [x] **Runtime SDK + sandbox iframe + strict CSP** (`runtime/src/sdk.ts`, `host.ts`, `memory-storage.ts`, `protocol.ts`) → CMP-02, REQ-RUN-001/002/003/004/005
- [x] **Playwright test suite for the runtime** (`runtime/test/runtime.spec.ts`) → REQ-RUN-001/002/003/005/007
- [x] **Tier-1 generation orchestrator + bounded repair loop (default N=3)** (`server/src/generate.ts`, `validate.ts`, `contract.ts`) → CMP-03 + CMP-05, REQ-GEN-001/002/004/010
- [x] **Validator (CMP-05) loads the same `runtime/dist/runtime.global.js` the device runs** → AGENTS.md invariant 9, REQ-GEN-010
- [x] **Model gateway: OpenRouter (with 429 retry), Anthropic, deterministic stub** (`server/src/{provider,openrouter-model,anthropic-model,stub-model}.ts`) → CMP-04, REQ-SEC-001
- [x] **Server-proxied data provider catalog (weather, currency)** (`server/src/providers.ts`) → REQ-RUN-005
- [x] **SSE `/v1/generate` streaming + build view** (`server/src/server.ts`, `host-web/src/components/BuildView.tsx`) → REQ-GEN-003
- [x] **Magic-link auth (Resend)** (`server/src/{auth,email}.ts`) → CMP-10, REQ-ACCT-001/003
- [x] **Server-enforced free-build quota** (`server/src/quota.ts`) → CMP-09, REQ-PAY-001/003
- [x] **Stripe paywall + signed webhook** (`server/src/{stripe,billing}.ts`) → CMP-09, REQ-PAY-004
- [x] **JSON or Postgres store with auto-schema** (`server/src/store.ts`, `server/src/store/{json-backend,pg-backend}.ts`) → CMP-11 partial, REQ-DATA-001
- [x] **Allow-listed admin dashboard** (`server/src/admin.ts`, `host-web/src/components/AdminDashboard.tsx`) → CMP-13, REQ-NFR-003 partial
- [x] **PWA shell: prompt bar, build view, home grid, sandboxed tool runner, source view (read-only), paywall, sign-in** (`host-web/src/`) → CMP-01, REQ-HOME-001/005/006, REQ-EDIT-001, REQ-RUN-001
- [x] **27-prompt eval corpus + scoring runner with non-zero exit on gate failure** (`eval/corpus.jsonl`, `eval/run.ts`) → Doc 06 §6.2, RSK-02
- [x] **Server tests (Vitest): quota + repair-loop/contract + openrouter 429 + providers** (`server/test/`) → REQ-GEN-002/004, REQ-PAY-001/003, REQ-RUN-005
- [x] **Single-container `server/Dockerfile` + `DEPLOY.md`** → CMP-03, CMP-04
- [x] **OpenRouter 429 retry** + `.env.example` + `README.md` refresh → REQ-NFR-001
- [x] **Documentation set: `AGENTS.md`, `README.md`, `DEPLOY.md`, `eval/README.md`, `host-web/README.md`, `dev/00..09`, `dev/10`** (added in this pass)

### Carried

- [ ] **`/v1/manifest` content manifest endpoint** (Doc 04 §4.7; REQ-PLT-001 C5) → ROADMAP.md, CMP-12
- [ ] **`/v1/reports` moderation endpoint** (REQ-PRIV-002) → ROADMAP.md, CMP-12
- [ ] **CMP-12 input pre-screen + output post-screen** (REQ-GEN-007) → ROADMAP.md
- [ ] **Privacy Policy + ToS published** (OQ-02, REQ-PRIV-003) → ROADMAP.md
- [ ] **In-app account + data delete** (REQ-ACCT-004, REQ-DATA-004) → ROADMAP.md
- [ ] **Edit-with-AI versioning + revert** (REQ-GEN-006) → ROADMAP.md
- [ ] **Editable source view + "Run" that re-validates** (REQ-EDIT-002/003/004) → ROADMAP.md
- [ ] **Home grid long-press menu, drag-reorder, folders** (REQ-HOME-002/003/004) → ROADMAP.md
- [ ] **Per-user rate-limit + token-budget middleware** (REQ-SEC-003, REQ-NFR-006) → ROADMAP.md
- [ ] **Eval corpus grown to ≥85 (mid-step) and ≥200 (v1.0 target)** (Doc 06 §6.2) → ROADMAP.md
- [ ] **Default `EVAL_MIN_PASS_RATE` raised to 0.85** (currently 0.7) → ROADMAP.md
- [ ] **Cheapest-model classifier + routing** (REQ-GEN-009) → ROADMAP.md
- [ ] **Tier-2 agentic builds (CMP-06)** — v1.0+
- [ ] **iOS / Android native** — v1.0+
- [ ] **Cross-device encrypted sync (CMP-11)** — v1.0+

### Eval

- Stub provider, 27 prompts: **27/27 pass, 27/27 first-try, p50 ~1.2s, p95 ~2.8s** (`eval/reports/eval-2026-06-07T13-59-53-462Z.json`).
- Live provider (OpenRouter Sonnet), 27 prompts: **~92% first-try, above the 85% target** (per `README.md`).
- Default gate: `EVAL_MIN_PASS_RATE=0.7`. Target gate: **0.85** (Doc 06 §6.2; raise when the corpus is bigger — see ROADMAP.md).

### Notes

- The web-first pivot was made before Sprint 1 (Doc 07 §7.5). The P0 store submission spike (M0) is N/A for v1.1.
- The 27-prompt corpus is a starter set: calculators, timers, generators, trackers, notes, lists, utility, and data lookups. Adding the "hard" / "disallowed" / "prompt-injection" bands is ROADMAP.md.
- The README's "Status" section (and the v1.1 overlay, and STATUS.md, and ROADMAP.md, and this file) are part of a documentation pass that landed with the eval harness and the OpenRouter 429 retry. Treat them as the new single source of truth for "where are we."

---

## Sprint 2 — TBD

**Theme:** TBD. Pick from the ROADMAP.md v1.1 next-up list. Likely candidate: "Pre-launch blockers" (Privacy Policy + ToS, `/v1/manifest`, `/v1/reports`, CMP-12 input/output screens, account delete, key rotation, OQ-03 model price re-verify).

### Done

### Carried

### Eval

### Notes

---

## How to start a new sprint entry

Copy the Sprint 2 template, fill in the dates, set a theme, and add to this file. Each entry should answer: "what did we ship, what did we not, what did the eval say, what should the next reader know."

Update STATUS.md at the same time if a requirement status flipped during the sprint. Update ROADMAP.md if items moved between done and carried.
