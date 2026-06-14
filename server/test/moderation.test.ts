// Unit tests for the in-memory moderation telemetry behind /v1/reports.

import { describe, it, expect } from "vitest";
import { recordRefusal, moderationReport } from "../src/moderation.js";

describe("moderation telemetry", () => {
  it("counts input and output refusals by category", () => {
    const before = moderationReport();
    recordRefusal("input", "malware");
    recordRefusal("input", "phishing");
    recordRefusal("output", "malware");
    const after = moderationReport();

    expect(after.inputRefusals).toBe(before.inputRefusals + 2);
    expect(after.outputRefusals).toBe(before.outputRefusals + 1);
    expect(after.totalRefusals).toBe(before.totalRefusals + 3);
    expect(after.byCategory.malware).toBe((before.byCategory.malware ?? 0) + 2);
    expect(after.byCategory.phishing).toBe((before.byCategory.phishing ?? 0) + 1);
    expect(after.lastRefusalAt).not.toBeNull();
  });
});
