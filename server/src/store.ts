// Tiny zero-dependency persistence for the v1 lean slice. The whole state lives
// in one JSON file written atomically (temp + rename) on every mutation. Volume
// is low (early users), so simplicity beats a database here. Everything goes
// through this module's small interface, so swapping in Postgres later is a
// contained change — no caller touches the file directly.
//
// Source of truth for entitlements + quota (REQ-PAY-003, REQ-NFR-006): the
// server owns buildsUsed and plan; the client can never grant itself builds.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type Plan = "free" | "pro";

export interface User {
  id: string;
  email: string;
  plan: Plan;
  buildsUsed: number;
  createdAt: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface MagicToken {
  token: string;
  email: string;
  expiresAt: number;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
}

interface DbShape {
  users: User[];
  magicTokens: MagicToken[];
  sessions: Session[];
}

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, "../.data");
const DB_PATH = resolve(DATA_DIR, "db.json");

function emptyDb(): DbShape {
  return { users: [], magicTokens: [], sessions: [] };
}

function load(): DbShape {
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<DbShape>;
    return {
      users: parsed.users ?? [],
      magicTokens: parsed.magicTokens ?? [],
      sessions: parsed.sessions ?? [],
    };
  } catch {
    return emptyDb();
  }
}

let db = load();

function persist(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH); // atomic on the same filesystem
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export function token(): string {
  return randomBytes(24).toString("hex");
}

const now = () => Date.now();

// --- users ---

export function findUserByEmail(email: string): User | undefined {
  const e = email.toLowerCase();
  return db.users.find((u) => u.email === e);
}

export function findUserById(userId: string): User | undefined {
  return db.users.find((u) => u.id === userId);
}

export function createUser(email: string): User {
  const user: User = {
    id: id("usr"),
    email: email.toLowerCase(),
    plan: "free",
    buildsUsed: 0,
    createdAt: now(),
  };
  db.users.push(user);
  persist();
  return user;
}

export function upsertUser(email: string): User {
  return findUserByEmail(email) ?? createUser(email);
}

/** Apply a patch to a stored user and persist. Returns the updated user. */
export function updateUser(userId: string, patch: Partial<User>): User {
  const user = findUserById(userId);
  if (!user) throw new Error(`user not found: ${userId}`);
  Object.assign(user, patch);
  persist();
  return user;
}

export function findUserByStripeCustomer(customerId: string): User | undefined {
  return db.users.find((u) => u.stripeCustomerId === customerId);
}

// --- magic-link tokens (single-use) ---

const MAGIC_TTL_MS = 15 * 60 * 1000;

export function createMagicToken(email: string): MagicToken {
  const mt: MagicToken = {
    token: token(),
    email: email.toLowerCase(),
    expiresAt: now() + MAGIC_TTL_MS,
  };
  db.magicTokens.push(mt);
  persist();
  return mt;
}

/** Consume a magic token: returns its email if valid, else null. Single-use —
 *  the token (and any expired ones) are removed regardless. */
export function consumeMagicToken(tok: string): string | null {
  const mt = db.magicTokens.find((m) => m.token === tok);
  db.magicTokens = db.magicTokens.filter(
    (m) => m.token !== tok && m.expiresAt > now()
  );
  persist();
  if (!mt || mt.expiresAt <= now()) return null;
  return mt.email;
}

// --- sessions ---

export function createSession(userId: string): Session {
  const s: Session = { token: token(), userId, createdAt: now() };
  db.sessions.push(s);
  persist();
  return s;
}

export function userForSession(tok: string): User | undefined {
  const s = db.sessions.find((x) => x.token === tok);
  return s ? findUserById(s.userId) : undefined;
}

export function deleteSession(tok: string): void {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((x) => x.token !== tok);
  if (db.sessions.length !== before) persist();
}
