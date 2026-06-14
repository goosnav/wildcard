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

## 0. What you're running (the tech stack)

You don't install most of this by hand — `npm install` + the Dockerfile pull it.
This is just so you know what each moving part is and which you sign up for.

| Layer | Tech | You provide |
| --- | --- | --- |
| **Web app (frontend)** | React + TypeScript + Vite, installable PWA | — (built into the container) |
| **Tool sandbox** | `<iframe sandbox>` + strict CSP + the `WC.*` runtime SDK | — |
| **API server** | Node ≥20 + Hono (TypeScript) | — |
| **Tool validator** | Playwright headless **Chromium** (runs each tool before delivery) | — (in the container; needs ~1 GB RAM) |
| **Local tool storage** | Browser IndexedDB (on each user's device) | — |
| **AI generation** | OpenRouter **or** Anthropic API | an account + API key |
| **Database** | Postgres (Neon / Supabase / RDS) | a database + `DATABASE_URL` |
| **Email** | Resend (magic-link sign-in) | an account + verified domain |
| **Billing** | Stripe subscriptions + webhook | an account + product/price |
| **Hosting** | any Docker container host (Render / Railway / Fly.io / Cloud Run) | an account |
| **Domain** | your registrar (Namecheap, Cloudflare, etc.) | a domain name |

**Minimum to run it at all:** Node + an AI key. **Minimum to run it as a real
product:** add a host, Postgres, Resend (+domain), and Stripe. Account setup for
each is in **[`SETUP.md`](SETUP.md)**; hosting steps are in [§4](#4-deploy-to-a-container-host) below.

> **Why a container, not "serverless"?** The validator launches headless
> Chromium to run every generated tool before it's delivered. That needs a
> long-lived container with real memory — not a Node serverless/edge function.
> Pick a host's *Web Service / container* product, not its *Functions* product.

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

> **Running outside this image?** The validator launches Chromium with
> `channel: "chromium"`, so a non-Docker host (or a slim base image) must have
> Playwright's browser installed first: `npx playwright install --with-deps
> chromium`. Without it, generation fails at the validation step.

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

Any host that runs a Dockerfile works. The server needs Chromium, so a
**container** runtime is required — not a "Node serverless function" runtime.
Below is an exact walkthrough for **Render** (simple, has a usable starter tier,
built-in TLS + custom domains), then a quick **Railway** path and the generic
recipe for anything else.

### Option A — Render (recommended, step by step)

1. Push this repo to GitHub (you've done this) and sign in at
   <https://render.com> with that GitHub account.
2. **New ▸ Web Service** → connect the repo.
3. Configure the service:
   - **Language / Runtime:** Docker.
   - **Dockerfile Path:** `server/Dockerfile`.
   - **Docker Build Context Directory:** `.` (the repo root — the build needs all
     three workspaces).
   - **Instance Type:** at least **1 GB RAM** (Chromium needs the headroom; the
     smallest free instance may OOM during validation).
   - **Health Check Path:** `/health`.
4. **Environment ▸ Add Environment Variable** for each key from
   [`SETUP.md`](SETUP.md) — at minimum `OPENROUTER_API_KEY` + `WC_MODEL`, then
   `DATABASE_URL`, `RESEND_API_KEY`, `WC_EMAIL_FROM`, the three `STRIPE_*`,
   `WC_ADMIN_EMAILS`. Don't set `PORT` (Render injects it; the server honors it).
   Don't set `WC_WEB_DIR` (the Dockerfile already does).
5. **Create Web Service.** First build takes a few minutes (it installs browsers).
6. Render gives you a URL like `https://wildcard.onrender.com`. Set
   **`WC_APP_URL`** to exactly that (no trailing slash) and save → it redeploys.
7. Open the URL; `…/health` should return `{ ok: true, ... }`.
8. **Custom domain (optional):** Service ▸ **Settings ▸ Custom Domains ▸ Add**,
   then create the CNAME it shows at your registrar. Once it verifies, update
   `WC_APP_URL` (and `WC_EMAIL_FROM`'s domain, and the Stripe webhook URL) to the
   custom domain.

### Option B — Railway (quick)

1. <https://railway.app> → **New Project ▸ Deploy from GitHub repo**.
2. In the service settings, set the **Dockerfile path** to `server/Dockerfile`
   (root context). Bump memory to ~1 GB.
3. **Variables** tab → add the same env vars. Railway injects `PORT`.
4. **Settings ▸ Networking ▸ Generate Domain**, then set `WC_APP_URL` to it.

### Option C — anything else (Fly.io, Cloud Run, a VPS)

```bash
docker build -f server/Dockerfile -t wildcard .
docker run -p 8787:8787 --env-file .env wildcard
```
Then run that image on your host of choice. Rules that always apply: build from
the **repo root**, give it **≥1 GB RAM**, expose the port the host provides via
`PORT`, set `WC_APP_URL` to the public URL, and health-check `/health`.

> After the first successful deploy, do a smoke test against the live URL using
> the **§7 post-deploy checklist** below.

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
- [ ] `GET /health` shows `guard.buildCeiling` with your configured limit (the COGS cap).
- [ ] The old OpenRouter dev key is rotated/revoked.

---

## Spend + abuse guard (REQ-NFR-006)

The server caps spend itself, independent of per-user quota:

- **Per-user rate limits** on the costly endpoints — `WC_RL_GENERATE_PER_MIN`
  (default 5) and `WC_RL_NET_PER_MIN` (default 60). Exceeding them returns `429`
  with a `Retry-After` header.
- **Global build ceiling** — `WC_BUILD_CEILING` (default 1000 builds /
  `WC_BUILD_CEILING_PERIOD_MS`, default 24h). Since each *shipped* build is the
  unit of model spend, this hard-caps the bill even under a spike or a leaked
  credential; over the cap, generation returns `503 at_capacity`. Failed builds
  release their slot, so only real tools count. Watch `guard.buildCeiling` on
  `/health`.

> **One instance only.** These counters live in-process, which is correct for
> the single-container deploy above. If you run **multiple** instances behind a
> load balancer, each keeps its own counters, so the effective limits multiply.
> Moving to a shared store (Redis or a Postgres counter) is the change needed
> before horizontal scaling — it is intentionally deferred for the v1 slice.

---

## What's deferred (not needed for this launch)

iOS wrap (StoreKit/RevenueCat, Sign in with Apple, App Review note), Tier-2
agentic generation, and cross-device sync are Phase-2 items per the build plan.
The web runtime you ship here is the exact runtime that gets wrapped for iOS
later — so launching on the web is also de-risking the App Store entry.
