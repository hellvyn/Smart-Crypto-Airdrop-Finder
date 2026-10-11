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

// ---- "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7) ----

const changesSection = (page: Page) => page.getByRole("region", { name: "Perubahan sejak kunjungan terakhir" });

/** Writes changes for one project as one pipeline run would: every row shares the run's changed_at. */
async function recordRun(
  slug: string,
  rows: { field: string; old_value: string | null; new_value: string }[],
): Promise<void> {
  const db = adminClient();
  const { data: p, error: pe } = await db.from("projects").select("id").eq("slug", slug).single();
  if (pe) throw pe;
  const changedAt = new Date().toISOString();
  const { error } = await db
    .from("project_changes")
    .insert(rows.map((r) => ({ project_id: p.id as string, changed_at: changedAt, ...r })));
  if (error) throw error;
}

async function watch(page: Page, slug: string): Promise<void> {
  await page.goto(`/projects/${slug}`);
  await watchButton(page).click();
  await expect(unwatchButton(page)).toBeVisible();
}

test("a watched project leaving the list shows 'Keluar dari list' until 'Tandai sudah dibaca'", async ({ page }) => {
  await signedInUser(page, "wl-changes-out");
  await watch(page, seed.main.slug);
  await recordRun(seed.main.slug, [{ field: "curated", old_value: "true", new_value: "false" }]);

  await page.goto("/watchlist");
  const onWatchlist = changesSection(page);
  await expect(onWatchlist.getByText("Keluar dari list")).toBeVisible();
  await expect(onWatchlist.getByRole("link", { name: seed.main.name })).toHaveAttribute(
    "href",
    `/projects/${seed.main.slug}`,
  );

  await page.goto("/airdrops");
  await expect(changesSection(page).getByText("Keluar dari list")).toBeVisible();
  await changesSection(page).getByRole("button", { name: "Tandai sudah dibaca" }).click();
  await expect(changesSection(page)).toHaveCount(0);

  await page.goto("/watchlist");
  await expect(rowFor(page, seed.main.slug)).toBeVisible();
  await expect(changesSection(page)).toHaveCount(0);
});

test("a watched project that ended shows 'Udah ended', not 'Keluar dari list', even if it left the list in that run", async ({
  page,
}) => {
  await signedInUser(page, "wl-changes-ended");
  await watch(page, seed.conflicted.slug);
  await recordRun(seed.conflicted.slug, [
    { field: "status", old_value: "live", new_value: "ended" },
    { field: "curated", old_value: "true", new_value: "false" },
  ]);

  await page.goto("/watchlist");
  await expect(changesSection(page).getByText("Udah ended")).toBeVisible();
  await expect(changesSection(page).getByText("Keluar dari list")).toHaveCount(0);
});

test("a member who does not watch the project never sees its changes", async ({ page }) => {
  await recordRun(seed.main.slug, [{ field: "risk_level", old_value: "low", new_value: "critical" }]);
  await signedInUser(page, "wl-changes-other");
  await page.goto("/watchlist");
  await expect(changesSection(page)).toHaveCount(0);
  await page.goto("/airdrops");
  await expect(changesSection(page)).toHaveCount(0);
});
