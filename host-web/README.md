# host-web (Phase 1)

The React + Vite PWA shell — the user-facing app. Placeholder until Phase 1.

Will contain: the home grid of tool icons, the prompt bar, the build view with
live preview (consuming the server's `/v1/generate` SSE stream), the source
viewer/editor (CodeMirror 6), the app runner (mounts a bundle via
[`@wildcard/runtime`](../runtime)), settings, and the Stripe paywall.

It reuses the **same** `@wildcard/runtime` package that the server's validator
uses, so a tool that passes validation runs identically here. See
[AGENTS.md](../AGENTS.md).
