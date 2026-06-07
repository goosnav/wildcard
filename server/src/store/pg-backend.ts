// Postgres backend, active when DATABASE_URL is set. Works with any standard
// Postgres (Supabase, Neon, RDS, plain). Schema is created on first connect, so
// there's no separate migration step for the v1 lean slice — the table set is
// tiny and additive. Epoch-millisecond timestamps are stored as bigint to mirror
// the JSON backend exactly (the rest of the app treats time as `number`).

import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  type Backend,
  type User,
  type MagicToken,
  type Session,
  MAGIC_TTL_MS,
  PATCHABLE_USER_KEYS,
} from "./types.js";

const now = () => Date.now();

function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

function tokenStr(): string {
  return randomBytes(24).toString("hex");
}

interface UserRow {
  id: string;
  email: string;
  plan: string;
  builds_used: number;
  created_at: string; // bigint comes back as string
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

function rowToUser(r: UserRow): User {
  const u: User = {
    id: r.id,
    email: r.email,
    plan: r.plan === "pro" ? "pro" : "free",
    buildsUsed: Number(r.builds_used),
    createdAt: Number(r.created_at),
  };
  if (r.stripe_customer_id) u.stripeCustomerId = r.stripe_customer_id;
  if (r.stripe_subscription_id) u.stripeSubscriptionId = r.stripe_subscription_id;
  return u;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  builds_used INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT
);
CREATE TABLE IF NOT EXISTS magic_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users(stripe_customer_id);
`;

// Map a patchable User field to its column. Keyed off the shared allow-list so
// the two backends can't drift on what updateUser may write (id/createdAt are
// intentionally absent — they're immutable).
const TO_COLUMN: Record<(typeof PATCHABLE_USER_KEYS)[number], string> = {
  email: "email",
  plan: "plan",
  buildsUsed: "builds_used",
  stripeCustomerId: "stripe_customer_id",
  stripeSubscriptionId: "stripe_subscription_id",
};
const COLUMN: Record<string, string | undefined> = TO_COLUMN;

/** Create the Postgres backend and ensure its schema exists before returning. */
export async function createPgBackend(databaseUrl: string): Promise<Backend> {
  // Hosted Postgres (Supabase/Neon) requires TLS; allow self-signed chains.
  const ssl = /\bsslmode=disable\b/.test(databaseUrl)
    ? undefined
    : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: databaseUrl, ssl });
  await pool.query(SCHEMA);

  async function oneUser(sql: string, params: unknown[]): Promise<User | undefined> {
    const { rows } = await pool.query<UserRow>(sql, params);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  return {
    name: "postgres",

    findUserByEmail(email) {
      return oneUser("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    },

    findUserById(userId) {
      return oneUser("SELECT * FROM users WHERE id = $1", [userId]);
    },

    findUserByStripeCustomer(customerId) {
      return oneUser("SELECT * FROM users WHERE stripe_customer_id = $1", [customerId]);
    },

    async createUser(email) {
      const user: UserRow | undefined = (
        await pool.query<UserRow>(
          `INSERT INTO users (id, email, plan, builds_used, created_at)
           VALUES ($1, $2, 'free', 0, $3) RETURNING *`,
          [id("usr"), email.toLowerCase(), now()]
        )
      ).rows[0];
      return rowToUser(user!);
    },

    async updateUser(userId, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, value] of Object.entries(patch)) {
        const col = COLUMN[key];
        if (!col) continue; // ignore id/createdAt and unknown keys
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      }
      if (sets.length === 0) {
        const existing = await oneUser("SELECT * FROM users WHERE id = $1", [userId]);
        if (!existing) throw new Error(`user not found: ${userId}`);
        return existing;
      }
      params.push(userId);
      const updated = await oneUser(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!updated) throw new Error(`user not found: ${userId}`);
      return updated;
    },

    async listUsers() {
      const { rows } = await pool.query<UserRow>(
        "SELECT * FROM users ORDER BY created_at DESC"
      );
      return rows.map(rowToUser);
    },

    async createMagicToken(email) {
      const mt: MagicToken = {
        token: tokenStr(),
        email: email.toLowerCase(),
        expiresAt: now() + MAGIC_TTL_MS,
      };
      await pool.query(
        "INSERT INTO magic_tokens (token, email, expires_at) VALUES ($1, $2, $3)",
        [mt.token, mt.email, mt.expiresAt]
      );
      return mt;
    },

    async consumeMagicToken(tok) {
      // Single-use: delete the row as we read it, then prune anything expired.
      const { rows } = await pool.query<{ email: string; expires_at: string }>(
        "DELETE FROM magic_tokens WHERE token = $1 RETURNING email, expires_at",
        [tok]
      );
      await pool.query("DELETE FROM magic_tokens WHERE expires_at <= $1", [now()]);
      const row = rows[0];
      if (!row || Number(row.expires_at) <= now()) return null;
      return row.email;
    },

    async createSession(userId) {
      const s: Session = { token: tokenStr(), userId, createdAt: now() };
      await pool.query(
        "INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)",
        [s.token, s.userId, s.createdAt]
      );
      return s;
    },

    async userForSession(tok) {
      return oneUser(
        `SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
         WHERE s.token = $1`,
        [tok]
      );
    },

    async deleteSession(tok) {
      await pool.query("DELETE FROM sessions WHERE token = $1", [tok]);
    },
  };
}
