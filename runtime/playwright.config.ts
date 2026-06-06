import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"] },
});
