import { describe, it, expect } from "vitest";
import { generateTool, type Model } from "../src/generate.js";
import { parseBundle, ContractError } from "../src/contract.js";
import type { Bundle } from "@wildcard/runtime";

// A fake validator so these tests need no browser. The real CMP-05 (validate.ts)
// runs the bundle in headless Chromium; here we just key off a marker so we can
// script pass/fail sequences and exercise the loop deterministically.
const fakeValidate = async (b: Bundle) => {
  const html = b.files["index.html"];
  return html.includes("GOOD")
    ? { pass: true, errors: [] }
    : { pass: false, errors: ["smoke test failed: core function did not run"] };
};

function appBlock(body: string, name = "Tool") {
  return `<wc-app name="${name}" icon="🔧" providers="">\n` +
    "```file:index.html\n" +
    `<!doctype html><html><body>${body}</body></html>\n` +
    "```\n</wc-app>";
}

/** A model that returns a scripted sequence of outputs, one per turn. */
function scriptedModel(outputs: string[]): Model {
  let i = 0;
  return { async complete() { return outputs[Math.min(i++, outputs.length - 1)]; } };
}

describe("contract parsing", () => {
  it("parses a well-formed wc-app block", () => {
    const b = parseBundle(appBlock("hi", "Tip Splitter"));
    expect(b.manifest.id).toBe("tip-splitter");
    expect(b.manifest.name).toBe("Tip Splitter");
    expect(b.files["index.html"]).toContain("hi");
  });

  it("rejects output with no wc-app block", () => {
    expect(() => parseBundle("just some prose")).toThrow(ContractError);
  });

  it("rejects output missing index.html", () => {
    const raw = `<wc-app name="X" icon="🔧" providers="">\n` +
      "```file:app.js\nconsole.log(1)\n```\n</wc-app>";
    expect(() => parseBundle(raw)).toThrow(/index\.html/);
  });
});

describe("generation orchestrator (REQ-GEN-002/004/008)", () => {
  it("ships a tool that passes validation on the first try", async () => {
    const res = await generateTool({
      prompt: "tip splitter",
      system: "sys",
      model: scriptedModel([appBlock("GOOD")]),
      validateFn: fakeValidate,
    });
    expect(res.ok).toBe(true);
    expect(res.turns).toBe(0);
  });

  it("recovers via the bounded repair loop", async () => {
    const res = await generateTool({
      prompt: "tip splitter",
      system: "sys",
      // first two attempts fail validation, third is GOOD
      model: scriptedModel([appBlock("bad1"), appBlock("bad2"), appBlock("GOOD")]),
      validateFn: fakeValidate,
    });
    expect(res.ok).toBe(true);
    expect(res.turns).toBe(2);
  });

  it("never ships a broken tool — fails honestly after the ceiling", async () => {
    const events: string[] = [];
    const res = await generateTool({
      prompt: "impossible",
      system: "sys",
      model: scriptedModel([appBlock("nope")]), // always fails
      maxRepairTurns: 3,
      validateFn: fakeValidate,
      onEvent: (e) => events.push(e.type),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/simpler version/i);
    expect(res.turns).toBe(4); // 1 initial + 3 repairs
    expect(events).toContain("failed");
  });

  it("treats malformed model output as a repairable failure", async () => {
    const res = await generateTool({
      prompt: "x",
      system: "sys",
      model: scriptedModel(["garbage with no block", appBlock("GOOD")]),
      validateFn: fakeValidate,
    });
    expect(res.ok).toBe(true);
    expect(res.turns).toBe(1);
  });
});
