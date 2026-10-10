import { expect, test } from "@playwright/test";
import { cleanupSeed, seedManyProjects } from "./support/seed";

let chain: string;
let slugs: string[];

test.beforeAll(async () => {
  ({ chain, slugs } = await seedManyProjects(55));
});

test.afterAll(async () => {
  await cleanupSeed();
});

const rows = (page: import("@playwright/test").Page) => page.getByTestId("project-row");

test("the list is paged 50 per page, and filters survive paging", async ({ page }) => {
  await page.goto(`/?status=live&chain=${chain}`);
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText("55 airdrops")).toBeVisible();
  // Newest last_seen first, then the next page continues from there.
  await expect(rows(page).first()).toHaveAttribute("data-slug", slugs[0]!);
  await expect(rows(page).last()).toHaveAttribute("data-slug", slugs[49]!);
  await expect(page.getByRole("link", { name: "Previous" })).toHaveCount(0);

  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(new RegExp(`status=live&chain=${chain}&page=2$`));
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).first()).toHaveAttribute("data-slug", slugs[50]!);
  await expect(rows(page).last()).toHaveAttribute("data-slug", slugs[54]!);
  await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);

  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(new RegExp(`status=live&chain=${chain}$`));
  await expect(rows(page)).toHaveCount(50);
});

test("the chain filter is case-insensitive, and an invalid page falls back to page 1", async ({ page }) => {
  await page.goto(`/?chain=${chain.toUpperCase()}&page=abc`);
  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).first()).toHaveAttribute("data-slug", slugs[0]!);
});

test("a page past the end shows an empty page with a link back", async ({ page }) => {
  await page.goto(`/?chain=${chain}&page=9`);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No airdrops on this page.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous" })).toHaveAttribute("href", `/?chain=${chain}&page=2`);
});

test("an unknown chain stays selected in the filter", async ({ page }) => {
  await page.goto("/?chain=nosuchchain");
  await expect(page.getByLabel("Chain")).toHaveValue("nosuchchain");
  await expect(page.getByRole("option", { name: "nosuchchain (no matches)" })).toHaveCount(1);
  await expect(rows(page)).toHaveCount(0);
});

test("a malformed chain value renders the list instead of an error page", async ({ page }) => {
  for (const raw of ["a%7D", "%22", "%5C", "a%2Cb"]) {
    const res = await page.goto(`/?chain=${raw}`);
    expect(res?.status(), raw).toBe(200);
    await expect(page.getByRole("heading", { name: "Airdrops" })).toBeVisible();
    await expect(page.getByLabel("Chain").locator("option:checked")).toContainText("(no matches)");
    await expect(rows(page)).toHaveCount(50);
  }
});
