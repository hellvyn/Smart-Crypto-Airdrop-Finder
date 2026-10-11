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
  await page.getByRole("button", { name: "Login", exact: true }).click();
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

test("the green Login button keeps readable text on hover", async ({ page }) => {
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
  // The fill may darken on hover; the text keeps its colour and never matches the fill.
  expect(hovered.text).toBe(resting.text);
  expect(hovered.text).not.toBe(hovered.fill);
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

test("every page has an Indonesian AirdropIQ tab title", async ({ page }) => {
  for (const [path, title] of [
    ["/", "AirdropIQ"],
    ["/airdrops", "Daftar airdrop · AirdropIQ"],
    ["/login", "Login · AirdropIQ"],
  ]) {
    await page.goto(path!);
    await expect(page, path).toHaveTitle(title!);
  }
  await signIn(page, "titles");
  for (const [path, title] of [
    ["/watchlist", "Watchlist · AirdropIQ"],
    ["/wallets", "Wallet · AirdropIQ"],
    ["/settings", "Akun · AirdropIQ"],
    ["/garapan", "Garapan saya · AirdropIQ"],
  ]) {
    await page.goto(path!);
    await expect(page, path).toHaveTitle(title!);
  }
});

test("the signed-in header is Indonesian", async ({ page }) => {
  await signIn(page, "header-id");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Wallet", exact: true })).toHaveAttribute("href", "/wallets");
  await expect(header.getByRole("link", { name: "Akun", exact: true })).toHaveAttribute("href", "/settings");
  await expect(header.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
  await expect(header.getByText(/Wallets|Settings|Sign out/)).toHaveCount(0);
});

/** Boxes on the page that scroll sideways on their own (the plan table and the member menu once did). */
const sideScrollers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => ["auto", "scroll"].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)
      .map((e) => e.className || e.tagName),
  );

test.describe("360px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("visitor pages do not scroll sideways, and neither does any box inside them", async ({ page }) => {
    for (const path of ["/", "/airdrops", "/coach", "/login"]) {
      await page.goto(path);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, path).toBeLessThanOrEqual(360);
      expect(await sideScrollers(page), path).toEqual([]);
    }
    // The visitor menu is on the phone too, AI Coach included.
    await expect(page.getByRole("banner").getByRole("link", { name: "AI Coach" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  });

  test("a signed-in header with a long email does not scroll sideways", async ({ page }) => {
    await signIn(page, "layout-narrow-with-a-rather-long-address");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360);
    await expect(page.getByRole("banner").getByRole("link", { name: "Watchlist" })).toBeVisible();
    // Every menu link shows without swiping, and Logout stays on the logo's row.
    expect(await sideScrollers(page)).toEqual([]);
    for (const name of ["Airdrop", "Garapan saya", "AI Coach", "Watchlist", "Wallet", "Akun"]) {
      await expect(page.getByRole("banner").getByRole("link", { name, exact: true })).toBeInViewport();
    }
    const logout = await page.getByRole("button", { name: "Logout" }).boundingBox();
    const logo = await page.getByRole("banner").getByRole("link", { name: /AirdropIQ/i }).boundingBox();
    expect(Math.abs(logout!.y - logo!.y)).toBeLessThan(40);
  });
});
