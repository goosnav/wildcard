// Network-free tests for the OpenRouter provider's request shaping. We stub
// global fetch and assert the prompt-cache breakpoint (the #1 COGS lever) is
// applied to the static system prefix for Anthropic-family models, and omitted
// for models that don't support explicit cache_control.

import { describe, it, expect, vi, afterEach } from "vitest";
import { openRouterModel } from "../src/openrouter-model.js";

interface SentBody {
  model: string;
  usage?: { include?: boolean };
  messages: { role: string; content: unknown }[];
}

function stubFetch(): () => SentBody {
  const calls: SentBody[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string) as SentBody);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    })
  );
  return () => calls[calls.length - 1];
}

afterEach(() => vi.unstubAllGlobals());

describe("openRouterModel request shaping", () => {
  it("marks the system prefix cacheable for Anthropic-family models", async () => {
    const lastBody = stubFetch();
    const model = openRouterModel({ apiKey: "test", model: "anthropic/claude-sonnet-4" });
    await model.complete({ system: "SYSTEM PREFIX", user: "make a thing" });

    const body = lastBody();
    expect(body.usage).toEqual({ include: true });
    const sys = body.messages.find((m) => m.role === "system");
    expect(Array.isArray(sys?.content)).toBe(true);
    expect(sys?.content).toEqual([
      { type: "text", text: "SYSTEM PREFIX", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("uses a plain string system for models without explicit cache support", async () => {
    const lastBody = stubFetch();
    const model = openRouterModel({ apiKey: "test", model: "openai/gpt-oss-120b:free" });
    await model.complete({ system: "SYSTEM PREFIX", user: "make a thing" });

    const sys = lastBody().messages.find((m) => m.role === "system");
    expect(sys?.content).toBe("SYSTEM PREFIX");
  });
});
