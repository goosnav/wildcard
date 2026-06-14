// Minimal Stripe client over fetch — no SDK, to keep deps lean. Two operations:
//   - createCheckoutSession(): start a $9.99/mo subscription checkout.
//   - verifyWebhookSignature() + parseEvent(): trust inbound webhooks.
// All of it degrades gracefully: if STRIPE_* env is missing, isConfigured() is
// false and the routes return a friendly "billing not set up" instead of 500.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "./store.js";

const API = "https://api.stripe.com/v1";

const SECRET = () => process.env.STRIPE_SECRET_KEY ?? "";
const PRICE = () => process.env.STRIPE_PRICE_ID ?? "";
const WEBHOOK_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET ?? "";
const APP_URL = () => process.env.WC_APP_URL ?? "http://localhost:5173";

export function isConfigured(): boolean {
  return Boolean(SECRET() && PRICE());
}

async function stripePost(
  path: string,
  form: Record<string, string>
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/** Create a subscription Checkout Session and return its hosted URL. */
export async function createCheckoutSession(user: User): Promise<string> {
  const form: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": PRICE(),
    "line_items[0][quantity]": "1",
    success_url: `${APP_URL()}/?checkout=success`,
    cancel_url: `${APP_URL()}/?checkout=cancel`,
    client_reference_id: user.id,
    "metadata[userId]": user.id,
    // Tie the subscription's customer back to this user for the webhook.
    "subscription_data[metadata][userId]": user.id,
  };
  if (user.stripeCustomerId) form.customer = user.stripeCustomerId;
  else form.customer_email = user.email;

  const session = await stripePost("/checkout/sessions", form);
  return session.url as string;
}

/** Create a Billing Portal session so a subscriber can manage or cancel their
 *  plan and update payment details. Requires a known Stripe customer id. */
export async function createBillingPortalSession(customerId: string): Promise<string> {
  const session = await stripePost("/billing_portal/sessions", {
    customer: customerId,
    return_url: `${APP_URL()}/`,
  });
  return session.url as string;
}

/** Best-effort cancel of a subscription (used when a user deletes their account
 *  so they stop being billed). Swallows errors — account deletion proceeds even
 *  if the cancel call fails, and the webhook will reconcile. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  try {
    const res = await fetch(`${API}/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SECRET()}` },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.error(`[billing] cancel subscription failed: ${j?.error?.message ?? res.status}`);
    }
  } catch (e) {
    console.error("[billing] cancel subscription error:", e);
  }
}

export interface StripeEvent {
  type: string;
  data: { object: any };
}

/** Verify a Stripe-Signature header against the raw request body. */
export function verifyWebhookSignature(rawBody: string, sigHeader: string | null): boolean {
  const secret = WEBHOOK_SECRET();
  if (!secret || !sigHeader) return false;

  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseEvent(rawBody: string): StripeEvent {
  return JSON.parse(rawBody) as StripeEvent;
}
