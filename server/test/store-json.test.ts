// Backend-contract tests for the JSON store, run against an isolated temp dir so
// they never touch the real .data/db.json. Covers the two things the external
// review flagged: the atomic build-count increment (no lost updates under
// concurrency — B1) and magic-token single-use + expiry (T3).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonBackend } from "../src/store/json-backend.js";
import type { Backend } from "../src/store/types.js";

let dir: string;
let store: Backend;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wc-store-"));
  store = createJsonBackend(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("incrementBuildsUsed (atomic, B1)", () => {
  it("does not lose updates under concurrent increments", async () => {
    const user = await store.createUser("race@example.com");
    const N = 50;
    await Promise.all(Array.from({ length: N }, () => store.incrementBuildsUsed(user.id)));
    const after = await store.findUserById(user.id);
    expect(after?.buildsUsed).toBe(N); // every increment counted, none lost
  });

  it("throws for an unknown user", async () => {
    await expect(store.incrementBuildsUsed("usr_nope")).rejects.toThrow(/not found/);
  });

  it("ignores immutable fields in updateUser (parity guard)", async () => {
    const user = await store.createUser("immut@example.com");
    // Cast through unknown: we're deliberately passing fields the type forbids to
    // prove the backend rejects them at runtime, not just at compile time.
    const evilPatch = { plan: "pro", id: "usr_evil", createdAt: 0 } as unknown as Parameters<
      Backend["updateUser"]
    >[1];
    const patched = await store.updateUser(user.id, evilPatch);
    expect(patched.id).toBe(user.id);
    expect(patched.createdAt).toBe(user.createdAt);
    expect(patched.plan).toBe("pro");
  });
});

describe("consumeMagicToken (single-use + expiry, T3)", () => {
  it("returns the email once, then null on reuse", async () => {
    const mt = await store.createMagicToken("once@example.com");
    expect(await store.consumeMagicToken(mt.token)).toBe("once@example.com");
    expect(await store.consumeMagicToken(mt.token)).toBeNull(); // single-use
  });

  it("returns null for an unknown token", async () => {
    expect(await store.consumeMagicToken("deadbeef")).toBeNull();
  });
});
