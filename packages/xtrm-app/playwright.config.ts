import { defineConfig, devices } from "@playwright/test";

// Browser tests run the real app on fixtures only: no Console v1 backend, no sb, no research CLI.
const PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  // Real-host projects need an agent host: playwright.real-host*.config.ts, playwright.acceptance.config.ts.
  testIgnore: ["real-host/**", "acceptance/**"],
  outputDir: "e2e/.results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { VITE_XTRM_GITHUB: "fixture", VITE_XTRM_SUBSTRATE: "fixture", VITE_XTRM_RESEARCH: "fixture", VITE_XTRM_AGENT_HOST: "fixture" },
  },
});
