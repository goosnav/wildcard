// Smoke test for whichever store backend is configured. With no DATABASE_URL it
// exercises the JSON file backend; with DATABASE_URL set it runs the SAME
// lifecycle against your real Postgres (Neon/Supabase/etc) — the one-command way
// to confirm the connection, TLS, and schema bootstrap all work before deploy.
//
//   Local JSON:  npm --workspace @wildcard/server run store:smoke
//   Postgres:    DATABASE_URL=postgres://… npm --workspace @wildcard/server run store:smoke
//
// It creates a throwaway user under a unique email, drives the magic-link +
// session + Stripe-entitlement paths, asserts each step, and reports the active
// backend. It does not delete the row (so you can eyeball it), but the email is
// timestamped so reruns don't collide.

import "../src/env.js";
import {
  backendName,
  upsertUser,
  findUserByEmail,
  findUserById,
  updateUser,
  findUserByStripeCustomer,
  listUsers,
  createMagicToken,
  consumeMagicToken,
  createSession,
  userForSession,
  deleteSession,
} from "../src/store.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok  ${msg}`);
}

async function main() {
  const backend = await backendName();
  console.log(`\nStore smoke test — backend: ${backend}\n`);

  const email = `smoke+${Date.now()}@wildcard.test`;

  // users
  const created = await upsertUser(email);
  assert(created.email === email && created.plan === "free", "upsertUser creates a free user");
  const again = await upsertUser(email);
  assert(again.id === created.id, "upsertUser is idempotent for the same email");
  assert((await findUserByEmail(email))?.id === created.id, "findUserByEmail");
  assert((await findUserById(created.id))?.email === email, "findUserById");

  // magic-link single-use
  const mt = await createMagicToken(email);
  assert((await consumeMagicToken(mt.token)) === email, "consumeMagicToken returns email once");
  assert((await consumeMagicToken(mt.token)) === null, "consumeMagicToken is single-use");

  // sessions
  const sess = await createSession(created.id);
  assert((await userForSession(sess.token))?.id === created.id, "userForSession resolves user");
  await deleteSession(sess.token);
  assert((await userForSession(sess.token)) === undefined, "deleteSession invalidates session");

  // entitlement update (Stripe path)
  const cust = `cus_smoke_${Date.now()}`;
  const upgraded = await updateUser(created.id, {
    plan: "pro",
    buildsUsed: 2,
    stripeCustomerId: cust,
    stripeSubscriptionId: "sub_smoke",
  });
  assert(upgraded.plan === "pro" && upgraded.buildsUsed === 2, "updateUser applies patch");
  assert(
    (await findUserByStripeCustomer(cust))?.id === created.id,
    "findUserByStripeCustomer"
  );

  // admin roster includes our user
  const all = await listUsers();
  assert(all.some((u) => u.id === created.id), "listUsers includes the new user");
  assert(
    all.every((u, i) => i === 0 || all[i - 1].createdAt >= u.createdAt),
    "listUsers is newest-first"
  );

  console.log(`\nAll store operations passed on the "${backend}" backend.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  });
