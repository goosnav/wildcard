// Shown when the free build allowance is spent. Sends the user to Stripe Checkout
// for the $9.99/mo subscription. If billing isn't configured on the server yet,
// we say so honestly rather than dead-ending on a broken button.

import { useState } from "react";
import { startCheckout } from "../api";

export function Paywall({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function subscribe() {
    setBusy(true);
    setMessage(null);
    const result = await startCheckout();
    if (result.ok) {
      window.location.href = result.url; // hand off to Stripe
      return;
    }
    setBusy(false);
    setMessage(
      result.reason === "unconfigured"
        ? "Subscriptions aren’t switched on yet — hang tight."
        : result.message || "Couldn’t start checkout. Try again."
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">You’ve used your free builds</h2>
        <p className="modal-body">
          Go unlimited for <strong>$9.99/month</strong> — build as many tools as you like.
          Your existing tools keep working either way.
        </p>
        <button className="modal-cta" onClick={subscribe} disabled={busy}>
          {busy ? "Starting…" : "Subscribe — $9.99/mo"}
        </button>
        {message && <p className="modal-note">{message}</p>}
        <button className="modal-dismiss" onClick={onClose}>
          Maybe later
        </button>
      </div>
    </div>
  );
}
