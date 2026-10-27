import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CODE = process.env.E2E_INVITE_CODE ?? "";

test.skip(!EMAIL || !PASSWORD, "E2E 계정이 없으면 건너뛴다");

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox").first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: /로그인|시작|계속/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

// 응시자가 초대코드로 응시를 신청하는 경로. 제품의 핵심이다.
// 여기가 막히면 고객사 직원이 시험을 볼 수 없다.
test("초대코드 입력이 화면에 있고, 틀린 코드에는 사람이 읽을 수 있는 거부를 준다", async ({ page }) => {
  await login(page);
  await page.goto("/applicant");
  await expect(page.getByText(/로딩 중/)).toHaveCount(0, { timeout: 30_000 });

  // 입력란은 "응시코드 입력" 버튼을 눌러야 열린다
  await page.getByRole("button", { name: /응시코드 입력/ }).first().click();
  const codeInput = page.locator('input[placeholder*="A1B2C3D4"]').first();
  await expect(codeInput, "초대코드 입력란이 없다").toBeVisible({ timeout: 15_000 });

  // 존재하지 않는 코드. 조용히 실패하면 응시자는 왜 안 되는지 알 수 없다.
  await codeInput.fill("ZZZZZZZZ");
  await page.getByRole("button", { name: /^확인$/ }).first().click();

  const toast = page.locator('[data-sonner-toast], [role="status"], [role="alert"]');
  await expect(toast.first(), "틀린 코드인데 아무 안내도 없다").toBeVisible({
    timeout: 20_000,
  });
  // 어떤 문구가 떴는지 기록에 남긴다 — 메시지가 기술 오류면 그것도 결함이다.
  console.log("틀린 코드 응답:", (await toast.first().innerText()).slice(0, 200));
});

test("유효한 초대코드를 넣으면 응시 신청까지 간다", async ({ page }) => {
  // 코드는 1회용이다(시험 제출 후 재사용 불가). 매 실행마다 새 코드를 발급해 넣는다.
  test.skip(!CODE, "E2E_INVITE_CODE 가 없으면 실제 코드 검증은 건너뛴다");
  await login(page);
  await page.goto(`/applicant?invite=${CODE}`);
  await expect(page.getByText(/로딩 중/)).toHaveCount(0, { timeout: 30_000 });

  // redeem_exam_invitation(0037) 이 세션을 확보하면 대기실로 이동한다
  await page.waitForURL(/\/applicant\/waiting-room\//, { timeout: 30_000 });
});
