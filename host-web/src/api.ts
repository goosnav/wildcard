// Client for the server's /v1/generate SSE stream. Emits each generation event
// as it arrives (so the build view can show live progress), and resolves with
// the final result (the validated bundle, or an honest failure reason).

import type { Bundle } from "@wildcard/runtime";

export type GenEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; turn: number }
  | { type: "validated"; pass: boolean; errors: string[] }
  | { type: "done"; bundle: Bundle }
  | { type: "failed"; reason: string };

export type GenResult =
  | { ok: true; manifest: Bundle["manifest"]; files: Bundle["files"] }
  | { ok: false; reason: string };

/** Parse a raw SSE buffer into `{event, data}` records, returning the leftover. */
function drainEvents(
  buffer: string
): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  let idx: number;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest: buffer };
}

export async function generate(
  prompt: string,
  onEvent: (e: GenEvent) => void
): Promise<GenResult> {
  const res = await fetch("/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Generation request failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: GenResult | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = drainEvents(buffer);
    buffer = rest;
    for (const { event, data } of events) {
      const parsed = JSON.parse(data);
      if (event === "result") result = parsed as GenResult;
      else onEvent(parsed as GenEvent);
    }
  }

  if (!result) throw new Error("Stream ended without a result");
  return result;
}
