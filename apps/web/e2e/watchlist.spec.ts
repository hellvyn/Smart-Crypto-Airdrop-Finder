import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";
import { cleanupSeed, seedProjects, type Seed } from "./support/seed";

const PASSWORD = "correct-horse-1";
let seed: Seed;

test.beforeAll(async () => {
  seed = await seedProjects();
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await cleanupSeed();
});

async function signedInUser(page: Page, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  return email;
}

const watchButton = (page: Page) => page.getByRole("button", { name: "Tambah ke watchlist", exact: true });
const unwatchButton = (page: Page) => page.getByRole("button", { name: "Hapus dari watchlist", exact: true });
const rowFor = (page: Page, slug: string) => page.locator(`[data-testid="project-row"][data-slug="${slug}"]`);

async function watchRowCount(slug: string): Promise<number> {
  const db = adminClient();
  const { data: p, error: pe } = await db.from("projects").select("id").eq("slug", slug).single();
  if (pe) throw pe;
  const { data, error } = await db.from("watchlist").select("user_id").eq("project_id", p.id as string);
  if (error) throw error;
  return data.length;
}

test("signed out, the detail page offers 'Login buat pakai watchlist' with a way back", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  const link = page.getByRole("link", { name: "Login buat pakai watchlist" });
  await expect(link).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/projects/${seed.main.slug}`)}`);
  await expect(watchButton(page)).toHaveCount(0);
});

test("an empty watchlist says so", async ({ page }) => {
  await signedInUser(page, "wl-empty");
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "Watchlist kamu" })).toBeVisible();
  await expect(page.getByText("Watchlist kamu masih kosong. Buka sebuah airdrop, lalu klik Tambah ke watchlist.")).toBeVisible();
});

test("watching from the detail page adds it to /watchlist, and unwatching removes it", async ({ page }) => {
  await signedInUser(page, "wl-flow");
  await page.goto(`/projects/${seed.main.slug}`);
  await watchButton(page).click();
  await expect(unwatchButton(page)).toBeVisible();

  await page.goto("/watchlist");
  await expect(rowFor(page, seed.main.slug)).toBeVisible();
  await expect(page.getByText("Watchlist kamu masih kosong. Buka sebuah airdrop, lalu klik Tambah ke watchlist.")).toHaveCount(0);

  await page.goto(`/projects/${seed.main.slug}`);
  await unwatchButton(page).click();
  await expect(watchButton(page)).toBeVisible();

  await page.goto("/watchlist");
  await expect(rowFor(page, seed.main.slug)).toHaveCount(0);
  await expect(page.getByText("Watchlist kamu masih kosong. Buka sebuah airdrop, lalu klik Tambah ke watchlist.")).toBeVisible();
});

test("a fast double click on Watch still leaves exactly one row", async ({ page }) => {
  await signedInUser(page, "wl-double");
  await page.goto(`/projects/${seed.conflicted.slug}`);
  await watchButton(page).dblclick();
  await expect(unwatchButton(page)).toBeVisible();
  await page.goto("/watchlist");
  await expect(rowFor(page, seed.conflicted.slug)).toHaveCount(1);
  expect(await watchRowCount(seed.conflicted.slug)).toBe(1);
});

test("one user's watchlist is not visible to another", async ({ page, browser }) => {
  await signedInUser(page, "wl-a");
  await page.goto(`/projects/${seed.main.slug}`);
  await watchButton(page).click();
  await expect(unwatchButton(page)).toBeVisible();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signedInUser(otherPage, "wl-b");
  await otherPage.goto("/watchlist");
  await expect(rowFor(otherPage, seed.main.slug)).toHaveCount(0);
  await otherPage.goto(`/projects/${seed.main.slug}`);
  await expect(watchButton(otherPage)).toBeVisible();
  await other.close();
});
