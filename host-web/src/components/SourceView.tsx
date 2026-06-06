// Read-only source viewer. Apple 2.5.2 requires generated code to be inspectable;
// this is also how a user builds trust in what their tool actually does. (A
// CodeMirror editor with "edit with AI" comes later.)

import { useState } from "react";
import type { Bundle } from "@wildcard/runtime";

export function SourceView({ bundle }: { bundle: Bundle }) {
  const paths = Object.keys(bundle.files);
  const [active, setActive] = useState(paths[0] ?? "index.html");

  return (
    <div className="source">
      <div className="source-tabs">
        {paths.map((p) => (
          <button
            key={p}
            className={p === active ? "source-tab active" : "source-tab"}
            onClick={() => setActive(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <pre className="source-code">
        <code>{bundle.files[active]}</code>
      </pre>
    </div>
  );
}
