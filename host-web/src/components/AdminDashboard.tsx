// Owner master dashboard. Read-only roll-up of accounts + revenue from our own
// records. Stripe's dashboard stays authoritative for payments; this is the
// at-a-glance view (who signed up, who's on pro, estimated MRR). Access is gated
// server-side by the WC_ADMIN_EMAILS allow-list — a non-admin gets 403 here.

import { useEffect, useState } from "react";
import { getAdminOverview, type AdminOverview } from "../api";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function date(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getAdminOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) return <div className="admin-empty">Loading…</div>;
  if (error) return <div className="admin-empty admin-error">{error}</div>;
  if (!data) return null;

  const s = data.stats;
  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Users", value: String(s.totalUsers), hint: `${s.signupsLast7d} new this week` },
    { label: "Pro subscribers", value: String(s.proUsers), hint: `${s.freeUsers} on free` },
    { label: "Est. MRR", value: money(s.estimatedMrrUsd), hint: `${money(data.priceUsd)}/mo each` },
    { label: "Tools built", value: String(s.totalBuilds) },
  ];

  return (
    <div className="admin">
      <div className="admin-head">
        <h2 className="admin-title">Dashboard</h2>
        <button className="admin-refresh" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="admin-cards">
        {cards.map((c) => (
          <div className="admin-card" key={c.label}>
            <div className="admin-card-value">{c.value}</div>
            <div className="admin-card-label">{c.label}</div>
            {c.hint && <div className="admin-card-hint">{c.hint}</div>}
          </div>
        ))}
      </div>

      <p className="admin-note">
        Estimated MRR is pro-subscriber count × price. For authoritative revenue,
        refunds, and failed payments, use the Stripe dashboard.
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th>Builds</th>
              <th>Billing</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <span className={`admin-plan admin-plan-${u.plan}`}>{u.plan}</span>
                </td>
                <td>{u.buildsUsed}</td>
                <td>{u.subscribed ? "Stripe" : "—"}</td>
                <td>{date(u.createdAt)}</td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr>
                <td colSpan={5} className="admin-empty-row">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
