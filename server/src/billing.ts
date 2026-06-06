// Applies verified Stripe webhook events to user entitlements. Kept separate from
// the Stripe transport (stripe.ts) so the store-mutation policy lives in one place.
// Maps an event back to a user by metadata.userId first, then by Stripe customer id.

import {
  findUserById,
  findUserByStripeCustomer,
  updateUser,
  type User,
} from "./store.js";
import type { StripeEvent } from "./stripe.js";

function userFromObject(obj: any): User | undefined {
  const userId = obj?.metadata?.userId ?? obj?.client_reference_id;
  if (userId) {
    const u = findUserById(userId);
    if (u) return u;
  }
  const customer = typeof obj?.customer === "string" ? obj.customer : undefined;
  return customer ? findUserByStripeCustomer(customer) : undefined;
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export function handleStripeEvent(event: StripeEvent): void {
  const obj = event.data.object;
  const user = userFromObject(obj);
  if (!user) return; // unknown user — nothing to entitle

  switch (event.type) {
    case "checkout.session.completed": {
      updateUser(user.id, {
        plan: "pro",
        stripeCustomerId:
          typeof obj.customer === "string" ? obj.customer : user.stripeCustomerId,
        stripeSubscriptionId:
          typeof obj.subscription === "string"
            ? obj.subscription
            : user.stripeSubscriptionId,
      });
      break;
    }
    case "customer.subscription.updated": {
      updateUser(user.id, {
        plan: ACTIVE.has(obj.status) ? "pro" : "free",
        stripeSubscriptionId: obj.id ?? user.stripeSubscriptionId,
        stripeCustomerId:
          typeof obj.customer === "string" ? obj.customer : user.stripeCustomerId,
      });
      break;
    }
    case "customer.subscription.deleted": {
      updateUser(user.id, { plan: "free" });
      break;
    }
  }
}
