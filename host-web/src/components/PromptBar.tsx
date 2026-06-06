// The prompt bar: describe a tool, get a tool. Disabled while a build runs.

import { useState } from "react";

export function PromptBar({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const prompt = value.trim();
    if (prompt && !busy) onSubmit(prompt);
  }

  return (
    <div className="promptbar">
      <input
        type="text"
        placeholder="Describe a tool — e.g. a tip splitter that remembers my usual %"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button onClick={submit} disabled={busy || !value.trim()}>
        {busy ? "Building…" : "Build"}
      </button>
    </div>
  );
}
