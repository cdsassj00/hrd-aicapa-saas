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
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 컨테이너에 미리 설치된 Chromium 을 쓴다. @playwright/test 가 기대하는
        // 리비전과 다를 수 있어 경로를 직접 지정한다 — playwright install 로
        // 내려받지 않는다(이미지에 이미 있고, 네트워크·용량을 쓴다).
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : {},
      },
    },
  ],
});
