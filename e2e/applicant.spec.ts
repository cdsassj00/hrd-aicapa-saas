import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.skip(!EMAIL || !PASSWORD, "E2E_EMAIL / E2E_PASSWORD 가 없으면 건너뛴다");

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox").first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: /로그인|시작|계속/ }).first().click();
  // 역할에 따라 어디로든 갈 수 있다. /login 을 벗어나면 성공으로 본다.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

test("응시자가 로그인하면 마이페이지에 닿고 오류가 없다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await login(page);
  await page.goto("/applicant");
  await expect(page.locator("#root")).not.toBeEmpty();

  // 온보딩으로 튕기면 소속이 없다는 뜻 — 응시자 경로가 막힌 상태다.
  expect(page.url(), "온보딩으로 튕겼다 = 소속 없음").not.toContain("/onboarding");

  expect(errors, `콘솔 오류:\n${errors.join("\n")}`).toEqual([]);
});

test("마이페이지에서 응시 가능한 시험 또는 초대코드 입력을 제공한다", async ({ page }) => {
  await login(page);
  await page.goto("/applicant");

  // 데이터 로딩이 끝나기를 기다린다. "로딩 중" 문구가 사라져야 실제 화면이다.
  await expect(page.getByText(/로딩 중/)).toHaveCount(0, { timeout: 30_000 });

  const body = await page.locator("body").innerText();
  // 둘 중 하나는 반드시 있어야 한다. 없으면 응시자가 할 수 있는 일이 없다.
  expect(
    /초대|응시|시험/.test(body),
    `마이페이지에 응시 수단이 없다. 본문:\n${body.slice(0, 600)}`,
  ).toBe(true);
});
