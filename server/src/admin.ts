// The owner-facing admin layer. Access is gated by an allow-list of admin emails
// (WC_ADMIN_EMAILS, comma-separated) checked against the signed-in user's email,
// so an admin signs in with the same magic link as everyone else — no separate
// password to manage. The overview is a read-only roll-up of accounts + revenue
// for a master dashboard. Stripe's own dashboard remains the authoritative source
// for payments; this is the at-a-glance view over *our* user records.

import { listUsers, type User } from "./store.js";

/** Recurring price in USD — used to estimate MRR from the pro-subscriber count.
 *  Keep in sync with the Stripe price behind STRIPE_PRICE_ID. */
export const MONTHLY_PRICE_USD = 9.99;

/** Lower-cased set of admin emails from WC_ADMIN_EMAILS (comma/space separated). */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.WC_ADMIN_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().has(email.toLowerCase());
}

export interface AdminUserRow {
  id: string;
  email: string;
  plan: User["plan"];
  buildsUsed: number;
  createdAt: number;
  subscribed: boolean; // has an active Stripe subscription id on record
}

export interface AdminOverview {
  generatedAt: number;
  stats: {
    totalUsers: number;
    freeUsers: number;
    proUsers: number;
    subscribedUsers: number; // pro AND has a Stripe subscription id
    totalBuilds: number;
    signupsLast7d: number;
    estimatedMrrUsd: number; // proUsers * MONTHLY_PRICE_USD
  };
  priceUsd: number;
  users: AdminUserRow[];
}

export async function adminOverview(): Promise<AdminOverview> {
  const users = await listUsers(); // newest first
  const proUsers = users.filter((u) => u.plan === "pro");
  const subscribedUsers = proUsers.filter((u) => !!u.stripeSubscriptionId);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return {
    generatedAt: Date.now(),
    stats: {
      totalUsers: users.length,
      freeUsers: users.length - proUsers.length,
      proUsers: proUsers.length,
      subscribedUsers: subscribedUsers.length,
      totalBuilds: users.reduce((sum, u) => sum + u.buildsUsed, 0),
      signupsLast7d: users.filter((u) => u.createdAt >= weekAgo).length,
      estimatedMrrUsd: Number((proUsers.length * MONTHLY_PRICE_USD).toFixed(2)),
    },
    priceUsd: MONTHLY_PRICE_USD,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      plan: u.plan,
      buildsUsed: u.buildsUsed,
      createdAt: u.createdAt,
      subscribed: !!u.stripeSubscriptionId,
    })),
  };
}
