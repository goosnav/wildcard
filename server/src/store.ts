// Persistence facade. Selects a backend once (Postgres if DATABASE_URL is set,
// else the zero-dependency JSON file) and exposes a small async API over it.
// Source of truth for entitlements + quota (REQ-PAY-003, REQ-NFR-006): the
// server owns buildsUsed and plan; the client can never grant itself builds.
// No caller touches a backend directly, so adding/swapping backends stays here.

import { randomBytes } from "node:crypto";
import { type Backend } from "./store/types.js";
import { createJsonBackend } from "./store/json-backend.js";
import { createPgBackend } from "./store/pg-backend.js";

export type { Plan, User, MagicToken, Session } from "./store/types.js";

// Initialize the backend once. Postgres needs an async schema bootstrap, so the
// whole thing is memoized behind a promise; every call awaits the same init.
let backendPromise: Promise<Backend> | null = null;

function backend(): Promise<Backend> {
  if (!backendPromise) {
    const url = process.env.DATABASE_URL?.trim();
    backendPromise = url ? createPgBackend(url) : Promise.resolve(createJsonBackend());
  }
  return backendPromise;
}

/** Which backend is active ("json" | "postgres"), for /health + startup logs.
 *  Triggers initialization if it hasn't happened yet. */
export async function backendName(): Promise<string> {
  return (await backend()).name;
}

/** Random opaque token (magic links + sessions). */
export function token(): string {
  return randomBytes(24).toString("hex");
}

// --- users ---

export async function findUserByEmail(email: string) {
  return (await backend()).findUserByEmail(email);
}

export async function findUserById(userId: string) {
  return (await backend()).findUserById(userId);
}

export async function findUserByStripeCustomer(customerId: string) {
  return (await backend()).findUserByStripeCustomer(customerId);
}

export async function createUser(email: string) {
  return (await backend()).createUser(email);
}

/** Find by email or create — the sign-in upsert. */
export async function upsertUser(email: string) {
  const b = await backend();
  return (await b.findUserByEmail(email)) ?? (await b.createUser(email));
}

/** Apply a patch to a stored user and persist. Returns the updated user. */
export async function updateUser(userId: string, patch: Partial<import("./store/types.js").User>) {
  return (await backend()).updateUser(userId, patch);
}

/** Atomically increment a user's build count. Use this (not updateUser) to spend
 *  a build, so concurrent generations can't lose an increment (quota integrity). */
export async function incrementBuildsUsed(userId: string) {
  return (await backend()).incrementBuildsUsed(userId);
}

/** All users, newest first. For the admin dashboard. */
export async function listUsers() {
  return (await backend()).listUsers();
}

/** Delete a user and all their server-side data (REQ-ACCT-004). */
export async function deleteUser(userId: string) {
  return (await backend()).deleteUser(userId);
}

// --- magic-link tokens (single-use) ---

export async function createMagicToken(email: string) {
  return (await backend()).createMagicToken(email);
}

export async function consumeMagicToken(tok: string) {
  return (await backend()).consumeMagicToken(tok);
}

// --- sessions ---

export async function createSession(userId: string) {
  return (await backend()).createSession(userId);
}

export async function userForSession(tok: string) {
  return (await backend()).userForSession(tok);
}

export async function deleteSession(tok: string) {
  return (await backend()).deleteSession(tok);
}
