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
  await page.goto(`/airdrops?status=live&chain=${chain}`);
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText(/ 55 airdrop\. Urutannya dari deadline terdekat, lalu yang paling baru kami lihat\.$/)).toBeVisible();
  // Newest last_seen first, then the next page continues from there.
  await expect(rows(page).first()).toHaveAttribute("data-slug", slugs[0]!);
  await expect(rows(page).last()).toHaveAttribute("data-slug", slugs[49]!);
  await expect(page.getByRole("link", { name: "Sebelumnya" })).toHaveCount(0);

  await page.getByRole("link", { name: "Berikutnya" }).click();
  await expect(page).toHaveURL(new RegExp(`/airdrops\\?status=live&chain=${chain}&page=2$`));
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).first()).toHaveAttribute("data-slug", slugs[50]!);
  await expect(rows(page).last()).toHaveAttribute("data-slug", slugs[54]!);
  await expect(page.getByRole("link", { name: "Berikutnya" })).toHaveCount(0);

  await page.getByRole("link", { name: "Sebelumnya" }).click();
  await expect(page).toHaveURL(new RegExp(`/airdrops\\?status=live&chain=${chain}$`));
  await expect(rows(page)).toHaveCount(50);
});

test("the chain filter is case-insensitive, and an invalid page falls back to page 1", async ({ page }) => {
  await page.goto(`/airdrops?chain=${chain.toUpperCase()}&page=abc`);
  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).first()).toHaveAttribute("data-slug", slugs[0]!);
});

test("a page past the end shows an empty page with a link back", async ({ page }) => {
  await page.goto(`/airdrops?chain=${chain}&page=9`);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("Gak ada airdrop di halaman ini.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sebelumnya" })).toHaveAttribute("href", `/airdrops?chain=${chain}&page=2`);
});

test("an unknown chain stays selected in the filter", async ({ page }) => {
  await page.goto("/airdrops?chain=nosuchchain");
  await expect(page.getByLabel("Chain")).toHaveValue("nosuchchain");
  await expect(page.getByRole("option", { name: "nosuchchain (gak ada yang cocok)" })).toHaveCount(1);
  await expect(rows(page)).toHaveCount(0);
});

test("a malformed chain value renders the list instead of an error page", async ({ page }) => {
  for (const raw of ["a%7D", "%22", "%5C", "a%2Cb"]) {
    const res = await page.goto(`/airdrops?chain=${raw}`);
    expect(res?.status(), raw).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Daftar airdrop" })).toBeVisible();
    await expect(page.getByLabel("Chain").locator("option:checked")).toContainText("(gak ada yang cocok)");
    await expect(rows(page)).toHaveCount(50);
  }
});
