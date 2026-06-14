import { describe, it, expect } from "vitest";
import { quotaFor, publicUser, FREE_BUILD_LIMIT } from "../src/quota.js";
import type { User } from "../src/store.js";

function user(patch: Partial<User> = {}): User {
  return {
    id: "usr_test",
    email: "a@b.com",
    plan: "free",
    buildsUsed: 0,
    createdAt: 0,
    ...patch,
  };
}

describe("quota policy", () => {
  it("a fresh free user can build, with the full allowance remaining", () => {
    const q = quotaFor(user());
    expect(q).toMatchObject({
      plan: "free",
      buildsLimit: FREE_BUILD_LIMIT,
      remaining: FREE_BUILD_LIMIT,
      canBuild: true,
    });
  });

  it("blocks the free user once the limit is spent", () => {
    const q = quotaFor(user({ buildsUsed: FREE_BUILD_LIMIT }));
    expect(q.remaining).toBe(0);
    expect(q.canBuild).toBe(false);
  });

  it("never reports negative remaining if usage overshoots", () => {
    const q = quotaFor(user({ buildsUsed: FREE_BUILD_LIMIT + 5 }));
    expect(q.remaining).toBe(0);
    expect(q.canBuild).toBe(false);
  });

  it("pro users are unlimited regardless of usage", () => {
    const q = quotaFor(user({ plan: "pro", buildsUsed: 999 }));
    expect(q).toMatchObject({ plan: "pro", buildsLimit: null, remaining: null, canBuild: true });
  });

  it("publicUser exposes identity + quota but no Stripe/internal fields", () => {
    const pub = publicUser(user({ stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x" }));
    expect(pub).toEqual({
      id: "usr_test",
      email: "a@b.com",
      quota: expect.objectContaining({ plan: "free" }),
      isAdmin: false,
    });
    expect(JSON.stringify(pub)).not.toContain("cus_x");
    expect(JSON.stringify(pub)).not.toContain("sub_x");
  });
});
