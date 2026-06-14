// Version history for a tool (REQ-GEN-006). Lists prior versions saved on each
// edit (AI or manual) and lets the user revert. Reverting is itself undoable —
// the current version is snapshotted before the revert is applied.

import { useState } from "react";
import type { SavedTool } from "../idb";

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ToolHistory({
  tool,
  onRevert,
}: {
  tool: SavedTool;
  onRevert: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const history = tool.history ?? [];

  return (
    <div className="history">
      <button
        className="history-toggle"
        disabled={history.length === 0}
        onClick={() => setOpen((o) => !o)}
        title={history.length === 0 ? "No previous versions yet" : "Version history"}
      >
        History{history.length ? ` (${history.length})` : ""}
      </button>
      {open && history.length > 0 && (
        <div className="history-panel">
          <div className="history-row history-current">
            <span>Current version</span>
          </div>
          {history.map((v, i) => (
            <div className="history-row" key={v.savedAt + ":" + i}>
              <span className="history-meta">
                <span className="history-note">{v.note ?? "Edit"}</span>
                <span className="history-time">{ago(v.savedAt)}</span>
              </span>
              <button
                className="history-revert"
                onClick={() => {
                  onRevert(i);
                  setOpen(false);
                }}
              >
                Revert
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
