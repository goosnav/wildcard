// Account & data controls (REQ-ACCT-004, REQ-DATA-004): plan info, manage/cancel
// subscription via the Stripe Billing Portal, export the full tool library, and
// delete the account. Privacy-gate items for the web launch.

import { useState } from "react";
import { startBillingPortal, type AuthUser } from "../api";

export function Account({
  user,
  toolCount,
  billingEnabled,
  onExportAll,
  onDeleteAccount,
}: {
  user: AuthUser;
  toolCount: number;
  billingEnabled: boolean;
  onExportAll: () => void;
  onDeleteAccount: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "portal" | "delete">(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPro = user.quota.plan === "pro";

  async function manageSubscription() {
    setBusy("portal");
    setError(null);
    const r = await startBillingPortal();
    if (r.ok) {
      window.location.href = r.url;
    } else {
      setError(r.message);
      setBusy(null);
    }
  }

  async function confirmDelete() {
    setBusy("delete");
    setError(null);
    try {
      await onDeleteAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete your account.");
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <div className="account-view">
      <h2 className="account-h">Account</h2>

      <section className="account-card">
        <div className="account-row">
          <span className="account-label">Email</span>
          <span>{user.email}</span>
        </div>
        <div className="account-row">
          <span className="account-label">Plan</span>
          <span>{isPro ? "Pro · unlimited builds" : "Free"}</span>
        </div>
        <div className="account-row">
          <span className="account-label">Tools built</span>
          <span>{user.quota.buildsUsed}</span>
        </div>
      </section>

      {billingEnabled && (
        <section className="account-card">
          <h3 className="account-sub">Subscription</h3>
          <p className="account-note">
            {isPro
              ? "Manage your plan, update payment details, or cancel."
              : "You're on the free plan. Upgrade any time from the build screen."}
          </p>
          <button
            className="account-btn"
            disabled={busy === "portal"}
            onClick={manageSubscription}
          >
            {busy === "portal" ? "Opening…" : "Manage subscription"}
          </button>
        </section>
      )}

      <section className="account-card">
        <h3 className="account-sub">Your data</h3>
        <p className="account-note">
          Your tools live on this device. Export a copy of all {toolCount} of them as a
          JSON file.
        </p>
        <button className="account-btn" onClick={onExportAll} disabled={toolCount === 0}>
          Export all tools
        </button>
      </section>

      <section className="account-card account-danger">
        <h3 className="account-sub">Delete account</h3>
        <p className="account-note">
          Permanently delete your account and server-side data. This cancels any active
          subscription and removes your tools from this device. This can’t be undone.
        </p>
        {!confirming ? (
          <button className="account-btn account-btn-danger" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        ) : (
          <div className="account-confirm">
            <span>Are you sure?</span>
            <button
              className="account-btn account-btn-danger"
              disabled={busy === "delete"}
              onClick={confirmDelete}
            >
              {busy === "delete" ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button
              className="account-btn"
              disabled={busy === "delete"}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </section>

      {error && <p className="account-error">⚠ {error}</p>}
    </div>
  );
}
