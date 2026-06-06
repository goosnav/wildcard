// The real Model implementation (CMP-04 model gateway, minimal). Wraps the
// Anthropic SDK and applies PROMPT CACHING to the large static prefix (system
// prompt + SDK reference + examples) — the #1 COGS lever (Doc 08 §8.3). The
// provider key lives only here, server-side (REQ-SEC-001).

import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "./generate.js";

export interface AnthropicModelOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export function anthropicModel(opts: AnthropicModelOptions = {}): Model {
  const client = new Anthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  // NOTE (OQ-03): re-verify the current model id + price at project start.
  const model = opts.model ?? "claude-sonnet-4-6";
  const maxTokens = opts.maxTokens ?? 8000;

  return {
    async complete({ system, user, repair }) {
      const userContent = repair
        ? `${user}\n\nYour previous attempt failed validation with these errors:\n` +
          repair.errors.map((e) => `- ${e}`).join("\n") +
          `\n\nHere is what you produced:\n${repair.lastOutput}\n\n` +
          `Return a corrected <wc-app> block that fixes these errors.`
        : user;

      // Mark the static system prefix as cacheable so repeat generations bill it
      // at ~90% off (the #1 COGS lever). `cache_control` is accepted by the API;
      // its typing on the stable TextBlockParam landed in a later SDK, so we
      // attach it at this provider boundary rather than weakening the call site.
      const systemBlock: Anthropic.TextBlockParam = { type: "text", text: system };
      (systemBlock as { cache_control?: { type: "ephemeral" } }).cache_control = {
        type: "ephemeral",
      };

      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: [systemBlock],
        messages: [{ role: "user", content: userContent }],
      });

      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    },
  };
}
