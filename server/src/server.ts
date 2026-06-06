// The v1 web API (CMP-03 surface + auth, quota, billing). /v1/generate streams
// progress + the final bundle over SSE (REQ-GEN-003). Generation is gated by
// magic-link auth and a server-enforced free-build quota (REQ-PAY-003); the
// server is the only source of truth for entitlements (REQ-NFR-006).

import "./env.js"; // load root .env before reading any secret
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateTool, type GenEvent } from "./generate.js";
import { createModel, activeProviderName } from "./provider.js";
import {
  requestMagicLink,
  verifyMagicLink,
  bearerToken,
  isValidEmail,
} from "./auth.js";
import { userForSession, deleteSession, updateUser, type User } from "./store.js";
import { quotaFor, publicUser } from "./quota.js";
import * as stripe from "./stripe.js";
import { handleStripeEvent } from "./billing.js";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(here, "../prompts/system.md"), "utf8");

const app = new Hono();

// The web shell runs on a different dev origin (Vite); allow it to call us and
// to send the Authorization header.
app.use("/v1/*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));

app.get("/health", (c) =>
  c.json({ ok: true, provider: activeProviderName(), billing: stripe.isConfigured() })
);

// --- auth ---

app.post("/v1/auth/request", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  if (!isValidEmail(email)) return c.json({ error: "a valid email is required" }, 400);
  const result = await requestMagicLink(email);
  return c.json(result);
});

app.post("/v1/auth/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token ?? "").trim();
  const result = token ? verifyMagicLink(token) : null;
  if (!result) return c.json({ error: "invalid or expired link" }, 401);
  return c.json({ sessionToken: result.sessionToken, user: publicUser(result.user) });
});

// Resolve the signed-in user for everything below. 401 if absent/invalid.
async function requireUser(c: any): Promise<User | Response> {
  const tok = bearerToken(c.req.header("Authorization"));
  const user = tok ? userForSession(tok) : undefined;
  if (!user) return c.json({ error: "sign in required" }, 401);
  return user;
}

app.post("/v1/auth/logout", (c) => {
  const tok = bearerToken(c.req.header("Authorization"));
  if (tok) deleteSession(tok);
  return c.json({ ok: true });
});

app.get("/v1/me", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  return c.json({ user: publicUser(user) });
});

// --- generation (auth + quota gated) ---

app.post("/v1/generate", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

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

  const model = createModel();

  return streamSSE(c, async (stream) => {
    const send = (e: GenEvent) =>
      stream.writeSSE({ event: e.type, data: JSON.stringify(e) });

    const result = await generateTool({
      prompt,
      system: SYSTEM_PROMPT,
      model,
      onEvent: send,
    });

    // Quota is spent only on a tool we actually ship — failed builds are free.
    let quotaAfter = quotaFor(user);
    if (result.ok) {
      const updated = updateUser(user.id, { buildsUsed: user.buildsUsed + 1 });
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

// Stripe webhook — unauthenticated but signature-verified against the raw body.
app.post("/v1/billing/webhook", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("Stripe-Signature") ?? null;
  if (!stripe.verifyWebhookSignature(raw, sig)) {
    return c.json({ error: "bad signature" }, 400);
  }
  try {
    handleStripeEvent(stripe.parseEvent(raw));
  } catch (e) {
    console.error("[billing] webhook handler error:", e);
  }
  return c.json({ received: true });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`Wild Card generation server on http://localhost:${port}`);
