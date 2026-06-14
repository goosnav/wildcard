// Email magic-link auth (REQ-ACCT-001/003), passwordless. Two steps:
//   1. requestMagicLink(email) → mint a single-use token, email a link to it.
//   2. verifyMagicLink(token)  → upsert the user, issue a session bearer token.
// The session token is what the client sends as `Authorization: Bearer` on every
// subsequent call; userForSession() (in the store) resolves it back to a user.

import {
  createMagicToken,
  consumeMagicToken,
  upsertUser,
  createSession,
  type User,
} from "./store.js";
import { sendMagicLink } from "./email.js";

const APP_URL = process.env.WC_APP_URL ?? "http://localhost:5173";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export interface RequestResult {
  /** True when a real email was sent; false when we only logged (dev). */
  emailed: boolean;
  /** Present only in development so the client can complete sign-in inline. */
  devLink?: string;
}

export async function requestMagicLink(email: string): Promise<RequestResult> {
  const mt = await createMagicToken(email);
  const link = `${APP_URL}/?token=${mt.token}`;
  const emailed = await sendMagicLink(email, link);
  return emailed ? { emailed } : { emailed, devLink: link };
}

export interface VerifyResult {
  sessionToken: string;
  user: User;
}

export async function verifyMagicLink(magicToken: string): Promise<VerifyResult | null> {
  const email = await consumeMagicToken(magicToken);
  if (!email) return null;
  const user = await upsertUser(email);
  const session = await createSession(user.id);
  return { sessionToken: session.token, user };
}

/** Pull a bearer token out of an Authorization header, if present. */
export function bearerToken(authHeader: string | undefined | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}
