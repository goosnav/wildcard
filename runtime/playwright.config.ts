import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  reporter: [["list"]],
  // `channel: "chromium"` runs the full Chromium build with the new headless
  // mode, so we don't depend on the separate chromium-headless-shell download.
  use: { ...devices["Desktop Chrome"], channel: "chromium" },
});
