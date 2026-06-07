// Client for the server API: magic-link auth, the /v1/generate SSE stream,
// quota, and Stripe checkout. The session bearer token lives in localStorage and
// is attached to every authenticated call. The server is the source of truth for
// quota — we just render what it returns and gate the UI off `canBuild`.

import type { Bundle } from "@wildcard/runtime";

export type GenEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; turn: number }
  | { type: "validated"; pass: boolean; errors: string[] }
  | { type: "done"; bundle: Bundle }
  | { type: "failed"; reason: string };

export interface Quota {
  plan: "free" | "pro";
  buildsUsed: number;
  buildsLimit: number | null;
  remaining: number | null;
  canBuild: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  quota: Quota;
  isAdmin?: boolean;
}

export interface AdminUserRow {
  id: string;
  email: string;
  plan: "free" | "pro";
  buildsUsed: number;
  createdAt: number;
  subscribed: boolean;
}

export interface AdminOverview {
  generatedAt: number;
  stats: {
    totalUsers: number;
    freeUsers: number;
    proUsers: number;
    subscribedUsers: number;
    totalBuilds: number;
    signupsLast7d: number;
    estimatedMrrUsd: number;
  };
  priceUsd: number;
  users: AdminUserRow[];
}

export type GenResult =
  | { ok: true; manifest: Bundle["manifest"]; files: Bundle["files"]; quota: Quota }
  | { ok: false; reason: string; quota?: Quota; paywall?: boolean };

// --- session token ---

const SESSION_KEY = "wc.session";

export function getSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}
function setSession(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}
function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getSession();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// --- auth ---

export async function requestMagicLink(
  email: string
): Promise<{ emailed: boolean; devLink?: string }> {
  const res = await fetch("/v1/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? "Couldn't send the sign-in link.");
  }
  return res.json();
}

export async function verifyMagicLink(token: string): Promise<AuthUser> {
  const res = await fetch("/v1/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error("That sign-in link is invalid or expired.");
  const { sessionToken, user } = await res.json();
  setSession(sessionToken);
  return user as AuthUser;
}

/** Resolve the current user from the stored session, or null if not signed in. */
export async function getMe(): Promise<AuthUser | null> {
  if (!getSession()) return null;
  const res = await fetch("/v1/me", { headers: { ...authHeaders() } });
  if (res.status === 401) {
    clearSession();
    return null;
  }
  if (!res.ok) return null;
  const { user } = await res.json();
  return user as AuthUser;
}

export async function logout(): Promise<void> {
  await fetch("/v1/auth/logout", { method: "POST", headers: { ...authHeaders() } }).catch(
    () => {}
  );
  clearSession();
}

// --- admin ---

/** Owner-only roster + revenue roll-up. Throws on 403 (not an admin) or error. */
export async function getAdminOverview(): Promise<AdminOverview> {
  const res = await fetch("/v1/admin/overview", { headers: { ...authHeaders() } });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `Failed to load admin overview (${res.status})`);
  }
  return res.json();
}

// --- data providers (server-proxied egress) ---

/** Call a server-proxied data provider on behalf of a running tool. The runtime
 *  has already checked the provider is declared in the tool's manifest; the
 *  server re-checks it against the fixed catalog and makes the upstream call.
 *  Returns the provider's data, or throws with the server's error message. */
export async function callProvider(
  provider: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`/v1/net/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `provider "${provider}" failed (${res.status})`);
  return j.data;
}

// --- billing ---

export async function startCheckout(): Promise<
  { ok: true; url: string } | { ok: false; reason: "unconfigured" | "error"; message: string }
> {
  const res = await fetch("/v1/billing/checkout", {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (res.ok) return { ok: true, ...(await res.json()) };
  const j = await res.json().catch(() => ({}));
  if (res.status === 503) return { ok: false, reason: "unconfigured", message: j.error ?? "" };
  return { ok: false, reason: "error", message: j.error ?? "Checkout failed." };
}

// --- generation ---

function drainEvents(
  buffer: string
): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  let idx: number;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest: buffer };
}

export async function generate(
  prompt: string,
  onEvent: (e: GenEvent) => void
): Promise<GenResult> {
  const res = await fetch("/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ prompt }),
  });

  // Quota exhausted — surface the paywall instead of throwing.
  if (res.status === 402) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, reason: "free_limit", quota: j.quota, paywall: true };
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Generation request failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: GenResult | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = drainEvents(buffer);
    buffer = rest;
    for (const { event, data } of events) {
      const parsed = JSON.parse(data);
      if (event === "result") result = parsed as GenResult;
      else onEvent(parsed as GenEvent);
    }
  }

  if (!result) throw new Error("Stream ended without a result");
  return result;
}
