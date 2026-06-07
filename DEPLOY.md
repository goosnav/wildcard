# Deploying Wild Card

This is a practical, solo-friendly guide to getting Wild Card live. The default
shape is **one container that serves everything** — the Node API and the built
web app share an origin, so there's no CORS and no API-base wiring to manage.

**Program context:** this deploys the v1.1 web slice (see
[`STATUS.md`](STATUS.md) and the
[v1.1 overlay](dev/10_WEB_SLICE_BASELINE_v1.1.txt)). The iOS / Android builds
are deferred to v1.0+; the runtime that ships here is what they'll wrap.
Store-readiness is tracked in [`COMPLIANCE.md`](COMPLIANCE.md).

```
            ┌─────────────────────────────────────────────┐
  browser ──┤  Wild Card container (server/Dockerfile)     │
   (PWA)    │   • Hono API  /v1/*  +  /health              │
            │   • serves the built web app (WC_WEB_DIR)    │
            │   • headless Chromium validator (Playwright) │
            └───────────────┬─────────────────────────────┘
                            │
          ┌─────────────────┼──────────────────┬──────────────┐
       Postgres          Stripe              Resend      AI provider
     (DATABASE_URL)   (billing+webhook)    (magic-link)  (OpenRouter/Anthropic)
```

You can also split the web app onto a static host (Vercel/Netlify/Cloudflare
Pages) later — see [§6](#6-optional-split-the-web-app-onto-a-static-host) — but
start with the single container; it's the least moving parts.

---

## 1. Services to connect

Create accounts and collect these before deploying. All keys are read
**server-side only** — none are ever shipped to the browser or a generated tool.

| Service | Why | Env vars |
| --- | --- | --- |
| **AI provider** (OpenRouter or Anthropic) | Generation | `OPENROUTER_API_KEY` *or* `ANTHROPIC_API_KEY`, `WC_MODEL` |
| **Postgres** (Neon, Supabase, RDS, …) | Accounts/quota at scale | `DATABASE_URL` |
| **Resend** | Magic-link sign-in emails | `RESEND_API_KEY`, `WC_EMAIL_FROM` |
| **Stripe** | Pro subscriptions | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` |
| *(you)* | Admin dashboard access | `WC_ADMIN_EMAILS` |
| *(you)* | Magic-link URLs in emails | `WC_APP_URL` (your public URL) |

> Without `DATABASE_URL` the server falls back to a local JSON file, without
> Resend it logs the link to the console, and without Stripe the paywall says
> "subscriptions aren't switched on yet." So you can deploy with a subset and
> turn services on incrementally. `GET /health` reports which are live:
> `{ provider, store, email, billing }`.

> **Rotate the OpenRouter key** that was committed earlier in development before
> going live (`sk-or-v1-989b…`). Treat it as compromised.

See [`.env.example`](.env.example) for the full annotated variable list.

---

## 2. Build and run the container locally

The image is built from the **repo root** (it needs all three workspaces):

```bash
docker build -f server/Dockerfile -t wildcard .
docker run -p 8787:8787 --env-file .env wildcard
```

Then open <http://localhost:8787> — the web app and API are both there. The image
is based on the official Playwright image, so the headless-Chromium validator and
its system libraries are already present and version-matched.

> Keep the `FROM mcr.microsoft.com/playwright:vX.Y.Z-jammy` tag in
> `server/Dockerfile` in sync with the `@playwright/test` version in
> `package.json` (currently **1.60.0**).

---

## 3. Provision Postgres

1. Create a database (Neon/Supabase give you a connection string).
2. Set `DATABASE_URL`. The schema is created automatically on first connect —
   there is no separate migration step for the v1 tables.
3. Verify the connection end-to-end **before** pointing traffic at it:

   ```bash
   DATABASE_URL=postgres://… npm --workspace @wildcard/server run store:smoke
   ```

   A green run confirms TLS, the schema bootstrap, and every store operation.

---

## 4. Deploy to a container host

Any host that runs a Dockerfile works (Railway, Render, Fly.io, Cloud Run). The
server needs Chromium, so a **container** runtime is required — not a
"Node serverless function" runtime.

1. Point the host at this repo, Dockerfile path `server/Dockerfile`.
2. Set the env vars from [§1](#1-services-to-connect). Most platforms inject
   `PORT`; the server honors it (defaults to 8787).
3. Set `WC_APP_URL` to the public URL the host gives you (e.g.
   `https://wildcard.up.railway.app`) so magic-link emails point back correctly.
4. Give it a little memory headroom — Chromium needs it. 1 GB RAM is a safe floor.
5. Deploy. Health check path: `/health`.

---

## 5. Wire up Stripe

1. Create a **recurring** Price for the subscription; copy its id → `STRIPE_PRICE_ID`.
2. Copy your secret key → `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint pointing at your deployment:
   `https://<your-domain>/v1/billing/webhook`. Subscribe to at least:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the webhook's **signing secret** → `STRIPE_WEBHOOK_SECRET`. This is
   required in production: the server verifies every webhook signature against
   the raw body, so entitlements can't be forged.
5. Redeploy. `GET /health` should now report `"billing": true`.

Stripe's own dashboard remains the source of truth for payments, refunds, and
failed charges. The in-app **Dashboard** (visible to `WC_ADMIN_EMAILS`) is an
at-a-glance roll-up of your own user records + estimated MRR.

---

## 6. (Optional) Split the web app onto a static host

If you later want the web app on a CDN/static host:

1. Build it: `npm --workspace @wildcard/host-web run build` → `host-web/dist`.
2. Deploy `host-web/dist` to Vercel/Netlify/Cloudflare Pages.
3. **Proxy the API** so the browser stays same-origin: add a rewrite of
   `/v1/*` and `/health` to your server deployment (e.g. a Vercel `rewrites`
   rule). The client calls relative `/v1` paths, so a rewrite is all it needs —
   no code change.
4. Leave `WC_WEB_DIR` **unset** on the server in this mode (it becomes API-only).

This trades one deployable for two; only do it if you specifically want CDN
edge-caching for the shell. The single container in §2 is the recommended start.

---

## 7. Post-deploy checklist

- [ ] `GET /health` → `{ ok: true, provider, store: "postgres", email: true, billing: true }`
- [ ] Sign in with a magic link (check the email actually arrives via Resend).
- [ ] Generate a tool; confirm it appears, runs in the sandbox, and the source is viewable.
- [ ] Free quota stops at 3 builds; the paywall opens Stripe checkout.
- [ ] Complete a test subscription; the webhook flips the account to **pro** (no quota cap).
- [ ] Your admin email sees the **Dashboard**; a normal user gets 403 on `/v1/admin/overview`.
- [ ] The old OpenRouter dev key is rotated/revoked.

---

## What's deferred (not needed for this launch)

iOS wrap (StoreKit/RevenueCat, Sign in with Apple, App Review note), Tier-2
agentic generation, and cross-device sync are Phase-2 items per the build plan.
The web runtime you ship here is the exact runtime that gets wrapped for iOS
later — so launching on the web is also de-risking the App Store entry.
