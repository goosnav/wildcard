// Shared data model + the storage backend contract. Two backends implement this
// interface: a zero-dependency JSON file (default, for local/dev and tiny
// deployments) and Postgres (when DATABASE_URL is set, for real hosting). Every
// method is async so the same interface fits both — the synchronous JSON backend
// just returns already-resolved values.

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

/** The full persisted state — used by the JSON backend's on-disk shape. */
export interface DbShape {
  users: User[];
  magicTokens: MagicToken[];
  sessions: Session[];
}

/** The storage contract. Implementations must enforce: emails stored lowercase,
 *  magic tokens single-use, and patches applied atomically per record. */
export interface Backend {
  /** Human-readable name for /health + logs ("json" | "postgres"). */
  readonly name: string;

  // users
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(userId: string): Promise<User | undefined>;
  findUserByStripeCustomer(customerId: string): Promise<User | undefined>;
  createUser(email: string): Promise<User>;
  updateUser(userId: string, patch: Partial<User>): Promise<User>;
  /** All users, newest first (for the admin dashboard). */
  listUsers(): Promise<User[]>;

  // magic-link tokens (single-use)
  createMagicToken(email: string): Promise<MagicToken>;
  /** Consume a token: return its email if valid+unexpired, else null. Always
   *  removes the token (and any expired ones) regardless of validity. */
  consumeMagicToken(tok: string): Promise<string | null>;

  // sessions
  createSession(userId: string): Promise<Session>;
  userForSession(tok: string): Promise<User | undefined>;
  deleteSession(tok: string): Promise<void>;
}

export const MAGIC_TTL_MS = 15 * 60 * 1000;

/** The only User fields a patch may write. `id` and `createdAt` are immutable
 *  identity/audit fields and must never be mutated via updateUser — both backends
 *  enforce this so they behave identically. */
export const PATCHABLE_USER_KEYS = [
  "email",
  "plan",
  "buildsUsed",
  "stripeCustomerId",
  "stripeSubscriptionId",
] as const satisfies readonly (keyof User)[];
