# ROADMAP

**The concrete, ordered list of work that needs to happen next, grouped by phase.** Doc 05's phases are the long-term plan; this file turns them into checkboxes. For the live state of each requirement, see [`STATUS.md`](STATUS.md). For the static framing of v1.1 vs v1.0, see [`dev/10_WEB_SLICE_BASELINE_v1.1.txt`](dev/10_WEB_SLICE_BASELINE_v1.1.txt). For iteration history, see [`SPRINTS.md`](SPRINTS.md). For store-readiness, see [`COMPLIANCE.md`](COMPLIANCE.md).

Conventions: `[x]` = done, `[ ]` = not done, `→ REQ-XXX` = the requirement this item serves (per STATUS.md), `→ CMP-XX` = the component. Items at the top of each phase are the next concrete things to do; items at the bottom are the bigger end-of-phase outcomes.

Last updated: 2026-06-07.

---

## v1.1 next-up (the work to ship the v1.1 web launch)

These are the items blocking the v1.1 public web launch. Order is approximate; treat them as a checklist, not a critical path.

### Pre-launch blockers (must be done before opening the funnel)

- [ ] **Publish Privacy Policy + Terms of Service** → OQ-02, REQ-PRIV-003, COMPLIANCE.md
- [ ] **Implement `/v1/manifest` endpoint** (Doc 04 §4.7; REQ-PLT-001 C5) → CMP-12
- [ ] **Implement `/v1/reports` endpoint + moderation queue** (REQ-PRIV-002) → CMP-12
- [ ] **Implement CMP-12 input pre-screen + output post-screen** (REQ-GEN-007, REQ-PRIV-001) → CMP-12
- [ ] **CMP-12: explicit AI data-sharing consent screen** (REQ-PRIV-001) → CMP-01
- [ ] **In-app account + data delete** (REQ-ACCT-004, REQ-DATA-004) → CMP-01 + CMP-10
- [ ] **Rotate the OpenRouter dev key** committed earlier in development (DEPLOY.md §1) → REQ-SEC-001
- [ ] **Re-verify model prices and unit economics** (OQ-03; Doc 04/08) → REQ-NFR-006
- [ ] **Walk through COMPLIANCE.md item-by-item** and stamp each row → REQ-PLT-001/002
- [ ] **End-to-end smoke test on a fresh deploy** (DEPLOY.md §7 checklist) → all [M] REQs

### Hardening the v1.1 surface (do these in parallel with the launch prep)

- [ ] **Edit-with-AI versioning + revert** (REQ-GEN-006) → CMP-03
- [ ] **Editable source view + "Run" that re-validates** (REQ-EDIT-002/003/004) → CMP-01 + CMP-05
- [ ] **Home grid: long-press menu, drag-reorder, folders** (REQ-HOME-002/003/004) → CMP-01
- [ ] **Per-user rate-limit + token-budget middleware** (REQ-SEC-003, REQ-NFR-006) → CMP-09 + CMP-13
- [ ] **Cost / success / latency dashboards** (REQ-NFR-003, Doc 08 §8.5) → CMP-13
- [ ] **Cheapest-model classifier + routing** (REQ-GEN-009) → CMP-03 + CMP-04
- [ ] **Full library export** (REQ-DATA-004 first-class endpoint) → CMP-01 + CMP-11 partial
- [ ] **Accessibility audit + fixes** (REQ-NFR-002) → CMP-01
- [ ] **Localization framework + externalize strings** (REQ-NFR-005) → CMP-01
- [ ] **Add an explicit `WC.capabilities.exportFile` / `share` on Android** (REQ-RUN-006; web can use the browser share sheet, but the API surface should exist) → CMP-02
- [ ] **`/v1/import` endpoint** (REQ-GEN-011) → CMP-03

### Growing the eval corpus (Doc 06 §6.2, RSK-02)

- [ ] **Reach ≥85 prompts** in `eval/corpus.jsonl` (from 52). Mid-step before the 200-prompt v1.0 target; should exercise more difficulty bands and the disallowed subset.
- [ ] **Add a "hard" difficulty band** for the prompts Tier-1 is expected to fail on. → REQ-GEN-005
- [x] **Add the disallowed-prompt subset** for the 100% refusal gate (REQ-GEN-007) → CMP-12 — `eval/disallowed.jsonl` (12 cases across 7 harm categories) + a conservative server-side pre-filter (`server/src/safety.ts`) that refuses before any token spend; `server/test/safety.test.ts` asserts zero false positives on the full legit corpus and 100% catch on the subset. *Still to do: a model-based moderation pass for paraphrased/novel harmful intent, and an output-side check (full CMP-12).*
- [ ] **Add a prompt-injection subset** for the 0% capability-escalation gate (REQ-SEC-005) → CMP-12
- [ ] **Raise the default `EVAL_MIN_PASS_RATE` to 0.85** once the corpus is big enough to make the gate meaningful. → REQ-GEN-001
- [ ] **Add a "first-try p50 / p90 latency" tracked metric** to the runner output (currently logged but not surfaced) → REQ-GEN-004

### v1.1 launch and operate

- [ ] Deploy to a container host (DEPLOY.md §4) → all [M] REQs
- [ ] Connect Resend for magic links → REQ-ACCT-001
- [ ] Connect Stripe (Checkout + signed webhook) → REQ-PAY-001..004
- [ ] Connect Postgres (`DATABASE_URL`) and run `store:smoke` → REQ-DATA-001
- [ ] Activate the admin dashboard (`WC_ADMIN_EMAILS`) → REQ-NFR-003
- [ ] Set up cost / success alerting (CMP-13) → REQ-NFR-001
- [ ] Instrument activation + D1/D7/D30 (Doc 08 §8.5 KPIs) → REQ-NFR-003

---

## Phase P0 — Discovery, design, de-risk (Doc 05 §5.4) — **DONE, with web-first pivot**

> Phase 0 of the v1.0 program is "lock Doc 01/02; design system; M0 store submission spike." For v1.1 we did the doc work (the v1.0 bible, the v1.1 overlay) and chose web first (Doc 07 §7.5). The M0 store submission spike is N/A because a web launch sidesteps App Review.

- [x] **Lock Doc 01/02** → Doc 01, Doc 02
- [x] **Choose web-first lead channel** (Doc 07 §7.5) → REQ-PLT-004
- [x] **Document the v1.1 overlay** → `dev/10_WEB_SLICE_BASELINE_v1.1.txt`
- [x] **Make the doc set internally consistent** (STATUS.md, ROADMAP.md, SPRINTS.md, COMPLIANCE.md, AGENTS.md touch-ups) → Doc 00 §0.6
- [ ] **M0 store submission spike** — deferred to v1.0+ (web launch sidesteps App Review)

---

## Phase P1 — Walking skeleton (Doc 05 §5.4) — **DONE**

> "Auth-light, /generate Tier-1 single call → validate → live preview → Keep → run on device. Minimal home grid. Backend + model gateway real."

- [x] **Runtime SDK + sandbox + CSP + scoped storage** → CMP-02, REQ-RUN-001/002/003/005
- [x] **Tier-1 generation orchestrator + repair loop** → CMP-03, REQ-GEN-002/004
- [x] **Validator (CMP-05) loading the same runtime.global.js** → CMP-05, REQ-GEN-010, AGENTS.md invariant 9
- [x] **Model gateway: OpenRouter (with 429 retry), Anthropic, deterministic stub** → CMP-04, REQ-SEC-001
- [x] **SSE build view + live preview + Keep/Discard** → CMP-03 + CMP-01, REQ-GEN-003
- [x] **Minimal home grid (launch + delete)** → CMP-01, REQ-HOME-001/005
- [x] **Source view (read-only)** → CMP-01, REQ-EDIT-001
- [x] **Auth-light: no account wall in front of first win** → CMP-10, REQ-ACCT-001
- [x] **Regression eval harness (27-prompt starter corpus + scoring runner)** → Doc 06 §6.2, RSK-02
- [x] **Single-container Dockerfile + DEPLOY.md** → CMP-03, CMP-04

---

## Phase P2 — iOS feature-complete + money + compliance — **PARTIAL**

> In v1.1 terms, "feature-complete" means: home grid polish (folders/drag/long-press), source view editable, edit-with-AI versioning, paywall, manifest, eval harness v1.

### Money (done)

- [x] **Magic-link auth** (Resend) → CMP-10, REQ-ACCT-001
- [x] **Server-enforced free-build quota** → CMP-09, REQ-PAY-001/003
- [x] **Stripe paywall + signed webhook** → CMP-09, REQ-PAY-002 (n/a-web note) / REQ-PAY-004
- [x] **Visible quota in the paywall** → CMP-01, REQ-PAY-005
- [x] **Allow-listed admin dashboard** → CMP-13, REQ-NFR-003 partial

### Storage (partial)

- [x] **JSON + Postgres store with auto-schema** → CMP-11 partial, REQ-DATA-001
- [x] **Local-first tool storage (IndexedDB)** → CMP-01, REQ-DATA-001
- [ ] **Full library export** → CMP-01, REQ-DATA-004
- [ ] **Account + data delete in-app** → CMP-10, REQ-ACCT-004

### Compliance (partial)

- [x] **CSP + sandbox + allow-listed egress** → CMP-02 + CMP-07, REQ-SEC-002
- [x] **No provider key in client/bundle** → CMP-04, REQ-SEC-001
- [ ] **`/v1/manifest` content manifest** → CMP-12, REQ-PLT-001 C5
- [ ] **Privacy Policy + ToS published** → OQ-02, REQ-PRIV-003
- [ ] **AI data-sharing consent screen** → CMP-01 + CMP-12, REQ-PRIV-001
- [ ] **CMP-12 input pre-screen + output post-screen** → CMP-12, REQ-GEN-007
- [ ] **In-app report path** (`/v1/reports` + moderation) → CMP-12, REQ-PRIV-002

### Polish (not done)

- [ ] **Home grid: long-press menu, drag-reorder, folders** → CMP-01, REQ-HOME-002/003/004
- [ ] **Editable source view + syntax highlighting + re-validate on Run** → CMP-01 + CMP-05, REQ-EDIT-002/003/004
- [ ] **Edit-with-AI versioning + revert** → CMP-03, REQ-GEN-006
- [ ] **Accessibility audit** → CMP-01, REQ-NFR-002
- [ ] **Localization framework + externalize strings** → CMP-01, REQ-NFR-005

---

## Phase P3 — Android + Tier-2 + eval hardening — **NOT STARTED** (v1.0+)

> "Android build + richer consent-gated bridge; Tier-2 agentic builds (Agent SDK + sandbox) raising hard-prompt success; eval suite ≥200 prompts gating CI; cost dashboards."

- [ ] **Tier-2 agentic builds (CMP-06, Doc 04 §4.4)** → REQ-GEN-005
- [ ] **Ephemeral sandbox provider (E2B / Modal / Daytona / Fly Machines)** → CMP-06
- [ ] **Android React Native shell** → CMP-01 mobile half, REQ-PLT-002
- [ ] **Android-native module: WebView, Play Billing, capability bridge** → CMP-07c, Doc 05 §5.3
- [ ] **Per-use consent UI for Android capabilities** (REQ-RUN-006) → CMP-01 + CMP-07c
- [ ] **Reach ≥200 prompts in `eval/corpus.jsonl`** → Doc 06 §6.2
- [ ] **Wire the eval harness into CI** (failing gate = blocking merge) → Doc 06 §6.5 G1
- [ ] **Per-user cost dashboards + alerting** → CMP-13, REQ-NFR-003
- [ ] **Cheapest-model classifier + routing** → CMP-03, REQ-GEN-009

---

## Phase P4 — Beta hardening, review cycles, launch — **NOT STARTED for stores** (v1.0+)

> "External pentest + fixes; perf + a11y pass; store submissions and review back-and-forth; staged rollout. Optional web/PWA channel kickoff."

- [ ] **External pentest + remediation** → RSK-04
- [ ] **Apple Developer Program enrollment** (org; D-U-N-S) → Doc 07 §7.2
- [ ] **iOS RN build signing + App Store Connect record** → Doc 07 §7.2
- [ ] **App Privacy (nutrition label) submission** → REQ-PRIV-003
- [ ] **StoreKit 2 / RevenueCat integration** → CMP-09, REQ-PAY-002
- [ ] **Google Play Developer account + Data Safety form** → Doc 07 §7.3
- [ ] **Play Billing integration** → CMP-09, REQ-PAY-002
- [ ] **TestFlight + Play internal testing rollout** → Doc 05 §5.4 M4
- [ ] **App Review submission + reviewer note** (Doc 07 §7.2) → REQ-PLT-001
- [ ] **Pre-launch AI-law counsel sign-off** (EU AI Act, US state laws) → OQ-02, REQ-PRIV-004
- [ ] **iOS Privacy Manifest (PrivacyInfo.xcprivacy)** → Doc 07 §7.2

---

## M5 — Post-launch (Doc 05 §5.4) — **NOT STARTED**

> "KPI dashboards live; first paying cohort; weekly eval + cost review cadence."

- [ ] **Activation + retention dashboards** (Doc 08 §8.5) → REQ-NFR-003
- [ ] **Weekly eval run + cost review cadence** → Doc 06 §6.7
- [ ] **Free → Paid conversion tracking** → REQ-PAY-001
- [ ] **Churn dashboard** → Doc 08 §8.5
- [ ] **Iterate on the eval corpus from real failures** → Doc 06 §6.7

---

## Out of scope for v1.0 (per Doc 01 §7)

These are explicitly **not** in the v1.0 program either. They live in this list so a contributor can confirm the negative rather than re-ask.

- [ ] **Marketplace / public gallery of other users' tools** — out of scope at any version (Doc 07 C4).
- [ ] **Social sharing of tools** between users.
- [ ] **Team / collaboration features**.
- [ ] **Web-embed of others' tools**.
- [ ] **Plug-in ecosystem**.
- [ ] **Tools that need deep background access to phone private data** (iOS prohibited; Android deferred).
- [ ] **Multi-user / regulated financial / medical tools** (Doc 01 §6).
- [ ] **Background processes / daemons** (Doc 01 §6).
- [ ] **Python tools via a bundled interpreter** (Doc 03 §3.10; deferred).

---

## How this list updates

- New items are added at the top of the matching phase when discovered.
- Done items move to the phase's "Done" / checked state (do not delete — historical).
- Phase status changes (e.g. P2 going from "partial" to "done") flip the section header.
- The **v1.1 next-up** list is the only section intended to be re-ordered aggressively. Everything else is the long-term shape.
