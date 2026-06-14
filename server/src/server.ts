// The v1 web API (CMP-03 surface + auth, quota, billing). /v1/generate streams
// progress + the final bundle over SSE (REQ-GEN-003). Generation is gated by
// magic-link auth and a server-enforced free-build quota (REQ-PAY-003); the
// server is the only source of truth for entitlements (REQ-NFR-006).

import "./env.js"; // load root .env before reading any secret
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { generateTool, type GenEvent } from "./generate.js";
import type { Bundle } from "@wildcard/runtime";
import { closeValidator } from "./validate.js";
import { createModel, activeProviderName } from "./provider.js";
import {
  requestMagicLink,
  verifyMagicLink,
  bearerToken,
  isValidEmail,
} from "./auth.js";
import {
  userForSession,
  deleteSession,
  incrementBuildsUsed,
  deleteUser,
  backendName,
  type User,
} from "./store.js";
import { quotaFor, publicUser, FREE_BUILD_LIMIT } from "./quota.js";
import { isAdminEmail, adminOverview, MONTHLY_PRICE_USD } from "./admin.js";
import { providerCatalog, callProvider } from "./providers.js";
import { classifyPrompt } from "./safety.js";
import { recordRefusal, moderationReport } from "./moderation.js";
import {
  generateLimiter,
  netLimiter,
  buildCeiling,
  guardStatus,
  type FixedWindow,
} from "./guard.js";
import * as stripe from "./stripe.js";
import { handleStripeEvent } from "./billing.js";
import { emailConfigured } from "./email.js";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(here, "../prompts/system.md"), "utf8");

const app = new Hono();

// Never emit a Referer (defense-in-depth for the magic-link token that rides in
// the SPA URL). Cheap blanket header on every response.
app.use("*", async (c, next) => {
  await next();
  c.header("Referrer-Policy", "no-referrer");
});

// The web shell runs on a different dev origin (Vite); allow it to call us and
// to send the Authorization header. In the single-container deploy the SPA and
// API share an origin, so CORS is moot — but if you expose the API on its own
// origin, set WC_CORS_ORIGIN to your web origin to lock it down (defaults to
// "*" for local dev / the Vite proxy).
const CORS_ORIGIN = process.env.WC_CORS_ORIGIN?.trim() || "*";
app.use(
  "/v1/*",
  cors({ origin: CORS_ORIGIN, allowHeaders: ["Content-Type", "Authorization"] })
);

app.get("/health", async (c) =>
  c.json({
    ok: true,
    provider: activeProviderName(),
    store: await backendName(),
    email: emailConfigured(),
    billing: stripe.isConfigured(),
    guard: guardStatus(),
  })
);

// --- auth ---

app.post("/v1/auth/request", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  if (!isValidEmail(email)) return c.json({ error: "a valid email is required" }, 400);
  try {
    const result = await requestMagicLink(email);
    return c.json(result);
  } catch (e) {
    console.error("[auth] magic-link send failed:", e);
    return c.json({ error: "couldn't send the sign-in link, please try again" }, 502);
  }
});

app.post("/v1/auth/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token ?? "").trim();
  const result = token ? await verifyMagicLink(token) : null;
  if (!result) return c.json({ error: "invalid or expired link" }, 401);
  return c.json({ sessionToken: result.sessionToken, user: publicUser(result.user) });
});

// Resolve the signed-in user for everything below. 401 if absent/invalid.
async function requireUser(c: Context): Promise<User | Response> {
  const tok = bearerToken(c.req.header("Authorization"));
  const user = tok ? await userForSession(tok) : undefined;
  if (!user) return c.json({ error: "sign in required" }, 401);
  return user;
}

// Coerce a client-supplied edit base into a Bundle, or undefined if it's not a
// usable shape (must have a manifest id/name and an index.html). Defensive: a
// malformed base degrades to a fresh build rather than erroring.
function parseEditBase(base: unknown): Bundle | undefined {
  if (!base || typeof base !== "object") return undefined;
  const b = base as { manifest?: unknown; files?: unknown };
  const manifest = b.manifest as Partial<Bundle["manifest"]> | undefined;
  const files = b.files as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest.id !== "string" || typeof manifest.name !== "string")
    return undefined;
  if (!files || typeof files["index.html"] !== "string") return undefined;
  // Keep only string file entries.
  const cleanFiles: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) if (typeof v === "string") cleanFiles[k] = v;
  return {
    manifest: {
      id: manifest.id,
      name: manifest.name,
      icon: typeof manifest.icon === "string" ? manifest.icon : "✨",
      version: typeof manifest.version === "number" ? manifest.version : 1,
      providers: Array.isArray(manifest.providers)
        ? manifest.providers.filter((p): p is string => typeof p === "string")
        : [],
    },
    files: cleanFiles as Bundle["files"],
  };
}

// Apply a per-user rate limit; returns a 429 Response (with Retry-After) when
// the window is exhausted, or null to proceed.
function rateLimit(c: Context, limiter: FixedWindow, userId: string): Response | null {
  const r = limiter.check(userId);
  if (r.ok) return null;
  const retryAfter = Math.ceil(r.retryAfterMs / 1000);
  c.header("Retry-After", String(retryAfter));
  return c.json({ error: "too many requests, please slow down", retryAfter }, 429);
}

app.post("/v1/auth/logout", async (c) => {
  const tok = bearerToken(c.req.header("Authorization"));
  if (tok) await deleteSession(tok);
  return c.json({ ok: true });
});

app.get("/v1/me", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  return c.json({ user: publicUser(user) });
});

// Delete the signed-in user's account and all server-side data (REQ-ACCT-004).
// Cancels any active subscription first so they stop being billed. The client is
// responsible for clearing its own local tools/IndexedDB.
app.delete("/v1/me", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (user.stripeSubscriptionId && stripe.isConfigured()) {
    await stripe.cancelSubscription(user.stripeSubscriptionId);
  }
  await deleteUser(user.id);
  return c.json({ ok: true });
});

// --- admin (allow-listed admin email) ---

// Like requireUser, but additionally checks the email allow-list. 403 otherwise,
// so a normal user can't read the roster even with a valid session.
async function requireAdmin(c: Context): Promise<User | Response> {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!isAdminEmail(user.email)) return c.json({ error: "admin only" }, 403);
  return user;
}

app.get("/v1/admin/overview", async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  return c.json(await adminOverview());
});

// Operational report for the owner: the account/revenue roll-up plus runtime
// signals — config wiring, the build-cost ceiling pressure, and a moderation
// snapshot (safety refusals since restart). One call for an at-a-glance ops view.
app.get("/v1/reports", async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  return c.json({
    generatedAt: Date.now(),
    overview: await adminOverview(),
    config: {
      provider: activeProviderName(),
      store: await backendName(),
      email: emailConfigured(),
      billing: stripe.isConfigured(),
    },
    guard: guardStatus(),
    moderation: moderationReport(),
  });
});

// Public app manifest (Doc 04 §4.7): everything the client needs to configure
// itself without hardcoding — version, the free-build allowance, price, the
// live-data catalog, and which optional features are wired. No auth, no secrets.
app.get("/v1/manifest", (c) =>
  c.json({
    version: process.env.WC_VERSION ?? process.env.npm_package_version ?? "0.0.0",
    freeBuildLimit: FREE_BUILD_LIMIT,
    priceUsd: MONTHLY_PRICE_USD,
    providers: providerCatalog(),
    features: { billing: stripe.isConfigured(), email: emailConfigured() },
  })
);

// --- data providers (server-proxied egress; REQ-RUN-005) ---

// Public catalog metadata (no secrets) so the UI can show what live data exists.
app.get("/v1/providers", (c) => c.json({ providers: providerCatalog() }));

// The proxy. A tool's WC.net.fetch(provider, params) reaches here via the host.
// Auth-gated so calls are attributable + rate-limitable; the fixed catalog means
// a tool can only ever reach a vetted upstream, never an arbitrary origin.
app.post("/v1/net/:provider", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const limited = rateLimit(c, netLimiter, user.id);
  if (limited) return limited;
  const id = c.req.param("provider");
  const body = await c.req.json().catch(() => ({}));
  const params = (body?.params ?? {}) as Record<string, unknown>;
  const result = await callProvider(id, params);
  if (result.ok) return c.json({ data: result.data });
  return c.json({ error: result.error }, result.status as 400 | 404 | 502);
});

// --- generation (auth + quota gated) ---

app.post("/v1/generate", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const limited = rateLimit(c, generateLimiter, user.id);
  if (limited) return limited;

  const quota = quotaFor(user);
  if (!quota.canBuild) {
    return c.json(
      { error: "free build limit reached", reason: "free_limit", quota },
      402
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  if (prompt.length > 4000)
    return c.json({ error: "that prompt is too long — please shorten it" }, 400);

  // Optional edit context (REQ-EDIT-003): the client may send the current tool
  // bundle so this generation EDITS it instead of building from scratch. Coerce
  // it defensively — a bad shape just falls back to a fresh build.
  const editBase = parseEditBase(body.base);

  // Input safety (CMP-12): refuse clearly-harmful requests before spending any
  // tokens, quota, or a ceiling slot. Reuse the normal SSE failure path so the
  // client renders the honest message exactly like any other unbuildable result.
  const verdict = classifyPrompt(prompt);
  if (!verdict.allowed) {
    recordRefusal("input", verdict.category ?? "unknown");
    console.warn(`[safety] refused a "${verdict.category}" prompt for user ${user.id}`);
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "failed",
        data: JSON.stringify({ type: "failed", reason: verdict.message }),
      });
      await stream.writeSSE({
        event: "result",
        data: JSON.stringify({ ok: false, reason: verdict.message, quota: quotaFor(user) }),
      });
    });
  }

  // Global COGS backstop: reserve a build slot before spending any model tokens.
  // If the period is full we shed load rather than blow the budget (REQ-NFR-006).
  if (!buildCeiling.tryReserve()) {
    return c.json(
      { error: "the service is at capacity right now, please try again later", reason: "at_capacity" },
      503
    );
  }

  const model = createModel();

  return streamSSE(c, async (stream) => {
    const send = (e: GenEvent) =>
      stream.writeSSE({ event: e.type, data: JSON.stringify(e) });

    let committed = false;
    try {
      const result = await generateTool({
        prompt,
        system: SYSTEM_PROMPT,
        model,
        onEvent: send,
        editBase,
      });

      // Quota is spent only on a tool we actually ship — failed builds are free.
      let quotaAfter = quotaFor(user);
      if (result.ok) {
        committed = true; // keep the reserved ceiling slot for a real build
        const updated = await incrementBuildsUsed(user.id);
        quotaAfter = quotaFor(updated);
      }

      await stream.writeSSE({
        event: "result",
        data: JSON.stringify(
          result.ok
            ? {
                ok: true,
                manifest: result.bundle!.manifest,
                files: result.bundle!.files,
                quota: quotaAfter,
              }
            : { ok: false, reason: result.reason, quota: quotaAfter }
        ),
      });
    } finally {
      // Any non-shipping outcome (failed build OR a thrown error) returns the
      // reserved slot so transient failures don't permanently shrink the budget.
      if (!committed) buildCeiling.release();
    }
  });
});

// --- billing ---

app.post("/v1/billing/checkout", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!stripe.isConfigured()) {
    return c.json({ error: "billing is not set up yet", reason: "billing_unconfigured" }, 503);
  }
  try {
    const url = await stripe.createCheckoutSession(user);
    return c.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "checkout failed";
    return c.json({ error: message }, 502);
  }
});

// Open the Stripe Billing Portal so a subscriber can manage or cancel their plan.
app.post("/v1/billing/portal", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!stripe.isConfigured()) {
    return c.json({ error: "billing is not set up yet", reason: "billing_unconfigured" }, 503);
  }
  if (!user.stripeCustomerId) {
    return c.json({ error: "no subscription to manage", reason: "no_customer" }, 409);
  }
  try {
    const url = await stripe.createBillingPortalSession(user.stripeCustomerId);
    return c.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not open billing portal";
    return c.json({ error: message }, 502);
  }
});

// Stripe webhook — unauthenticated but signature-verified against the raw body.
app.post("/v1/billing/webhook", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("Stripe-Signature") ?? null;
  if (!stripe.verifyWebhookSignature(raw, sig)) {
    return c.json({ error: "bad signature" }, 400);
  }
  try {
    await handleStripeEvent(stripe.parseEvent(raw));
  } catch (e) {
    console.error("[billing] webhook handler error:", e);
  }
  return c.json({ received: true });
});

// Optionally serve the built web app from this same server (set WC_WEB_DIR to the
// host-web/dist directory, relative to the process CWD). This makes one container
// the whole product: the API and the SPA share an origin, so there's no CORS and
// no API-base config — the client's relative /v1 calls just work. Mounted last so
// API routes always win. Unknown non-API paths fall back to index.html (SPA).
const WEB_DIR = process.env.WC_WEB_DIR;
if (WEB_DIR) {
  const indexPath = `${WEB_DIR.replace(/\/$/, "")}/index.html`;
  if (!existsSync(indexPath)) {
    console.warn(`[web] WC_WEB_DIR set but ${indexPath} not found — not serving static UI`);
  } else {
    const indexHtml = readFileSync(indexPath, "utf8");
    // Serve real static files (assets, manifest, icons). On a miss, serveStatic
    // falls through to the not-found handler below.
    app.use("/*", serveStatic({ root: WEB_DIR }));
    // Unmatched paths: API routes get an honest JSON 404; everything else gets
    // the SPA shell so client-side routes (and deep links) resolve to the app.
    app.notFound((c) =>
      c.req.path.startsWith("/v1") || c.req.path === "/health"
        ? c.json({ error: "not found" }, 404)
        : c.html(indexHtml)
    );
    console.log(`[web] serving the web app from ${WEB_DIR}`);
  }
}

// The configured Hono app, exported so route-level tests can call app.request()
// without binding a socket. The network listener + lifecycle below only run when
// this module is the process entrypoint (not when imported by a test).
export { app };

const isEntrypoint =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 8787);
  const server = serve({ fetch: app.fetch, port });
  backendName().then((store) =>
    console.log(
      `Wild Card generation server on http://localhost:${port} ` +
        `(provider: ${activeProviderName()}, store: ${store})`
    )
  );

  // Graceful shutdown: close the headless Chromium the validator manages (an
  // otherwise-unmanaged subprocess) and stop accepting connections, so a
  // container stop/redeploy doesn't leak a browser process.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — closing validator + server`);
    try {
      await closeValidator();
    } catch (e) {
      console.error("[shutdown] validator close failed:", e);
    }
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
