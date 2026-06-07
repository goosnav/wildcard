// Source viewer/editor. Apple 2.5.2 requires generated code to be inspectable;
// this is also how a user builds trust in — and takes ownership of — what their
// tool does. When `onSave` is provided the files become editable and the user
// can tweak the code and re-run it locally (REQ-EDIT-001/002/004). Edits run in
// the same sandbox as any tool, so no server round-trip is needed.

import { useEffect, useState } from "react";
import type { Bundle } from "@wildcard/runtime";

export function SourceView({
  bundle,
  onSave,
}: {
  bundle: Bundle;
  onSave?: (files: Bundle["files"]) => Promise<void> | void;
}) {
  const paths = Object.keys(bundle.files);
  const [active, setActive] = useState(paths[0] ?? "index.html");
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...bundle.files }));
  const [saving, setSaving] = useState(false);

  // Re-seed the draft when the underlying tool changes (switched tools, or a
  // save replaced the bundle) so we never show stale edits.
  useEffect(() => {
    setDraft({ ...bundle.files });
    setActive(Object.keys(bundle.files)[0] ?? "index.html");
  }, [bundle]);

  const editable = !!onSave;
  const isDirty = (p: string) => draft[p] !== bundle.files[p];
  const dirty = editable && paths.some(isDirty);

  async function save() {
    if (!onSave || !dirty || saving) return;
    setSaving(true);
    try {
      await onSave(draft as Bundle["files"]);
    } finally {
      setSaving(false);
    }
  }

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
            {editable && isDirty(p) ? " •" : ""}
          </button>
        ))}
        {editable && (
          <span className="source-actions">
            <button
              className="source-revert"
              disabled={!dirty || saving}
              onClick={() => setDraft({ ...bundle.files })}
            >
              Revert
            </button>
            <button className="source-save" disabled={!dirty || saving} onClick={save}>
              {saving ? "Saving…" : "Save & Run"}
            </button>
          </span>
        )}
      </div>
      {editable ? (
        <textarea
          className="source-editor"
          spellCheck={false}
          value={draft[active] ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, [active]: e.target.value }))}
        />
      ) : (
        <pre className="source-code">
          <code>{bundle.files[active]}</code>
        </pre>
      )}
    </div>
  );
}
