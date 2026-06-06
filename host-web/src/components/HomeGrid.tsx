// The home grid: icons for every tool you've made. Tap one to launch it.

import type { SavedTool } from "../idb";

export function HomeGrid({
  tools,
  onLaunch,
  onDelete,
}: {
  tools: SavedTool[];
  onLaunch: (tool: SavedTool) => void;
  onDelete: (tool: SavedTool) => void;
}) {
  if (tools.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No tools yet.</p>
        <p className="empty-sub">Describe one above and tap Build.</p>
      </div>
    );
  }

  return (
    <div className="grid">
      {tools.map((tool) => (
        <div key={tool.manifest.id} className="tile">
          <button className="tile-launch" onClick={() => onLaunch(tool)}>
            <span className="tile-icon">{tool.manifest.icon}</span>
            <span className="tile-name">{tool.manifest.name}</span>
          </button>
          <button
            className="tile-delete"
            title="Delete"
            onClick={() => onDelete(tool)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
