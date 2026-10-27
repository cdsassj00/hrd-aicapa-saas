import { expect, test } from "@playwright/test";

// 로그인하지 않은 사람이 보는 화면. 여기가 깨지면 아무도 들어오지 못한다.
test.describe("비로그인", () => {
  test("랜딩이 열리고 자바스크립트 오류가 없다", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    // 번들이 뜨지 못하면 #root 가 비어 있다 — 흰 화면의 실제 신호
    await expect(page.locator("#root")).not.toBeEmpty();

    expect(errors, `콘솔 오류:\n${errors.join("\n")}`).toEqual([]);
  });

  test("로그인 화면에 입력란과 제출이 있다", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("textbox").first()).toBeVisible();
  });

  test("보호된 화면은 로그인으로 보낸다", async ({ page }) => {
    await page.goto("/admin/exams");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain("/login");
  });
});
