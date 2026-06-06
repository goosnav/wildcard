// Passwordless sign-in. Enter an email, get a magic link. In development the
// server has no email provider, so it returns the link directly and we offer a
// one-tap "Continue" instead of making you dig through a console.

import { useState } from "react";
import { requestMagicLink } from "../api";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { devLink } = await requestMagicLink(value);
      setSent(true);
      setDevLink(devLink ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <h1 className="signin-title">🃏 Wild Card</h1>
        <p className="signin-sub">Describe a tool. Get an app. Sign in to start building.</p>

        {!sent ? (
          <>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button className="signin-go" onClick={submit} disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a link"}
            </button>
            {error && <p className="signin-error">{error}</p>}
          </>
        ) : (
          <div className="signin-sent">
            <p>Check your email for a sign-in link.</p>
            {devLink && (
              <a className="signin-go" href={devLink}>
                Continue (dev)
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
