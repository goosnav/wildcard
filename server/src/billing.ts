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

async function userFromObject(obj: any): Promise<User | undefined> {
  const userId = obj?.metadata?.userId ?? obj?.client_reference_id;
  if (userId) {
    const u = await findUserById(userId);
    if (u) return u;
  }
  const customer = typeof obj?.customer === "string" ? obj.customer : undefined;
  return customer ? findUserByStripeCustomer(customer) : undefined;
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export async function handleStripeEvent(event: StripeEvent): Promise<void> {
  const obj = event.data.object;
  const user = await userFromObject(obj);
  if (!user) return; // unknown user — nothing to entitle

  switch (event.type) {
    case "checkout.session.completed": {
      await updateUser(user.id, {
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
      await updateUser(user.id, {
        plan: ACTIVE.has(obj.status) ? "pro" : "free",
        stripeSubscriptionId: obj.id ?? user.stripeSubscriptionId,
        stripeCustomerId:
          typeof obj.customer === "string" ? obj.customer : user.stripeCustomerId,
      });
      break;
    }
    case "customer.subscription.deleted": {
      await updateUser(user.id, { plan: "free" });
      break;
    }
  }
}
