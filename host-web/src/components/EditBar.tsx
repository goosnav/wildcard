// "Edit with AI" bar shown under a running tool (REQ-EDIT-003): describe a
// change in plain language and the tool is regenerated with its current source
// as context, then re-run in place. Clears itself after submitting.

import { useState } from "react";

export function EditBar({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (instruction: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const instruction = value.trim();
    if (instruction && !busy) {
      onSubmit(instruction);
      setValue("");
    }
  }

  return (
    <div className="editbar">
      <span className="editbar-icon" aria-hidden>
        ✨
      </span>
      <input
        type="text"
        placeholder="Edit with AI — e.g. add a reset button, or make the total bigger"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button onClick={submit} disabled={busy || !value.trim()}>
        {busy ? "Editing…" : "Apply"}
      </button>
    </div>
  );
}
