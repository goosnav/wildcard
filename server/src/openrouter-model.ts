// OpenRouter model provider (CMP-04, OpenRouter variant). OpenRouter exposes an
// OpenAI-compatible /chat/completions endpoint, so we talk to it with plain
// fetch — no SDK dependency. One key, server-side only (REQ-SEC-001).
//
// PROMPT CACHING (the #1 COGS lever, Doc 08 §8.3): for Anthropic-family models
// OpenRouter honours an explicit `cache_control` breakpoint on a content part.
// We mark the large static system prefix (system prompt + SDK reference +
// examples) as cacheable so repeat generations bill it at ~90% off. Models that
// don't support explicit breakpoints (the free smoke-test models) get the plain
// string form, so nothing breaks when caching isn't available.

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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cache_discount?: number;
  };
  error?: { message?: string; code?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Anthropic-family models on OpenRouter honour an explicit `cache_control`
 *  breakpoint. Other models (incl. the free smoke-test models) do not, so we
 *  fall back to plain-string content for them rather than risk a 400. */
function supportsExplicitCache(model: string): boolean {
  return /^anthropic\//.test(model);
}

/** One concise line so the cache hit-rate can be confirmed (plan §7). Gated on
 *  WC_LOG_USAGE to keep production logs quiet. */
function logUsage(model: string, usage: ChatCompletionResponse["usage"]): void {
  if (!process.env.WC_LOG_USAGE || !usage) return;
  const prompt = usage.prompt_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const hitRate = prompt ? Math.round((100 * cached) / prompt) : 0;
  console.log(
    `[usage] ${model} · prompt=${prompt} cached=${cached} (${hitRate}% cache hit) ` +
      `· completion=${usage.completion_tokens ?? 0}` +
      (usage.cache_discount != null ? ` · discount=${usage.cache_discount}` : "")
  );
}

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

      // Cache the static system prefix on models that support an explicit
      // breakpoint; plain string otherwise.
      const systemContent = supportsExplicitCache(model)
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system;

      const body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        // Ask OpenRouter to return normalised token usage (incl. cached_tokens)
        // so the cache hit-rate is observable for cost tuning.
        usage: { include: true },
        messages: [
          { role: "system", content: systemContent },
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
        logUsage(model, data.usage);
        return data.choices?.[0]?.message?.content ?? "";
      }

      throw new Error(`OpenRouter request failed after ${maxRetries} retries: ${lastErr}`);
    },
  };
}
