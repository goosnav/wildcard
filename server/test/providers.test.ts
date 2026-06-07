// Network-free tests for the provider catalog + proxy validation. We deliberately
// avoid hitting live upstreams here (that's covered by the manual smoke test);
// these assert the catalog shape, auth-independent param validation, and the
// branches that short-circuit before any fetch.

import { describe, it, expect } from "vitest";
import {
  providerCatalog,
  providerSamples,
  isProvider,
  callProvider,
} from "../src/providers.js";

describe("provider catalog", () => {
  it("offers weather + currency and never leaks the fetch impl", () => {
    const cat = providerCatalog();
    const ids = cat.map((p) => p.id).sort();
    expect(ids).toEqual(["currency", "weather"]);
    for (const p of cat) {
      expect(p).toHaveProperty("label");
      expect(p).toHaveProperty("description");
      expect(Array.isArray(p.params)).toBe(true);
      expect(p).not.toHaveProperty("fetch");
    }
  });

  it("exposes a sample per provider for the validator", () => {
    const s = providerSamples();
    expect(Object.keys(s).sort()).toEqual(["currency", "weather"]);
  });

  it("isProvider reflects the catalog", () => {
    expect(isProvider("weather")).toBe(true);
    expect(isProvider("currency")).toBe(true);
    expect(isProvider("stocks")).toBe(false);
  });
});

describe("callProvider validation (no network)", () => {
  it("404s an unknown provider", async () => {
    const r = await callProvider("stocks", {});
    expect(r).toEqual({ ok: false, status: 404, error: expect.stringContaining("unknown") });
  });

  it("400s missing/invalid weather coordinates before any fetch", async () => {
    const r = await callProvider("weather", { latitude: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("400s an out-of-range latitude", async () => {
    const r = await callProvider("weather", { latitude: 999, longitude: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("400s a malformed currency code", async () => {
    const r = await callProvider("currency", { from: "US", to: "EUR" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("converts same-currency without hitting the network", async () => {
    const r = await callProvider("currency", { from: "usd", to: "USD", amount: 42 });
    expect(r).toEqual({ ok: true, data: { from: "USD", to: "USD", amount: 42, rate: 1, result: 42, date: null } });
  });
});
