// The home grid: an icon for every tool. Tap to launch. Drag to reorder
// (REQ-HOME-002). Each tile has a ⋯ menu to rename, duplicate, or delete
// (REQ-HOME-003).

import { useRef, useState } from "react";
import type { SavedTool } from "../idb";

export function HomeGrid({
  tools,
  onLaunch,
  onDelete,
  onReorder,
  onRename,
  onDuplicate,
}: {
  tools: SavedTool[];
  onLaunch: (tool: SavedTool) => void;
  onDelete: (tool: SavedTool) => void;
  onReorder: (arranged: SavedTool[]) => void;
  onRename: (tool: SavedTool, name: string) => void;
  onDuplicate: (tool: SavedTool) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (tools.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No tools yet.</p>
        <p className="empty-sub">Describe one above and tap Build.</p>
      </div>
    );
  }

  function handleDrop(to: number) {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === to) return;
    const next = tools.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }

  function rename(tool: SavedTool) {
    setMenuId(null);
    const name = window.prompt("Rename tool", tool.manifest.name);
    if (name) onRename(tool, name);
  }

  return (
    <div className="grid">
      {tools.map((tool, i) => (
        <div
          key={tool.manifest.id}
          className={`tile${dragOver === i ? " tile-dragover" : ""}`}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragOver !== i) setDragOver(i);
          }}
          onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
          onDrop={() => handleDrop(i)}
          onDragEnd={() => {
            dragFrom.current = null;
            setDragOver(null);
          }}
        >
          <button className="tile-launch" onClick={() => onLaunch(tool)}>
            <span className="tile-icon">{tool.manifest.icon}</span>
            <span className="tile-name">{tool.manifest.name}</span>
          </button>
          <button
            className="tile-menu-btn"
            title="More"
            onClick={() => setMenuId((id) => (id === tool.manifest.id ? null : tool.manifest.id))}
          >
            ⋯
          </button>
          {menuId === tool.manifest.id && (
            <div className="tile-menu" onMouseLeave={() => setMenuId(null)}>
              <button onClick={() => rename(tool)}>Rename</button>
              <button
                onClick={() => {
                  setMenuId(null);
                  onDuplicate(tool);
                }}
              >
                Duplicate
              </button>
              <button
                className="tile-menu-danger"
                onClick={() => {
                  setMenuId(null);
                  onDelete(tool);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
