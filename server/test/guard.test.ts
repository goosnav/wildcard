// Unit tests for the spend/abuse guard (REQ-NFR-006). All time is injected via
// the `now` argument so these are deterministic and network-free.

import { describe, it, expect } from "vitest";
import { FixedWindow, PeriodCeiling } from "../src/guard.js";

describe("FixedWindow rate limiter", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const rl = new FixedWindow(3, 60_000);
    const t = 1_000_000;
    expect(rl.check("u1", t).ok).toBe(true);
    expect(rl.check("u1", t).ok).toBe(true);
    const third = rl.check("u1", t);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = rl.check("u1", t);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates keys from one another", () => {
    const rl = new FixedWindow(1, 60_000);
    const t = 2_000_000;
    expect(rl.check("a", t).ok).toBe(true);
    expect(rl.check("a", t).ok).toBe(false);
    expect(rl.check("b", t).ok).toBe(true); // b has its own window
  });

  it("resets after the window elapses", () => {
    const rl = new FixedWindow(1, 60_000);
    const t = 3_000_000;
    expect(rl.check("u", t).ok).toBe(true);
    expect(rl.check("u", t).ok).toBe(false);
    expect(rl.check("u", t + 60_000).ok).toBe(true); // new window
  });

  it("treats a non-positive limit as disabled (always ok)", () => {
    const rl = new FixedWindow(0, 60_000);
    for (let i = 0; i < 100; i++) expect(rl.check("u", 4_000_000).ok).toBe(true);
  });
});

describe("PeriodCeiling", () => {
  it("reserves up to the cap, then sheds load", () => {
    const c = new PeriodCeiling(2, 24 * 3_600_000);
    const t = 5_000_000;
    expect(c.tryReserve(t)).toBe(true);
    expect(c.tryReserve(t)).toBe(true);
    expect(c.tryReserve(t)).toBe(false); // full
    expect(c.status(t).remaining).toBe(0);
  });

  it("release hands a slot back (a failed build is free)", () => {
    const c = new PeriodCeiling(1, 24 * 3_600_000);
    const t = 6_000_000;
    expect(c.tryReserve(t)).toBe(true);
    expect(c.tryReserve(t)).toBe(false);
    c.release();
    expect(c.tryReserve(t)).toBe(true); // slot reclaimed
  });

  it("rolls over after the period", () => {
    const c = new PeriodCeiling(1, 1000);
    const t = 7_000_000;
    expect(c.tryReserve(t)).toBe(true);
    expect(c.tryReserve(t)).toBe(false);
    expect(c.tryReserve(t + 1000)).toBe(true); // next period
  });

  it("is disabled when the limit is non-positive", () => {
    const c = new PeriodCeiling(0, 1000);
    expect(c.enabled).toBe(false);
    for (let i = 0; i < 50; i++) expect(c.tryReserve(8_000_000)).toBe(true);
    expect(c.status().limit).toBeNull();
  });
});
