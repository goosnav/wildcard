# host-web

The React + Vite PWA shell — the user-facing app. Describe a tool in the prompt
bar, watch it build live, and run it on a home grid of icons.

## What's here (Sprint 2)

- **Prompt bar** → `POST /v1/generate`, consuming the server's SSE stream.
- **Build view** — live generation/validation/repair events as they arrive.
- **Tool runner** — mounts the validated bundle via [`@wildcard/runtime`](../runtime)
  in a sandboxed `<iframe>`; the **same** runtime the server's validator uses, so
  a tool that passes validation runs identically here.
- **Home grid** of created tools, with launch + delete.
- **Source view** — read-only, so generated code is always inspectable (Apple 2.5.2).
- Tools persist in `localStorage` for now (IndexedDB + offline + PWA install land
  in Sprint 3).

## Run it locally

Two processes — the generation server and this Vite app (which proxies `/v1` to it):

```bash
# 1. Generation server. Use a real provider key (.env) OR the offline stub:
WC_PROVIDER=stub npm --workspace @wildcard/server run dev     # no key, no spend
#   …or, with OPENROUTER_API_KEY/ANTHROPIC_API_KEY set in .env:
npm --workspace @wildcard/server run dev

# 2. This app
npm --workspace @wildcard/host-web run dev    # http://localhost:5173
```

`WC_PROVIDER=stub` makes the server return a real, validatable tool with no API
call — useful for working on the shell without burning credits. Set a provider
key (see the root [README](../README.md)) for real generation.
