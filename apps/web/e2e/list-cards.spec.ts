// /airdrops as a grid of cards with each project's logo (owner request 2026-10-11).
import { expect, test, type Page } from "@playwright/test";
import { cleanupSeed, seedCardGrid, type CardGridSeed } from "./support/seed";

let grid: CardGridSeed;

test.beforeAll(async () => {
  grid = await seedCardGrid(5);
});

test.afterAll(async () => {
  await cleanupSeed();
});

const cards = (page: Page) => page.getByTestId("project-card");
const cardFor = (page: Page, slug: string) => page.locator(`[data-testid="project-card"][data-slug="${slug}"]`);

async function tops(page: Page): Promise<number[]> {
  const n = await cards(page).count();
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((await cards(page).nth(i).boundingBox())!.y));
  return out;
}

test("3 cards per row at 1280 px, the 4th starting a new row, all of one row equally tall", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/airdrops?chain=${grid.chain}`);
  await expect(cards(page)).toHaveCount(5);
  const [t1, t2, t3, t4] = await tops(page);
  expect(t2).toBe(t1);
  expect(t3).toBe(t1);
  expect(t4!).toBeGreaterThan(t1!);
  const heights = await Promise.all([0, 1, 2].map(async (i) => Math.round((await cards(page).nth(i).boundingBox())!.height)));
  expect(new Set(heights).size).toBe(1);
});

test("2 cards per row at 800 px", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(`/airdrops?chain=${grid.chain}`);
  await expect(cards(page)).toHaveCount(5);
  const [t1, t2, t3] = await tops(page);
  expect(t2).toBe(t1);
  expect(t3!).toBeGreaterThan(t1!);
});

test("1 column at 360 px, with no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/airdrops?chain=${grid.chain}`);
  await expect(cards(page)).toHaveCount(5);
  const all = await tops(page);
  for (let i = 1; i < all.length; i++) expect(all[i]!).toBeGreaterThan(all[i - 1]!);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("a stored logo renders through our own route as image/png with nosniff", async ({ page }) => {
  await page.goto(`/airdrops?chain=${grid.chain}`);
  const img = cardFor(page, grid.slugs[0]!).getByRole("img", { name: `Logo ${grid.names[0]}` });
  await expect(img).toHaveAttribute("src", `/logo/${grid.ids[0]}`);
  // Loaded and decoded (a broken image has naturalWidth 0).
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth)).toBe(1);

  const res = await page.request.get(`/logo/${grid.ids[0]}`);
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers["content-type"]).toBe("image/png");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect(headers["cache-control"]).toBe("public, max-age=86400, stale-while-revalidate=604800");
  expect(headers["set-cookie"]).toBeUndefined();
  expect(Buffer.from(await res.body()).equals(grid.png)).toBe(true);
});

test("the logo route is 404 for a project without a logo and for a bad id", async ({ request }) => {
  expect((await request.get(`/logo/${grid.ids[2]}`)).status()).toBe(404);
  expect((await request.get("/logo/not-a-uuid")).status()).toBe(404);
  expect((await request.get("/logo/..%2F..%2Fetc%2Fpasswd")).status()).toBe(404);
});

test("a project without a logo shows the first letter of its name, and only an X avatar carries the unavatar credit", async ({ page }) => {
  await page.goto(`/airdrops?chain=${grid.chain}`);
  const bare = cardFor(page, grid.slugs[2]!);
  await expect(bare.getByTestId("logo-fallback")).toHaveText(grid.names[2]!.charAt(0).toUpperCase());
  await expect(bare.locator("img")).toHaveCount(0);
  await expect(cardFor(page, grid.slugs[1]!).getByTestId("logo-credit")).toHaveText("Logo: unavatar.io");
  await expect(cardFor(page, grid.slugs[0]!).getByTestId("logo-credit")).toHaveCount(0);
  await expect(bare.getByTestId("logo-credit")).toHaveCount(0);
});

test("the whole card is one link to the project page, reachable by keyboard with a visible focus ring", async ({ page }) => {
  await page.goto(`/airdrops?chain=${grid.chain}`);
  const card = cardFor(page, grid.slugs[0]!);
  await expect(card.getByRole("link")).toHaveCount(1);
  const link = card.getByRole("link", { name: grid.names[0] });
  await link.focus();
  await expect(link).toBeFocused();
  const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/projects/${grid.slugs[0]}$`));
});
