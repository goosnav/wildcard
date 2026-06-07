// Route-level tests for the public, unauthenticated endpoints. Importing the
// server module gives us the configured Hono `app` without binding a socket
// (the listener only starts when the module is the process entrypoint), so we
// can exercise real routes via app.request().

import { describe, it, expect } from "vitest";
import { app } from "../src/server.js";

describe("GET /v1/manifest", () => {
  it("returns the public app config the client self-configures from", async () => {
    const res = await app.request("/v1/manifest");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.version).toBe("string");
    expect(body.freeBuildLimit).toBe(3);
    expect(body.priceUsd).toBe(9.99);

    // The live-data catalog, with no secrets and no fetch impl leaked.
    const ids = body.providers.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(["currency", "weather"]);
    for (const p of body.providers) expect(p).not.toHaveProperty("fetch");

    // Feature flags reflect configuration (both off with no keys in test env).
    expect(body.features).toEqual({ billing: false, email: false });
  });

  it("requires no auth", async () => {
    const res = await app.request("/v1/manifest"); // no Authorization header
    expect(res.status).toBe(200);
  });
});

describe("GET /health", () => {
  it("reports core subsystem status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("provider");
    expect(body).toHaveProperty("store");
    expect(body.guard).toHaveProperty("buildCeiling");
  });
});
