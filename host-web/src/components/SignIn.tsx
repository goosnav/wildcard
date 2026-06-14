// Passwordless sign-in. Enter an email, get a magic link. In development the
// server has no email provider, so it returns the link directly and we offer a
// one-tap "Continue" instead of making you dig through a console.

import { useState } from "react";
import { requestMagicLink } from "../api";
import { LegalLinks, LegalModal, type LegalDocId } from "./Legal";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
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

        <p className="signin-consent">
          By continuing you agree to our{" "}
          <button onClick={() => setLegalDoc("terms")}>Terms</button> and{" "}
          <button onClick={() => setLegalDoc("privacy")}>Privacy Policy</button>. Tool
          descriptions you enter are sent to an AI provider to build your tool —{" "}
          <button onClick={() => setLegalDoc("ai")}>how this works</button>.
        </p>
      </div>

      <footer className="signin-foot">
        <LegalLinks onOpen={setLegalDoc} />
      </footer>

      {legalDoc && <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  );
}
