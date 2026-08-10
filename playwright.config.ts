import { defineConfig, devices } from "@playwright/test";

// 러버블 에이전트용 공유 설정(lovable-agent-playwright-config)을 걷어내고
// 표준 Playwright 설정으로 되돌렸다.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
