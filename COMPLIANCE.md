# COMPLIANCE

**The Doc 07 §7.6 compliance checklist, tracked.** Doc 07 §7.6 is the v1.0 program's release-gate G5 in Doc 06 — every item must be GREEN before a store submission. v1.1 is a web launch, so most items are `n/a-web` or `deferred-to-v1.0+`; a few are universal and apply even to the web channel. The v1.0 IDs (C1..C8, G1..G2) are stable; we annotate status.

**For the live state of the underlying requirements** (REQ-PLT-001, REQ-PLT-002, REQ-PRIV-001..005, etc.) see [`STATUS.md`](STATUS.md). **For the work items** that will move rows from `partial` to `done`, see [`ROADMAP.md`](ROADMAP.md). **For the static v1.1 vs v1.0 framing**, see [`dev/10_WEB_SLICE_BASELINE_v1.1.txt`](dev/10_WEB_SLICE_BASELINE_v1.1.txt).

Status legend: `done` (code + test), `partial` (partly done; see STATUS.md + ROADMAP.md), `deferred-to-v1.0+` (in v1.0 but not in v1.1), `n/a-web` (does not apply to a web-only launch), `blocked-on-OQ-XX` (waiting on a legal/external review), `not-started`.

Last updated: 2026-06-07.

---

## Doc 07 §7.6 — the checklist

### Apple posture (Doc 07 §7.2)

| # | Check | v1.1 status | Notes / where |
|---|---|---|---|
| C1 | Tools run only as HTML5/JS in the platform WebView (no native exec) | done | `runtime/src/host.ts` (sandbox iframe); v1.1 is browser-native HTML/JS. **Universal — also satisfied for the web launch.** |
| C2 | iOS: no native API bridge exposed to generated code | n/a-web | iOS is v1.0+. When iOS work begins, the v1.1 web slice becomes the reference; `WC.*` never calls a native API directly. |
| C3 | Source of every tool viewable + editable by owner | partial | Viewable: done (`SourceView.tsx`). Editable: ROADMAP.md (REQ-EDIT-002). Web launch tolerates view-only as a starter posture because the product is positioned as scripting/automation to App Store; the web channel does not have a reviewer to satisfy. |
| C4 | Not a marketplace/gallery; tools are private to the user | done | v1.1 is single-user, no sharing of tools between users. **Universal — also satisfied for the web launch.** |
| C5 | Content manifest of host + example tools prepared (iOS) | partial | `/v1/manifest` endpoint not yet implemented (Doc 04 §4.7); ROADMAP.md. The host-app + templated example tools are in scope; user-private tools are not (Doc 03 §3.7). |
| C6 | AI data-sharing consent shown before first generation | partial | Consent copy is in the prompt flow; an explicit consent screen is ROADMAP.md (REQ-PRIV-001). **Universal — required for the web launch.** |
| C7 | Sign in with Apple offered (iOS); privacy-respecting login (Android) | n/a-web (iOS) / partial (Android) | iOS: v1.0+. Web: magic link (privacy-respecting) is the v1.1 path. SIWA becomes relevant when iOS work begins. |
| C8 | Network egress allow-listed; logged | done | `WC.net.fetch` routes through `server/src/providers.ts` (a fixed catalog: weather, currency); CSP `connect-src 'none'`. **Universal — also satisfied for the web launch.** |

### Google Play posture (Doc 07 §7.3)

| # | Check | v1.1 status | Notes / where |
|---|---|---|---|
| G1 | Input + output safety screening live; prohibited categories blocked (AI-Generated Content policy) | partial | No pre-screen / post-screen yet (CMP-12 not implemented); ROADMAP.md. Web launch tolerates the gap because the surface is small, low-traffic, and creator-facing; a human-reviewed prompt corpus is the v1.1 safety posture. |
| G2 | In-app reporting wired to moderation | partial | No `/v1/reports` endpoint; no moderation queue yet; ROADMAP.md (REQ-PRIV-002). |

### Universal (both stores + web launch)

| # | Check | v1.1 status | Notes / where |
|---|---|---|---|
| U1 | Privacy policy + ToS published; Apple Privacy Label + Play Data Safety done | partial | Policy not yet written; OQ-02 + ROADMAP.md. **Required for the web launch.** |
| U2 | Account + data export and delete available in-app | partial | Account delete via account-deletion path; full library export is ROADMAP.md (REQ-DATA-004, REQ-ACCT-004). **Required for the web launch.** |
| U3 | Age gating set; store age ratings completed | done (web) | No child-directed surfaces; v1.1 web launch is set to the relevant age rating. iOS / Play ratings are v1.0+. |
| U4 | Reviewer note + demo account + example tools prepared | not-started | Only relevant at iOS / Play submission time. The `runtime/tools/tip-splitter` bundle is a working example. |
| U5 | IAP via StoreKit / Play Billing; Small Business / reduced-rate enrolled | n/a-web | v1.1 sells via Stripe Checkout on the web; StoreKit / Play Billing is v1.0+. The Small Business Program applies when those stores are activated. |
| U6 | Live guidelines re-checked within 7 days of submission (OQ-05) | not-started | Not applicable to the v1.1 web launch. Becomes active when iOS / Play submission work begins. |

### Cross-cutting legal (Doc 07 §7.4; OQ-02)

| # | Check | v1.1 status | Notes / where |
|---|---|---|---|
| L1 | EU AI Act: AI-system transparency duties (user informed, AI-generated content disclosed) | blocked-on-OQ-02 | Counsel sign-off required; OQ-02. |
| L2 | US state AI-disclosure / transparency patchwork | blocked-on-OQ-02 | Counsel sign-off required; OQ-02. |
| L3 | Privacy Policy + Terms of Service | blocked-on-OQ-02 | See U1. |
| L4 | Data-subject rights: access / export / delete | partial | Export and delete are partial (U2). |
| L5 | Data-retention policy for prompts and generated content | not-started | ROADMAP.md. |
| L6 | Processor terms with the AI provider | blocked-on-OQ-02 | Counsel sign-off; OQ-02. |
| L7 | Confirm AI provider's commercial terms for an end-user product; API-key (not consumer-login) auth for the agentic build path (OQ-04) | not-started | OQ-04; only matters once Tier-2 (CMP-06) is in scope. Not a v1.1 web launch blocker. |

### Cross-cutting security (Doc 03 §3.8; RSK-04)

| # | Check | v1.1 status | Notes / where |
|---|---|---|---|
| S1 | No provider API key in client or bundle (REQ-SEC-001) | done | `server/src/env.ts`; `WC.*` never sees a key. **Universal.** |
| S2 | Strict CSP + iframe sandbox (no `allow-same-origin`) | done | `runtime/src/host.ts`; AGENTS.md invariant 5. **Universal.** |
| S3 | Per-user rate limits and abuse detection (REQ-SEC-003) | partial | Quota is a build cap; explicit rate-limit middleware is ROADMAP.md. **Universal.** |
| S4 | Per-user hard cost ceiling (REQ-NFR-006) | partial | Quota is a build cap; token-budget middleware is ROADMAP.md. |
| S5 | Encryption in transit + at rest (REQ-SEC-004, REQ-DATA-003) | done | TLS in transit; Postgres at-rest encryption. **Universal.** |
| S6 | Imported code / fetched data is data, not instructions (REQ-SEC-005) | partial | `WC.*` surface is fixed (invariant 8); input/output screen is ROADMAP.md (CMP-12). |
| S7 | External pentest (Doc 05 §5.4 P4) | not-started | v1.0+; pre-launch blocker for store submission. A pentest is not strictly required for the v1.1 web launch, but recommended before opening the funnel widely. |

---

## v1.1 web launch — pre-launch compliance gate (G5-web)

A simplified gate for the v1.1 web launch (a strict subset of Doc 07 §7.6). Every row must be GREEN before opening the funnel. The Doc 06 G5 sign-off still applies at v1.0; this is a v1.1-only checkpoint.

- [ ] **U1: Privacy Policy + ToS published** → OQ-02, REQ-PRIV-003
- [ ] **U2: In-app account + data delete** → REQ-ACCT-004
- [ ] **U2: Full library export** → REQ-DATA-004
- [ ] **C5: `/v1/manifest` endpoint implemented** → CMP-12
- [ ] **C6: AI data-sharing consent screen** → REQ-PRIV-001
- [ ] **C8: Network egress allow-list** (already GREEN — confirm in production)
- [ ] **G1: Input pre-screen + output post-screen** → CMP-12, REQ-GEN-007
- [ ] **G2: `/v1/reports` endpoint + moderation queue** → REQ-PRIV-002
- [ ] **S1: No provider key in client/bundle** (already GREEN)
- [ ] **S2: Strict CSP + sandbox** (already GREEN)
- [ ] **S3: Per-user rate limits** → REQ-SEC-003
- [ ] **S5: Encryption in transit + at rest** (already GREEN — confirm `DATABASE_URL` is set in production)
- [ ] **U3: Age rating set** for the web launch
- [ ] **DEPLOY.md §7 post-deploy checklist** complete

---

## When to update this file

- When a row moves from `partial` to `done` or from `deferred-to-v1.0+` to `partial` (i.e. when the work has begun).
- When an OQ is resolved that unblocks a `blocked-on-OQ-XX` row.
- When v1.0+ work begins (iOS / Android): re-evaluate the `n/a-web` and `deferred-to-v1.0+` rows; promote the ones that now apply.
- When the v1.0 bible re-baselines (Doc 07 §7.6 itself changes): add new rows; do not delete historical ones.
