// Quota policy + the safe view of a user we expose to the client. The server is
// the only source of truth for buildsUsed and plan (REQ-PAY-003, REQ-NFR-006);
// the client renders whatever /v1/me returns but can never grant itself builds.

import type { User, Plan } from "./store.js";
import { isAdminEmail } from "./admin.js";

export const FREE_BUILD_LIMIT = 3;

export interface Quota {
  plan: Plan;
  buildsUsed: number;
  /** null = unlimited (pro). */
  buildsLimit: number | null;
  /** null = unlimited (pro). */
  remaining: number | null;
  canBuild: boolean;
}

export function quotaFor(user: User): Quota {
  if (user.plan === "pro") {
    return {
      plan: "pro",
      buildsUsed: user.buildsUsed,
      buildsLimit: null,
      remaining: null,
      canBuild: true,
    };
  }
  const remaining = Math.max(0, FREE_BUILD_LIMIT - user.buildsUsed);
  return {
    plan: "free",
    buildsUsed: user.buildsUsed,
    buildsLimit: FREE_BUILD_LIMIT,
    remaining,
    canBuild: remaining > 0,
  };
}

/** The client-safe shape of a user: identity + quota, no Stripe/internal ids.
 *  `isAdmin` lets the web app reveal the admin link; the server still re-checks
 *  the allow-list on every admin request, so this flag is not a trust boundary. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    quota: quotaFor(user),
    isAdmin: isAdminEmail(user.email),
  };
}
