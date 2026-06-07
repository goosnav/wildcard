// Static-check tests for the validator. These cases are rejected BEFORE the
// browser is launched (validate() returns as soon as a static error is found),
// so they run fast and need no Chromium.

import { describe, it, expect } from "vitest";
import { validate } from "../src/validate.js";
import type { Bundle } from "@wildcard/runtime";

function bundle(html: string, providers: string[] = []): Bundle {
  return {
    manifest: { id: "t", name: "T", icon: "✨", version: 1, providers },
    files: { "index.html": html },
  } as Bundle;
}

describe("validate() static checks", () => {
  it("rejects empty index.html", async () => {
    const r = await validate(bundle("   "));
    expect(r.pass).toBe(false);
    expect(r.errors.join(" ")).toMatch(/empty/i);
  });

  it("rejects a remote <script src>", async () => {
    const r = await validate(bundle('<script src="https://evil.cdn/x.js"></script>'));
    expect(r.pass).toBe(false);
    expect(r.errors.join(" ")).toMatch(/script src/i);
  });

  it("rejects a tool that declares an unknown provider", async () => {
    const r = await validate(bundle("<h1>hi</h1>", ["stocks"]));
    expect(r.pass).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unknown data provider/i);
    expect(r.errors.join(" ")).toMatch(/stocks/);
  });

  it("does not flag a known provider at the static stage", async () => {
    // weather is a real provider, so the unknown-provider check passes; the
    // empty-html guard fires first here, proving the provider check didn't.
    const r = await validate(bundle("   ", ["weather"]));
    expect(r.errors.join(" ")).not.toMatch(/unknown data provider/i);
  });
});
