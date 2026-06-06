// Picks the generation provider from the environment. Prefers OpenRouter when
// OPENROUTER_API_KEY is set, otherwise falls back to direct Anthropic. Both keys
// are read server-side only (REQ-SEC-001).

import type { Model } from "./generate.js";
import { openRouterModel } from "./openrouter-model.js";
import { anthropicModel } from "./anthropic-model.js";
import { stubModel } from "./stub-model.js";

export function createModel(): Model {
  if (process.env.WC_PROVIDER === "stub") return stubModel(); // dev-only, offline
  if (process.env.OPENROUTER_API_KEY) return openRouterModel();
  if (process.env.ANTHROPIC_API_KEY) return anthropicModel();
  throw new Error(
    "No generation provider configured: set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env"
  );
}

export function activeProviderName(): string {
  if (process.env.WC_PROVIDER === "stub") return "stub";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}
