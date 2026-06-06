// Minimal /v1/generate server (CMP-03 surface). Streams progress + the final
// bundle over Server-Sent Events so the phone can show a live build view
// (REQ-GEN-003). This is the spike-level shape of Doc 04 §4.7; auth, quota
// enforcement (REQ-PAY-003), and persistence are stubbed for the spike.

import "./env.js"; // load root .env before reading any secret
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateTool, type GenEvent } from "./generate.js";
import { createModel, activeProviderName } from "./provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  resolve(here, "../prompts/system.md"),
  "utf8"
);

const app = new Hono();

// The web shell runs on a different dev origin (Vite); allow it to call us.
app.use("/v1/*", cors());

app.get("/health", (c) => c.json({ ok: true, provider: activeProviderName() }));

app.post("/v1/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);

  const model = createModel();

  return streamSSE(c, async (stream) => {
    const send = (e: GenEvent) =>
      stream.writeSSE({ event: e.type, data: JSON.stringify(e) });

    const result = await generateTool({
      prompt,
      system: SYSTEM_PROMPT,
      model,
      onEvent: send,
    });

    await stream.writeSSE({
      event: "result",
      data: JSON.stringify(
        result.ok
          ? { ok: true, manifest: result.bundle!.manifest, files: result.bundle!.files }
          : { ok: false, reason: result.reason }
      ),
    });
  });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`Wild Card generation server on http://localhost:${port}`);
