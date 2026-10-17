// Playwright config for the StayOnTarget.html test suite. The page is opened straight from disk (file://);
// there is no server. `npm test` runs everything except the @soak test; `npm run test:soak` runs only that.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  expect: {
    timeout: 5_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide", scale: "css" }
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    actionTimeout: 5_000,
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium" }]
});
