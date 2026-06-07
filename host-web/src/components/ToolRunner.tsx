// Mounts a tool bundle in a sandboxed iframe using the SHARED @wildcard/runtime
// — the exact same code the server's validator runs, so a tool that passed
// validation runs identically here. Host chrome (the export button) reads
// WC.output; the tool itself never gets DOM/network access (REQ-RUN-004/005).

import { useEffect, useRef, useState } from "react";
import { mountTool, type Bundle, type ToolOutput } from "@wildcard/runtime";
import { idbStorageForTool } from "../idb";
import { callProvider } from "../api";

export function ToolRunner({ bundle }: { bundle: Bundle }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setOutput(null);
    setError(null);

    const mounted = mountTool(container, {
      bundle,
      storage: idbStorageForTool(bundle.manifest.id),
      // Server-proxied egress: the runtime gates this on the tool's declared
      // providers before it ever reaches the network (REQ-RUN-005).
      net: { fetch: (provider, params) => callProvider(provider, params) },
      onOutput: setOutput,
      onError: setError,
    });
    return () => mounted.destroy();
  }, [bundle]);

  function exportOutput() {
    if (!output) return;
    const { result, meta } = output;
    const text =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const blob = new Blob([text], { type: meta?.mime ?? "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta?.filename ?? `${bundle.manifest.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="runner">
      <div className="runner-stage" ref={containerRef} />
      {error && <div className="runner-error">⚠ {error}</div>}
      {output && (
        <div className="runner-output">
          <span className="runner-output-label">
            {output.meta?.label ?? "Output"}
          </span>
          <button onClick={exportOutput}>Export</button>
        </div>
      )}
    </div>
  );
}
