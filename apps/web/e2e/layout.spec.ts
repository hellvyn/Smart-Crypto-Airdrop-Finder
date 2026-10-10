import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";

const PASSWORD = "correct-horse-1";

test.afterAll(async () => {
  await deleteCreatedUsers();
});

async function signIn(page: Page, tag: string): Promise<void> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
}

test("page is Indonesian, titled AirdropIQ, and the visitor header offers Login", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page).toHaveTitle("AirdropIQ");
  const header = page.getByRole("banner");
  await expect(header.getByText("AirdropIQ").first()).toBeVisible();
  await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
});

test("the dark Login button keeps readable text on hover", async ({ page }) => {
  await page.goto("/");
  const login = page.getByRole("banner").getByRole("link", { name: "Login" });
  const colors = () =>
    login.evaluate((el) => {
      const style = getComputedStyle(el);
      return { text: style.color, fill: style.backgroundColor };
    });
  const resting = await colors();
  expect(resting.text).not.toBe(resting.fill);
  await login.hover();
  const hovered = await colors();
  expect(hovered.fill).toBe(resting.fill);
  expect(hovered.text).toBe(resting.text);
});

test("the header never links to signup (#46)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").locator('a[href*="signup"]')).toHaveCount(0);
  await expect(page.getByRole("banner").getByText(/sign up|daftar/i)).toHaveCount(0);
});

test("a signed-in user sees account links in the header instead of Login", async ({ page }) => {
  await signIn(page, "layout");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Watchlist" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Login" })).toHaveCount(0);
});

test.describe("360px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("visitor pages do not scroll sideways", async ({ page }) => {
    for (const path of ["/", "/login"]) {
      await page.goto(path);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, path).toBeLessThanOrEqual(360);
    }
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  });

  test("a signed-in header with a long email does not scroll sideways", async ({ page }) => {
    await signIn(page, "layout-narrow-with-a-rather-long-address");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360);
    await expect(page.getByRole("banner").getByRole("link", { name: "Watchlist" })).toBeVisible();
  });
});
