# Wild Card — Connect-the-Services Setup Guide

This is the **human checklist**: the accounts you create yourself, the keys you copy,
and exactly where each one goes so the running app picks it up. Everything the app
needs is read from **environment variables** (one `.env` file locally, or your host's
"Environment Variables" settings panel in production).

> **How the app reads config.** The server reads a single set of env vars at startup
> (loaded from the repo-root `.env` in local/dev via `server/src/env.js`, or from your
> host's env panel in production). There is no database of settings and no admin form —
> **setting an env var and restarting the server is how you "connect" a service.**
> `GET /health` reports which services are wired (`provider`, `store`, `email`,
> `billing`) so you can confirm each step.

You do **not** need all of these to run. The app boots with **zero** of them (JSON file
store, console-logged sign-in links, no billing). Add each service when you want that
capability. Recommended order is top to bottom.

---

## 0. Before you start

- You have the repo checked out and `npm install` has run at the root.
- Copy the template once: `cp .env.example .env`. You'll fill it in as you go.
- After editing `.env`, **restart the server** for changes to take effect.
- Quick health check any time:
  ```bash
  curl -s http://localhost:8787/health | python3 -m json.tool
  ```
  You want to watch these flip to `true` / real values as you connect things:
  `{ "provider": "...", "store": "json|postgres", "email": false|true, "billing": false|true }`

---

## 1. AI provider — the model that writes the tools (REQUIRED)

Without this the app can't generate anything. Two options; **OpenRouter is recommended**
(one key, lets you switch models with a string).

### Option A — OpenRouter (recommended)

1. Go to <https://openrouter.ai> and sign up.
2. Add a little credit (Billing → add ~$5–10 to start). Generation costs a few cents each
   with a paid model; there are also **free** models for testing.
3. Create a key: **Keys → Create Key**. Copy it (starts with `sk-or-...`).
4. Put it in `.env`:
   ```bash
   OPENROUTER_API_KEY=sk-or-...
   WC_MODEL=anthropic/claude-sonnet-4      # the workhorse model (good quality)
   # For cost-free testing instead, use a free model:
   # WC_MODEL=openai/gpt-oss-120b:free
   ```
5. Restart. `GET /health` should show `"provider": "openrouter"`.

> **Free vs paid:** `:free` models are heavily rate-limited and lower quality — fine for
> smoke-testing the pipeline, not for real users. Use a paid model (`anthropic/claude-sonnet-4`)
> for production.

### Option B — Anthropic directly

1. Go to <https://console.anthropic.com>, sign up, add billing.
2. **API Keys → Create Key**, copy it (starts with `sk-ant-...`).
3. In `.env`:
   ```bash
   WC_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   WC_MODEL=claude-sonnet-4-6              # note: bare id, not the namespaced slug
   ```
4. Restart; `GET /health` shows `"provider": "anthropic"`.

> **Cost control is already built in.** The server caps spend with a per-period build
> ceiling (`WC_BUILD_CEILING`, default 1000 builds/24h) and per-user rate limits. Tune
> them in `.env` (see `.env.example`, "Spend + abuse guard"). Set `WC_LOG_USAGE=1` to log
> token usage + prompt-cache hit rate.

---

## 2. Database — Postgres (recommended for any real deployment)

Without `DATABASE_URL` the app stores users/sessions in a local JSON file
(`server/.data/db.json`). That's fine for local dev, but **a real deployment needs
Postgres** (a redeploy wipes the container's local file). **Neon is the easiest.**

### Neon (recommended)

1. Go to <https://neon.tech>, sign up, **Create a project** (pick a region near your host).
2. On the project dashboard, copy the **connection string** (Dashboard → Connection
   Details). It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
3. In `.env`:
   ```bash
   DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
4. **You don't run any migration** — the server creates its tables automatically on first
   connect. Verify the connection end-to-end with the smoke script:
   ```bash
   npm --workspace @wildcard/server run store:smoke
   ```
   It runs a full user/token/session lifecycle against your real DB and prints `postgres`.
5. Restart; `GET /health` shows `"store": "postgres"`.

### Supabase (alternative)

Same idea: create a project at <https://supabase.com>, then **Project Settings → Database
→ Connection string → URI**, and paste it as `DATABASE_URL`. (Use the connection-pooler
URI if your host opens many short-lived connections.)

> **TLS note.** Hosted Postgres is encrypted by default; the app doesn't verify the
> server certificate out of the box (many providers present chains Node won't verify).
> To harden against a man-in-the-middle on the DB link, set `WC_DB_SSL_STRICT=1`, or pin
> the provider's CA with `WC_DB_CA_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"`.

---

## 3. Email — magic-link sign-in via Resend

Without a Resend key, the server **logs the sign-in link to the console** and the UI
shows a one-tap "Continue (dev)" button — great for local dev, not for real users. To
actually email links:

1. Go to <https://resend.com>, sign up.
2. **Verify a sending domain** (Resend → **Domains → Add Domain**). Resend gives you DNS
   records (SPF/DKIM, usually a few `TXT`/`CNAME` entries). Add them at your domain
   registrar (where you bought the domain) and click **Verify**. This is required for
   reliable delivery; the unverified `onboarding@resend.dev` sender is test-only.
3. **API Keys → Create API Key**, copy it (starts with `re_...`).
4. In `.env`:
   ```bash
   RESEND_API_KEY=re_...
   WC_EMAIL_FROM=Wild Card <login@yourdomain.com>   # the address MUST be on the verified domain
   ```
5. Restart; `GET /health` shows `"email": true`. Send yourself a sign-in link to confirm
   it arrives.

> **Security behavior:** once a Resend key is set, a send **failure returns an error to
> the client instead of falling back to showing the link** — so a misconfigured domain
> fails loudly rather than leaking the magic link. If you see 502s on sign-in, your
> `WC_EMAIL_FROM` domain probably isn't verified yet.

---

## 4. Billing — Stripe subscriptions

This unlocks the paywall (free users hit the build limit → "Upgrade" → Stripe Checkout →
they become **pro** = unlimited). You need a **product with a recurring price**, your
**API key**, and a **webhook** so Stripe can tell the app when someone subscribes.

### 4a. Create the product + price

1. Go to <https://dashboard.stripe.com>, sign up. Stay in **Test mode** (toggle, top
   right) until you've verified the whole flow.
2. **Product catalog → Add product.**
   - Name: e.g. "Wild Card Pro".
   - Pricing: **Recurring**, **Monthly**, amount **$9.99** (or your price).
   - Save. Click the price and copy its **Price ID** (starts with `price_...`).

   > The app's MRR estimate uses a constant `MONTHLY_PRICE_USD = 9.99` in
   > `server/src/admin.ts`. If you pick a different price, update that constant so the
   > admin dashboard's revenue number is accurate (it does **not** affect what Stripe
   > actually charges — Stripe's price is the source of truth).

### 4b. Get your API key

3. **Developers → API keys → Secret key**, reveal and copy it (`sk_test_...` in test mode,
   `sk_live_...` in live mode).
4. In `.env`:
   ```bash
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRICE_ID=price_...
   ```
5. Restart; `GET /health` shows `"billing": true` (true once SECRET + PRICE are both set).

### 4c. Wire the webhook (so subscriptions actually flip accounts to pro)

The app exposes `POST /v1/billing/webhook`. Stripe must call it.

6. **Developers → Webhooks → Add endpoint.**
   - **Endpoint URL:** `https://YOUR-DOMAIN/v1/billing/webhook`
     (your deployed server's public URL — see §5).
   - **Events to send** — select exactly these three:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Add endpoint, then **reveal the Signing secret** (starts with `whsec_...`).
7. In `.env`:
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
8. Restart. The webhook signature is verified on every call, so this secret must match.

#### Testing the webhook locally (optional)

Use the Stripe CLI to forward events to your local server without a public URL:
```bash
stripe login
stripe listen --forward-to localhost:8787/v1/billing/webhook
# It prints a whsec_... — use THAT as STRIPE_WEBHOOK_SECRET while testing locally.
stripe trigger checkout.session.completed
```

### 4d. Going live

When the test flow works end to end: flip Stripe to **Live mode**, recreate the product/
price (or copy it to live), swap to the **live** `sk_live_...` key and a **live** webhook
endpoint + its `whsec_...`, and update `.env` in production.

---

## 5. Your domain + public URL

The magic-link emails and Stripe redirects need to know your app's public address.

1. Point your domain at your host (see `DEPLOY.md` §4 for host specifics). In the single-
   container deploy, the **same** server serves the web app and the API on one origin.
2. In `.env`:
   ```bash
   WC_APP_URL=https://app.yourdomain.com     # exact public origin, no trailing slash
   ```
   - This is used to build the `?token=...` sign-in links and Stripe's success/cancel
     redirect URLs. If it's wrong, sign-in links and post-checkout redirects break.
3. If you ever run the API on a **different** origin than the web app, also set
   `WC_CORS_ORIGIN=https://app.yourdomain.com` to lock down cross-origin calls. In the
   single-container deploy you can leave it unset.

---

## 6. Admin access (the owner dashboard)

The dashboard at the **Dashboard** button (roster + MRR roll-up) is gated by an email
allow-list — no separate admin password. An admin signs in with the same magic link as
anyone else; the server checks their email against the list on every admin request.

```bash
WC_ADMIN_EMAILS=you@yourdomain.com,partner@yourdomain.com   # comma-separated
```

Restart, sign in with one of those emails, and the **Dashboard** button appears. Everyone
else gets a 403 on `/v1/admin/overview`.

---

## 7. The complete `.env` (production example)

```bash
# --- AI provider (required) ---
OPENROUTER_API_KEY=sk-or-...
WC_MODEL=anthropic/claude-sonnet-4

# --- Database ---
DATABASE_URL=postgresql://USER:PASSWORD@host/db?sslmode=require

# --- Email ---
RESEND_API_KEY=re_...
WC_EMAIL_FROM=Wild Card <login@yourdomain.com>

# --- Billing ---
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# --- App identity / access ---
WC_APP_URL=https://app.yourdomain.com
WC_ADMIN_EMAILS=you@yourdomain.com

# --- Optional knobs (sane defaults; see .env.example for the full list) ---
# WC_BUILD_CEILING=1000          # max tools generated per 24h across all users (COGS cap)
# WC_RL_GENERATE_PER_MIN=5       # per-user generation rate limit
# WC_LOG_USAGE=1                 # log token usage + cache hit rate
# WC_VERSION=1.0.0               # shown in the app footer + /v1/manifest
```

In production you typically **don't** commit `.env` — instead paste these into your host's
Environment Variables panel. The Docker image also sets `WC_WEB_DIR` for you (see `DEPLOY.md`).

> **Never commit a real `.env`.** It's gitignored. Keys belong only in `.env` (local) or
> your host's env panel (prod) — never in client code or a tool bundle.

---

## 8. Deploy & connect them

The mechanics of building the container, provisioning the host, and pointing DNS are in
**`DEPLOY.md`**. The short version:

```bash
docker build -f server/Dockerfile -t wildcard .
docker run -p 8787:8787 --env-file .env wildcard
```

…or set the same env vars in your host's panel and deploy. One container serves both the
web app and the API.

---

## 9. Post-setup verification checklist

Run these in order against your deployed URL:

- [ ] `GET /health` → `{ ok: true, provider, store: "postgres", email: true, billing: true, guard: {...} }`
- [ ] Sign in with a magic link — confirm the email actually arrives (via Resend).
- [ ] Generate a tool — it appears on the grid, runs in the sandbox, and the **Source**
      tab shows its code (and lets you edit + Save & Run).
- [ ] **Edit with AI** on a tool — describe a change, confirm it re-runs in place.
- [ ] Free quota stops at 3 builds; the paywall opens Stripe Checkout.
- [ ] Complete a **test** subscription → the webhook flips your account to **pro**
      (unlimited builds). Check **Developers → Webhooks** in Stripe shows 200s.
- [ ] Your admin email sees the **Dashboard**; a normal user gets 403.
- [ ] `GET /v1/manifest` returns version, free limit, price, and the live-data providers.
- [ ] Rotate/disable any test keys you no longer need.

---

## 10. Rough costs & free tiers

| Service | Free tier | Then |
|---|---|---|
| OpenRouter | free models (rate-limited) | pay-as-you-go; ~a few ¢ per generated tool with Sonnet, lowered by prompt caching |
| Neon Postgres | generous free tier | usage-based |
| Resend | ~3k emails/mo free | paid tiers above that |
| Stripe | no monthly fee | ~2.9% + 30¢ per charge |
| Host (Fly/Render/Railway) | small free/hobby tiers | a few $/mo for an always-on container |

A couple-hundred subscribers at $9.99 covers infra + model costs comfortably; the build
ceiling + caching keep the model bill bounded even under a spike.

---

## 11. If something doesn't connect

- **`provider` wrong / generation fails:** key missing or `WC_MODEL` typo'd. Check the
  server startup log line (`provider: ..., store: ...`).
- **`store` still `json`:** `DATABASE_URL` not set or unreachable — run `store:smoke`.
- **Sign-in returns 502:** Resend key set but `WC_EMAIL_FROM` domain not verified.
- **Subscriptions don't flip to pro:** webhook URL wrong, wrong events selected, or
  `STRIPE_WEBHOOK_SECRET` mismatched. Check the webhook's delivery log in Stripe.
- **Post-checkout redirect 404s:** `WC_APP_URL` wrong (trailing slash, http vs https).
- **Dashboard missing for you:** your email isn't in `WC_ADMIN_EMAILS` (case-insensitive,
  comma-separated) — restart after changing it.
