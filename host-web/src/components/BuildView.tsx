// Live build view: streams the generation events as they arrive so the user
// sees the tool being built, validated, and (if needed) repaired in real time.

import type { GenEvent } from "../api";

export interface BuildLine {
  text: string;
  kind: "status" | "ok" | "fail";
}

export function eventToLine(e: GenEvent): BuildLine | null {
  switch (e.type) {
    case "attempt":
      return e.turn === 0
        ? { text: "Building your tool…", kind: "status" }
        : { text: `Repair attempt ${e.turn}…`, kind: "status" };
    case "status":
      return { text: e.message, kind: "status" };
    case "validated":
      return e.pass
        ? { text: "Validated — it runs.", kind: "ok" }
        : {
            text: `Caught ${e.errors.length} issue${e.errors.length === 1 ? "" : "s"}, fixing…`,
            kind: "fail",
          };
    case "done":
      return { text: "Done!", kind: "ok" };
    case "failed":
      return { text: e.reason, kind: "fail" };
    default:
      return null;
  }
}

export function BuildView({
  lines,
  busy,
  onHome,
}: {
  lines: BuildLine[];
  busy: boolean;
  onHome: () => void;
}) {
  const failed = !busy && lines.some((l) => l.kind === "fail");
  return (
    <div className="buildview">
      {busy && <div className="spinner" aria-hidden />}
      <ul className="build-log">
        {lines.map((l, i) => (
          <li key={i} className={`build-line build-${l.kind}`}>
            {l.text}
          </li>
        ))}
      </ul>
      {failed && (
        <div className="build-actions">
          <p className="build-hint">
            Couldn’t finish this one. Try rephrasing above, or head back.
          </p>
          <button className="back" onClick={onHome}>
            ‹ Home
          </button>
        </div>
      )}
    </div>
  );
}
