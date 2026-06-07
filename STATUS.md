# STATUS

**The live source of truth for where Wild Card is in the program.** Edit this
file when a requirement's status changes, an open question moves, or the eval
gate moves. For the static framing, see [`dev/10_WEB_SLICE_BASELINE_v1.1.txt`](dev/10_WEB_SLICE_BASELINE_v1.1.txt) (the "what is v1.1 vs v1.0" overlay). For next-up work, see [`ROADMAP.md`](ROADMAP.md). For iteration history, see [`SPRINTS.md`](SPRINTS.md). For store-readiness, see [`COMPLIANCE.md`](COMPLIANCE.md).

Last updated: 2026-06-07.

---

## You are here

The **v1.1 web slice is built and deployable.** The spine runs end-to-end: runtime isolation in a sandboxed iframe, Tier-1 generation with a validator-gated repair loop, a React + Vite PWA shell, local-first tool storage, magic-link accounts, a server-enforced free-build quota, Stripe paywall, allow-listed admin dashboard, and a regression eval harness. Live first-try success on the 27-prompt starter corpus is ~92% (above the 85% target). A solo-deployable single-container `server/Dockerfile` exists.

**What's not done yet:** see the Phase table below, the REQ → CMP → test matrix further down, and the OQ status section near the bottom. The pre-public-launch gap is mainly P2 polish (home grid long-press + drag + folders, editable source view, edit-with-AI versioning), CMP-12 (moderation + input/output safety), the `/v1/manifest` and `/v1/reports` endpoints, the Privacy Policy / ToS, and bringing the eval corpus up from 27 to ≥200 prompts.

---

## Phase status (Doc 05 §5.4)

| Phase | Goal (Doc 05) | v1.1 status | Notes |
|---|---|---|---|
| **P0** Discovery, design, de-risk | Doc 01/02 locked; design; store submission spike | **Done, with web-first pivot** | M0 store-spike N/A — web launch sidesteps App Review per Doc 07 §7.5. The de-risking pivot is the choice to ship web first. |
| **P1** Walking skeleton | Auth-light, `/generate` → validate → preview → keep → run, minimal home grid | **Done** | First internal "wow" demo: prompt → keep → run on a real browser. |
| **P2** iOS feature-complete + money + compliance | Home grid with folders/drag/long-press; source view + edit; edit-with-AI with versioning; paywall; manifest; eval harness v1 | **Partial — money done; polish + manifest + versioning pending** | Money (Stripe paywall, webhook, quota) is shipped. Home grid has launch+delete only; no drag/folders/long-press. Source view is read-only. No `/v1/manifest` endpoint. No edit-with-AI versioning. Eval harness exists but is below the 200-prompt target. |
| **P3** Android + Tier-2 + eval hardening | Android build + richer consent-gated bridge; Tier-2 agentic; eval suite ≥200 prompts gating CI; cost dashboards | **Not started** | Deferred to v1.0+. |
| **P4** Beta hardening, review cycles, launch | External pentest + fixes; perf + a11y pass; store submissions and review back-and-forth; staged rollout | **Not started (the v1.1 web launch is the equivalent for the web channel)** | See `DEPLOY.md`. iOS / Play submission is v1.0+. |
| **M5** Post-launch | KPI dashboards live; first paying cohort; weekly eval + cost review cadence | **Not started** | |

---

## REQ → CMP → test matrix (live traceability)

This is the source of truth the bible promises (Doc 00 §0.3 "traceability runs through all levels"). The v1.0 IDs (REQ-*, CMP-*) are stable. The v1.1 status column reconciles the claim to the code; the **Implemented in** column points at the file or test that backs each shipped/partial row. **Update this table on every PR that touches a requirement.**

Status: `shipped` = working in v1.1 with a test or demonstrable flow · `partial` = partly working, gap tracked in ROADMAP.md · `deferred` = v1.0+ · `n/a-web` = does not apply to a web-only launch · `out-of-scope` = not in v1.0 either (Doc 01 §7).

### Generation (REQ-GEN-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-GEN-001 ≥85% first-try | M | shipped | CMP-03 + CMP-05 | `server/src/generate.ts`, `eval/run.ts`, `eval/corpus.jsonl` | `eval/reports/eval-*.json` (live ~92%) |
| REQ-GEN-002 validator-gated delivery | M | shipped | CMP-03 + CMP-05 | `server/src/generate.ts` (repair loop) | `server/test/generate.test.ts` |
| REQ-GEN-003 live preview + Keep/Discard | M | shipped | CMP-01 + CMP-03 | `server/src/server.ts` (SSE), `host-web/src/components/BuildView.tsx` | manual / Playwright |
| REQ-GEN-004 Tier-1 fast path + repair loop | M | shipped | CMP-03 | `server/src/generate.ts` (default N=3) | `server/test/generate.test.ts` |
| REQ-GEN-005 Tier-2 agentic | S | deferred | CMP-06 | — | — |
| REQ-GEN-006 edit-with-AI + versions + revert | M | partial | CMP-03 | `/v1/generate/{id}/repair` not yet wired | — |
| REQ-GEN-007 refuse disallowed with alternative | M | partial | CMP-12 | no input/output safety screen yet | — |
| REQ-GEN-008 honest "reduced scope" on fail | M | shipped | CMP-03 + CMP-05 | `server/src/generate.ts` (terminal branch), `server/src/validate.ts` | manual |
| REQ-GEN-009 cheapest-model routing | S | partial | CMP-03 + CMP-04 | `server/src/provider.ts` (manual selection); no classifier | — |
| REQ-GEN-010 validator parity w/ device runtime | M | shipped | CMP-05 | `server/src/validate.ts` loads `runtime/dist/runtime.global.js` | `server/test/*`, `runtime/test/runtime.spec.ts` |
| REQ-GEN-011 user code import | S | partial | CMP-03 | no `/v1/import` endpoint yet | — |

### Runtime / execution (REQ-RUN-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-RUN-001 previously-made tools run offline | M | shipped | CMP-02 | browser-served, no server round-trip | `runtime/test/runtime.spec.ts` |
| REQ-RUN-002 cross-app isolation | M | shipped | CMP-02 | `runtime/src/host.ts` (per-iframe null origin) | `runtime/test/runtime.spec.ts` |
| REQ-RUN-003 scoped persistent KV | M | shipped | CMP-02 | `runtime/src/memory-storage.ts`, `WC.storage` in `runtime/src/sdk.ts` | `runtime/test/runtime.spec.ts` |
| REQ-RUN-004 export via host chrome | M | shipped (web) | CMP-08 | `host-web/src/components/ToolRunner.tsx` (host-owned share) | manual |
| REQ-RUN-005 network allow-list | M | shipped | CMP-07s + CMP-07c | CSP `connect-src 'none'`, `WC.net.fetch` → `server/src/providers.ts` | `runtime/test/runtime.spec.ts` (CSP), `server/test/providers.test.ts` |
| REQ-RUN-006 Android extended capabilities | S | deferred | CMP-07c | — (Android is v1.0+) | — |
| REQ-RUN-007 app crash contained; "Fix with AI" | M | shipped | CMP-02 + CMP-03 | sandbox catches tool errors; build view re-opens | manual |
| REQ-RUN-008 fast launch time | S | shipped | CMP-02 | p50 ~1.2s on stub; live target p50 ≤20s, p90 ≤45s | `eval/reports/eval-*.json` |

### Home / library (REQ-HOME-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-HOME-001 grid + persistent prompt | M | shipped | CMP-01 | `host-web/src/components/HomeGrid.tsx`, `PromptBar.tsx` | manual |
| REQ-HOME-002 drag to reorder | M | partial | CMP-01 | no drag UI yet | — |
| REQ-HOME-003 folders from drag | M | partial | CMP-01 | no folders yet | — |
| REQ-HOME-004 long-press actions menu | M | partial | CMP-01 | no menu yet (delete is the only action) | — |
| REQ-HOME-005 delete removes bundle + data | M | shipped | CMP-01 + CMP-02 | delete in `HomeGrid.tsx`, `idb.ts`; `WC.storage` is wiped | manual |
| REQ-HOME-006 auto-suggested name + icon | S | shipped | CMP-01 | name + emoji from `<wc-app>` attrs | manual |
| REQ-HOME-007 search/filter | C | deferred | CMP-01 | — | — |

### Code / source (REQ-EDIT-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-EDIT-001 viewable source | M | shipped | CMP-01 | `host-web/src/components/SourceView.tsx` | manual |
| REQ-EDIT-002 edit + run + re-validate | M | partial | CMP-01 + CMP-05 | read-only today; ROADMAP.md | — |
| REQ-EDIT-003 syntax highlighting + errors | S | partial | CMP-01 | no editor in v1.1 | — |
| REQ-EDIT-004 edited code re-validated | M | deferred | CMP-05 | depends on REQ-EDIT-002 | — |

### Data & sync (REQ-DATA-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-DATA-001 local-first | M | shipped | CMP-01 + CMP-02 | `host-web/src/idb.ts` (IndexedDB) | manual |
| REQ-DATA-002 cross-device sync | S | deferred | CMP-11 | — (v1.0+) | — |
| REQ-DATA-003 encryption transit + at rest | M | shipped | — | TLS in transit; Postgres at-rest encryption; bundles content-addressed by hash | infra |
| REQ-DATA-004 full library export + delete | M | partial | CMP-01 | delete via account deletion; export is manual copy today; first-class export ROADMAP.md | — |
| REQ-DATA-005 LWW + conflict surfacing | S | deferred | CMP-11 | depends on REQ-DATA-002 | — |

### Accounts / auth (REQ-ACCT-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-ACCT-001 account not in front of first win | M | shipped | CMP-01 + CMP-10 | sign-in offered after Keep in `App.tsx` | manual |
| REQ-ACCT-002 Sign in with Apple + email | M | partial | CMP-10 | magic link only in v1.1; SIWA is n/a-web (v1.0+) | `server/test/*` (magic link path) |
| REQ-ACCT-003 auth on privileged actions | M | shipped | CMP-10 | bearer-token middleware in `server/src/server.ts` | manual |
| REQ-ACCT-004 account + data delete in-app | M | partial | CMP-10 | logout clears local session; full delete ROADMAP.md | — |

### Billing (REQ-PAY-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-PAY-001 metered free Tier-1 quota | M | shipped | CMP-09 | `server/src/quota.ts`, `quotaFor`; default 3/mo for free | `server/test/quota.test.ts` |
| REQ-PAY-002 IAP via platform | M | n/a-web | CMP-09 | v1.1 sells via Stripe Checkout on the web; StoreKit / Play Billing is v1.0+ | manual |
| REQ-PAY-003 server-side entitlement truth | M | shipped | CMP-09 | `quota.ts`, `billing.ts` — server is the only source of truth | `server/test/quota.test.ts` |
| REQ-PAY-004 webhook updates entitlement | M | shipped | CMP-09 | `/v1/billing/webhook` with signed-body verification in `server/src/stripe.ts` + `billing.ts` | manual |
| REQ-PAY-005 visible quota/credits | S | shipped | CMP-01 | `host-web/src/components/Paywall.tsx` | manual |

### Security (REQ-SEC-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-SEC-001 no provider key in client/bundle | M | shipped | CMP-04 | env-only; `server/src/env.ts` | inspection |
| REQ-SEC-002 restrictive CSP + sandbox | M | shipped | CMP-02 + CMP-07 | `runtime/src/host.ts` (CSP) | `runtime/test/runtime.spec.ts` |
| REQ-SEC-003 rate limit + abuse detection | M | partial | CMP-09 | per-user quota exists; explicit rate-limit middleware + anomaly detection ROADMAP.md | — |
| REQ-SEC-004 encryption transit + at rest | M | shipped | — | TLS in transit; Postgres at-rest | infra |
| REQ-SEC-005 injection cannot escalate | M | partial | CMP-02 | fixed `WC.*` surface (invariant 8); input/output screen ROADMAP.md | manual |

### Privacy & compliance (REQ-PRIV-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-PRIV-001 AI data-sharing consent | M | partial | CMP-01 + CMP-12 | consent copy in the prompt flow; explicit consent screen ROADMAP.md | — |
| REQ-PRIV-002 in-app report path | M | partial | CMP-12 | `/v1/reports` not yet exposed; moderation queue ROADMAP.md | — |
| REQ-PRIV-003 privacy policy + disclosures | M | partial | — | policy not yet written; OQ-02 + COMPLIANCE.md | — |
| REQ-PRIV-004 AI-transparency regimes | M | deferred | — | awaits legal review (OQ-02) | — |
| REQ-PRIV-005 not directed to children | M | shipped | CMP-01 | no child-directed surfaces; age gating in paywall is a follow-up | manual |

### Non-functional (REQ-NFR-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-NFR-001 graceful degradation | M | shipped | CMP-03 | SSE timeout; honest error to user | manual |
| REQ-NFR-002 accessibility basics | M | partial | CMP-01 | semantic HTML in the host shell; full audit deferred | manual |
| REQ-NFR-003 observability dashboards | S | partial | CMP-13 | `/health` + admin dashboard; per-user cost dashboards ROADMAP.md | manual |
| REQ-NFR-004 horizontal scalability | M | shipped | CMP-03 | Hono + Node; single container; Postgres when `DATABASE_URL` is set | infra |
| REQ-NFR-005 localization-ready | S | deferred | — | v1.1 is English-only; strings not externalized | — |
| REQ-NFR-006 hard per-user cost ceiling | M | partial | CMP-09 | quota is a build cap; token-budget middleware ROADMAP.md | — |

### Platform (REQ-PLT-*)

| ID | Prio | v1.1 status | Component | Implemented in | Test(s) |
|---|---|---|---|---|---|
| REQ-PLT-001 iOS App Store compliance | M | deferred | — | iOS is v1.0+; COMPLIANCE.md tracks Doc 07 §7.6 | — |
| REQ-PLT-002 Google Play compliance | M | deferred | — | Android is v1.0+; COMPLIANCE.md | — |
| REQ-PLT-003 iOS/Android min versions | M | deferred | — | no native targets in v1.1 | — |
| REQ-PLT-004 web/PWA channel | S | shipped | — | this v1.1 | manual |

---

## Component status (Doc 03 in v1.1)

| CMP | Component | v1.1 status | Notes |
|---|---|---|---|
| CMP-01 | Mobile Host App | partial | web host shell only; the mobile/host-app parity layer is v1.0+ |
| CMP-02 | Runtime + Runtime SDK | shipped | `runtime/src/*`; injected as `WC` global; the same artifact the validator loads |
| CMP-03 | Generation Orchestrator | shipped | `server/src/generate.ts`; Tier-1 only |
| CMP-04 | Model Gateway | shipped | OpenRouter (with 429 retry), Anthropic, deterministic stub |
| CMP-05 | Validation / Eval Harness | shipped | `server/src/validate.ts`; `eval/`; reuses `runtime/dist/runtime.global.js` |
| CMP-06 | Agentic Build Service | deferred | Tier-2; v1.0+ |
| CMP-07 | Egress Broker / Capability Client | shipped | server half: `server/src/providers.ts`; web half: `WC.net.fetch` |
| CMP-08 | Host Chrome Export | shipped | web share sheet from `ToolRunner`; the tool's own JS does not call any share API |
| CMP-09 | Entitlements & Billing | shipped | `server/src/quota.ts`, `stripe.ts`, `billing.ts` |
| CMP-10 | Identity / Auth | shipped | magic-link only in v1.1; SIWA / Google are v1.0+ |
| CMP-11 | Sync & Storage | partial | store backend done; cross-device sync deferred |
| CMP-12 | Manifest & Moderation | partial | no `/v1/manifest`, no moderation queue; both in ROADMAP.md |
| CMP-13 | Observability & Admin | partial | `/health` + admin dashboard; per-user cost dashboards + alerting in ROADMAP.md |

---

## API surface — what's actually implemented vs Doc 04 §4.7

Doc 04 §4.7 lists the contract. v1.1 implements a subset. This is the live truth; the v1.0 contract still stands but the gap is tracked here.

| Route (Doc 04 §4.7) | Implemented in v1.1? | Where |
|---|---|---|
| `POST /v1/auth/session` | adapted — see `/v1/auth/request` + `/v1/auth/verify` | `server/src/server.ts`, `auth.ts` |
| `GET /v1/me` | yes | `server/src/server.ts` |
| `POST /v1/generate` | yes (SSE) | `server/src/server.ts`, `generate.ts` |
| `POST /v1/generate/{id}/repair` | no | ROADMAP.md (REQ-GEN-006) |
| `POST /v1/import` | no | ROADMAP.md (REQ-GEN-011) |
| `GET /v1/bundles/{id}` | no | ROADMAP.md |
| `POST /v1/apps` (register kept app) | partial — registration happens client-side in `idb.ts`; server-side endpoint not exposed | ROADMAP.md |
| `PATCH` rename/move | no | ROADMAP.md |
| `DELETE /v1/apps/{id}` | no (account-level delete only) | ROADMAP.md (REQ-DATA-004) |
| `POST /v1/sync` | no | ROADMAP.md (REQ-DATA-002 deferred) |
| `POST /v1/billing/webhook` | yes | `server/src/server.ts`, `stripe.ts`, `billing.ts` |
| `POST /v1/reports` | no | ROADMAP.md (REQ-PRIV-002) |
| `GET /v1/manifest` | no | ROADMAP.md (REQ-PLT-001) |
| (additional) `POST /v1/billing/checkout` | yes | `server/src/server.ts` |
| (additional) `POST /v1/auth/logout` | yes | `server/src/server.ts` |
| (additional) `GET /v1/admin/overview` | yes | `server/src/admin.ts` |
| (additional) `GET /v1/providers` | yes | `server/src/providers.ts` |
| (additional) `POST /v1/net/:provider` | yes (server-proxied egress) | `server/src/providers.ts` |
| (additional) `GET /health` | yes | `server/src/server.ts` |

---

## Eval headline

The `eval/` harness is the RSK-02 quality backbone (Doc 06 §6.2).

- **Corpus size:** 27 / ≥200 prompts (`eval/corpus.jsonl`). The 27 are a starter set covering calculators, timers, generators, trackers, notes, lists, utility, and data lookups. Doc 06 §6.2 calls for ≥200; see ROADMAP.md for the growth plan.
- **Default gate:** `EVAL_MIN_PASS_RATE=0.7`. **Target gate:** ≥0.85 (Doc 06 §6.2; REQ-GEN-001 acceptance). ROADMAP.md: raise the default to 0.85 once the corpus is bigger.
- **Latest reports:** `eval/reports/eval-*.json` (gitignored; generated by the runner).
- **Latest run on the 27-prompt corpus with the stub provider:** 100% pass, 100% first-try, p50 ~1.2s, p95 ~2.8s.
- **Latest run on the 27-prompt corpus with a real provider (OpenRouter Sonnet):** ~92% first-try, above the 85% target. (Number as of 2026-06-07 per `README.md`.)

To run:

```bash
npm run eval                                     # live, costs a few cents per case
WC_PROVIDER=stub npm run eval                    # offline plumbing check
WC_MODEL=openai/gpt-oss-120b:free npm run eval   # free tier
EVAL_MIN_PASS_RATE=0.85 npm run eval             # tighter gate
```

---

## Open questions (Doc 09 §9.2)

The v1.0 bible lists 5 open questions. Live status lives here; Doc 09 stays immutable (per Doc 00 §0.6).

| ID | Question | Owner | Status | Notes |
|---|---|---|---|---|
| OQ-01 | Trademark + App Store/Play name-collision check on "Wild Card"; choose final name with a fallback ready. | PM | partial | `README.md` notes "Working title 'Wild Card' pending a trademark/name check." No fallback chosen yet. Web launch is fine with the working title; revisit before iOS submission. |
| OQ-02 | Legal/privacy review: Privacy Policy + ToS; EU AI Act transparency; applicable US state AI-disclosure laws; data-retention policy for prompts and generated content; AI-provider processor terms. | PM + counsel | not-started | **Pre-public-launch blocker.** Need: a published Privacy Policy and ToS at minimum. The other items (EU AI Act, US state laws, retention) need counsel sign-off before opening the funnel. Tracked in COMPLIANCE.md. |
| OQ-03 | Re-verify current model prices and IDs (Doc 04/08) and recompute unit economics before launch. | Backend/AI lead | not-started | Doc 04/08 numbers are mid-2026; should be re-verified at launch. Block: the open OpenRouter dev key committed earlier in development should be rotated first (see DEPLOY.md §1). |
| OQ-04 | Confirm the AI provider's commercial terms for powering an end-user product and that API-key (not consumer-login) auth is used for the agentic build path. | Backend/AI lead + PM | not-started | Only matters once Tier-2 (CMP-06) is in scope. No action needed for v1.1 web launch. |
| OQ-05 | Re-read the live Apple App Review Guidelines (esp. 2.5.2, 4.7.x) and Google Play AI/policy pages within 7 days of each submission; re-run the Doc 07 §7.6 checklist. | PM | not-started | Not applicable to v1.1 web launch. Becomes active when iOS / Play submission work begins (v1.0+). |

---

## When to update this file

- When a `v1.1 status` flips (a new shipped capability, a partial that becomes deferred, an OQ that moves from `not-started` to `in-progress` or `done`).
- When the eval gate moves (corpus size, default `EVAL_MIN_PASS_RATE`, last-run pass rate).
- When an API route is added or removed from the v1.1 surface.
- When an OQ is resolved (close it here; the bible's §9.2 is historical).

Keep the matrix above the fold; treat the API and OQ sections as appendices that grow when the surface grows.
