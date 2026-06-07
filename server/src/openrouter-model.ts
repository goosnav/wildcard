// OpenRouter model provider (CMP-04, OpenRouter variant). OpenRouter exposes an
// OpenAI-compatible /chat/completions endpoint, so we talk to it with plain
// fetch — no SDK dependency. One key, server-side only (REQ-SEC-001).
//
// NOTE (OQ-03): prompt caching is the #1 COGS lever but is provider/model
// specific on OpenRouter; it's intentionally omitted here for the spike and
// should be re-added once we settle on a paid Anthropic model.

import type { Model } from "./generate.js";

export interface OpenRouterModelOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  /** Retries on 429 / 5xx (transient upstream errors). Default 4. */
  maxRetries?: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds to wait before retrying, from the Retry-After header (seconds form)
 *  if present, else capped exponential backoff. */
function backoffMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 30_000);
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export function openRouterModel(opts: OpenRouterModelOptions = {}): Model {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = opts.model ?? process.env.WC_MODEL ?? "anthropic/claude-sonnet-4";
  const maxTokens = opts.maxTokens ?? 8000;
  const baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  const maxRetries = opts.maxRetries ?? 4;

  return {
    async complete({ system, user, repair }) {
      const userContent = repair
        ? `${user}\n\nYour previous attempt failed validation with these errors:\n` +
          repair.errors.map((e) => `- ${e}`).join("\n") +
          `\n\nHere is what you produced:\n${repair.lastOutput}\n\n` +
          `Return a corrected <wc-app> block that fixes these errors.`
        : user;

      const body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      });

      let lastErr = "";
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Optional OpenRouter attribution headers.
            "X-Title": "Wild Card",
          },
          body,
        });

        // Retry transient upstream failures (rate limits, provider blips).
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          lastErr = `HTTP ${res.status}`;
          await sleep(backoffMs(res, attempt));
          continue;
        }

        const data = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
        if (!res.ok || data.error) {
          throw new Error(
            `OpenRouter request failed: ${data.error?.message ?? `HTTP ${res.status}`}`
          );
        }
        return data.choices?.[0]?.message?.content ?? "";
      }

      throw new Error(`OpenRouter request failed after ${maxRetries} retries: ${lastErr}`);
    },
  };
}
