// Zero-dependency JSON-file backend. The whole state lives in one file written
// atomically (temp + rename) on every mutation. This is the default backend: it
// needs no services, so `npm start` works out of the box. Volume is low for a
// fresh deployment; switch to Postgres (set DATABASE_URL) before it grows.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type Backend,
  type DbShape,
  type User,
  type MagicToken,
  type Session,
  MAGIC_TTL_MS,
  PATCHABLE_USER_KEYS,
} from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(here, "../../.data");

const now = () => Date.now();

function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

function tokenStr(): string {
  return randomBytes(24).toString("hex");
}

/** @param dataDir directory for db.json (overridable for tests/isolation). */
export function createJsonBackend(dataDir: string = DEFAULT_DATA_DIR): Backend {
  const DATA_DIR = dataDir;
  const DB_PATH = resolve(DATA_DIR, "db.json");
  let db: DbShape = load();

  function load(): DbShape {
    try {
      const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<DbShape>;
      return {
        users: parsed.users ?? [],
        magicTokens: parsed.magicTokens ?? [],
        sessions: parsed.sessions ?? [],
      };
    } catch {
      return { users: [], magicTokens: [], sessions: [] };
    }
  }

  function persist(): void {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, DB_PATH); // atomic on the same filesystem
  }

  const clone = <T>(v: T): T => (v == null ? v : ({ ...v } as T));

  return {
    name: "json",

    async findUserByEmail(email) {
      const e = email.toLowerCase();
      return clone(db.users.find((u) => u.email === e));
    },

    async findUserById(userId) {
      return clone(db.users.find((u) => u.id === userId));
    },

    async findUserByStripeCustomer(customerId) {
      return clone(db.users.find((u) => u.stripeCustomerId === customerId));
    },

    async createUser(email) {
      const user: User = {
        id: id("usr"),
        email: email.toLowerCase(),
        plan: "free",
        buildsUsed: 0,
        createdAt: now(),
      };
      db.users.push(user);
      persist();
      return clone(user);
    },

    async updateUser(userId, patch) {
      const user = db.users.find((u) => u.id === userId);
      if (!user) throw new Error(`user not found: ${userId}`);
      // Only copy patchable fields — never let a patch overwrite id/createdAt
      // (matches the Postgres backend's column allow-list).
      const target = user as unknown as Record<string, unknown>;
      const src = patch as Record<string, unknown>;
      for (const key of PATCHABLE_USER_KEYS) {
        if (key in patch) target[key] = src[key];
      }
      persist();
      return clone(user);
    },

    async incrementBuildsUsed(userId) {
      // Read-modify-write off the CURRENT stored value. There is no await between
      // the read and the persist, so on Node's single thread this runs to
      // completion atomically w.r.t. other increments — no lost updates.
      const user = db.users.find((u) => u.id === userId);
      if (!user) throw new Error(`user not found: ${userId}`);
      user.buildsUsed += 1;
      persist();
      return clone(user);
    },

    async listUsers() {
      return db.users
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((u) => clone(u));
    },

    async deleteUser(userId) {
      const user = db.users.find((u) => u.id === userId);
      db.users = db.users.filter((u) => u.id !== userId);
      db.sessions = db.sessions.filter((s) => s.userId !== userId);
      // Magic tokens are keyed by email; drop any belonging to this user too.
      if (user) db.magicTokens = db.magicTokens.filter((m) => m.email !== user.email);
      persist();
    },

    async createMagicToken(email) {
      const mt: MagicToken = {
        token: tokenStr(),
        email: email.toLowerCase(),
        expiresAt: now() + MAGIC_TTL_MS,
      };
      db.magicTokens.push(mt);
      persist();
      return clone(mt);
    },

    async consumeMagicToken(tok) {
      const mt = db.magicTokens.find((m) => m.token === tok);
      db.magicTokens = db.magicTokens.filter(
        (m) => m.token !== tok && m.expiresAt > now()
      );
      persist();
      if (!mt || mt.expiresAt <= now()) return null;
      return mt.email;
    },

    async createSession(userId) {
      const s: Session = { token: tokenStr(), userId, createdAt: now() };
      db.sessions.push(s);
      persist();
      return clone(s);
    },

    async userForSession(tok) {
      const s = db.sessions.find((x) => x.token === tok);
      return s ? clone(db.users.find((u) => u.id === s.userId)) : undefined;
    },

    async deleteSession(tok) {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((x) => x.token !== tok);
      if (db.sessions.length !== before) persist();
    },
  };
}
