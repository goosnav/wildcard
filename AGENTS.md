# AGENTS.md

Guidance for AI agents and human contributors working in this repository. Read
this before making changes. The product spec lives in [`dev/`](dev/) (Docs 00–09);
when this file and a spec doc disagree, the spec's requirement IDs win.

---

## What this project is

Wild Card turns a plain-language prompt into a small, self-contained web tool that
runs in a sandboxed WebView and is owned/editable by the user. **Generation
happens on the server; execution happens on the device.** The current build
target is a **web/PWA** app whose runtime is designed to later embed unchanged in
an iOS/Android shell. See [README.md](README.md).

The business goal is modest and specific: a few hundred paying subscribers (~a
couple thousand MRR), built solo with heavy AI assistance. **Favor lean,
shippable, low-COGS scope over completeness.** Do not add Tier-2 agentic builds,
cross-device sync, folders/drag, or native code until the spec's phase for them.

---

## Non-negotiable invariants

These are not style preferences. Breaking one can get the product **rejected from
the App Store** or **leak user data**. If a change would violate one, stop and
flag it instead.

### Store compliance (Doc 07)
1. **Tools are HTML/JS only.** Never generate or execute native/compiled code.
2. **No native bridge to generated code on iOS.** Device actions (share, export,
   file pick) are performed by the *host's* native chrome, reading a result the
   tool handed up via `WC.output`. Tool code must never call a device/native API
   directly. (Apple 4.7.2)
3. **Source stays viewable + editable by the owner.** This is what keeps us in the
   scripting/automation lane. (Apple 2.5.2)
4. **Not a marketplace.** Tools are private to their creator. No gallery, no
   sharing of tools between users.

### Security (Doc 03 §3.8)
5. **Treat every generated/imported tool as adversarial.** It runs in an
   `<iframe sandbox="allow-scripts">` (null origin) — never add `allow-same-origin`
   or otherwise weaken the sandbox.
6. **Deny-by-default network.** The tool CSP includes `connect-src 'none'`. The
   only network path is `WC.net.fetch(provider, …)` → host → a fixed catalog of
   **server-proxied** providers. Never let a tool reach an arbitrary origin.
7. **Secrets are server-side only.** No provider API key in any client or bundle.
8. **The `WC.*` surface is fixed at host build time.** It is never extended or
   altered by tool content (no eval-of-tool-config into capabilities).

### Reliability (Doc 02 §A)
9. **Never deliver an unvalidated tool.** Every bundle must pass `validate()`
   (headless run, no fatal errors) before it reaches a user. The repair loop is
   gated by the *validator's* pass/fail, never the model's self-assessment.
10. **Never hand over a broken icon.** On unrecoverable failure, return an honest,
    non-technical explanation + a reduced-scope offer.

---

## Architecture map

```
runtime/  — built ONCE, runs in the browser today and the iOS WebView later.
  protocol.ts        postMessage contract between tool (child) and host (parent).
  sdk.ts             buildSdkSource(): the WC.* global injected into each tool.
  host.ts            mountTool(): creates the sandbox iframe, applies the CSP,
                     routes WC requests to adapters. composeSrcdoc() injects SDK+CSP.
  memory-storage.ts  StorageAdapter impls (scoped = the isolation proof).
  types.ts           Bundle, Manifest, adapter interfaces.

server/   — generation backend.
  contract.ts        parseBundle(): strict <wc-app> model output → Bundle. Determinism.
  validate.ts        CMP-05: load a candidate in headless Chromium under the SAME
                     runtime, smoke-check. Reuses runtime/dist/runtime.global.js.
  generate.ts        CMP-03: orchestrator + bounded, validator-gated repair loop.
                     Model is an injectable interface (testable with no API key).
  anthropic-model.ts CMP-04: real Model, with prompt caching on the static prefix.
  server.ts          /v1/generate SSE endpoint.
  prompts/system.md  the generation system prompt + output contract.
```

**Data flow:** prompt → model → `parseBundle` → `validate` → (repair ≤3×) →
deliver bundle → `mountTool` on device.

---

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Build runtime bundle | `npm --workspace @wildcard/runtime run build:global` |
| Typecheck runtime | `npm --workspace @wildcard/runtime run typecheck` |
| Runtime tests (Playwright) | `npm --workspace @wildcard/runtime test` |
| Server tests (Vitest) | `npm --workspace @wildcard/server test` |
| Typecheck server | `npm --workspace @wildcard/server run typecheck` |
| Run server | `npm --workspace @wildcard/server run dev` |

`validate.ts` loads `runtime/dist/runtime.global.js`, so **rebuild the runtime
bundle after changing `runtime/src/`** or the validator/tests will run stale code.

---

## Conventions

- **TypeScript, strict mode**, on both packages. No `any` except at the
  postMessage boundary (the channel is intentionally untyped on the wire).
- **ESM** everywhere (`"type": "module"`). Server imports use explicit `.js`
  extensions on relative paths (NodeNext/Bundler resolution).
- **Comments explain WHY, not WHAT.** Especially: tie security/compliance code to
  its requirement ID (e.g. `// REQ-RUN-005`) so the reason survives refactors.
  Don't narrate obvious code.
- **Code injected into the tool iframe** (the body of `buildSdkSource`) must be
  dependency-free and ES2017-compatible — it runs in an isolated context with no
  bundler.
- **Tests must not require network or an API key** by default. The orchestrator
  takes an injectable `Model` and `validateFn` precisely so logic is testable
  offline; only `anthropic-model.ts` and the live server touch the provider.
- Keep the visible surface small (Tenet T6). Resist adding screens/options.

---

## When you add a feature

1. Find the requirement ID it serves in `dev/02_REQUIREMENTS.txt`. If there isn't
   one, question whether it belongs in v1.
2. Check it against the invariants above.
3. Add or extend a test (Playwright for runtime behavior, Vitest for server logic).
4. If you changed `runtime/src/`, rebuild the global bundle before testing.
5. Update this file or the README if you changed a command, a layout, or an
   invariant.
