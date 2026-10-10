import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";
import { cleanupSeed, seedProjects, type Seed } from "./support/seed";

// The member's profile has no time zone, so "today" is the UTC day on both the server and the heatmap.

const PASSWORD = "correct-horse-1";
const EMPTY = "Kamu belum menggarap project apa pun. Buka sebuah airdrop dan klik Mulai garap.";
let seed: Seed;

test.beforeAll(async () => {
  seed = await seedProjects();
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await cleanupSeed();
});

async function signIn(page: Page, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  return email;
}

async function userIdOf(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error("test user not found");
  return user.id;
}

async function startFarming(page: Page, slug: string): Promise<void> {
  await page.goto(`/projects/${slug}`);
  await page.getByRole("button", { name: "Mulai garap" }).click();
  await expect(page.getByRole("button", { name: "Berhenti garap" })).toBeVisible();
}

const cardFor = (page: Page, name: string) => page.getByRole("article", { name });
const todayCell = (card: Locator) => card.locator(".heat-today");

test("a visitor's Mulai garap leads to login and back, and /garapan needs an account", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByRole("link", { name: "Mulai garap" })).toHaveAttribute(
    "href",
    `/login?next=${encodeURIComponent(`/projects/${seed.main.slug}`)}`,
  );
  await expect(page.getByRole("button", { name: "Mulai garap" })).toHaveCount(0);
  await page.goto("/garapan");
  await expect(page).toHaveURL(/\/login\?next=%2Fgarapan$/);
});

test("a member farms a project: main task, daily checks move today's cell, weekly status, then Berhenti garap", async ({ page }) => {
  await signIn(page, "farm-flow");
  await expect(page.getByRole("banner").getByRole("link", { name: "Garapan saya" })).toHaveAttribute("href", "/garapan");
  await startFarming(page, seed.main.slug);

  await page.goto("/garapan");
  const card = cardFor(page, seed.main.name);
  const main = card.getByRole("region", { name: "Task utama" });
  const today = card.getByRole("region", { name: "Hari ini" });
  await expect(main.getByText("0/1 selesai")).toBeVisible();
  await expect(today.getByText("0 dari 2 task hari ini")).toBeVisible();
  await expect(todayCell(card)).toHaveClass(/heat-level-0/);
  await expect(todayCell(card)).toHaveAttribute("aria-label", /: 0\/2 daily task$/);

  // The main task is done once: progress moves, today's heatmap cell does not.
  await main.getByRole("checkbox", { name: "Bridge to the main chain" }).click();
  await expect(main.getByRole("checkbox", { name: "Bridge to the main chain" })).toHaveAttribute("aria-checked", "true");
  await expect(main.getByText("1/1 selesai")).toBeVisible();
  await expect(todayCell(card)).toHaveClass(/heat-level-0/);

  // One of two daily tasks: today's cell goes up to 50-99%.
  await today.getByRole("checkbox", { name: "Swap once on the DEX" }).click();
  await expect(today.getByText("1 dari 2 task hari ini")).toBeVisible();
  await expect(todayCell(card)).toHaveClass(/heat-level-2/);
  await expect(todayCell(card)).toHaveAttribute("aria-label", /: 1\/2 daily task$/);

  // Unticking takes it back down.
  await today.getByRole("checkbox", { name: "Swap once on the DEX" }).click();
  await expect(today.getByText("0 dari 2 task hari ini")).toBeVisible();
  await expect(todayCell(card)).toHaveClass(/heat-level-0/);

  const weekly = card.getByRole("region", { name: "Weekly" });
  await expect(weekly.getByText("Belum minggu ini")).toBeVisible();
  await weekly.getByRole("checkbox", { name: "Join the weekly quest" }).click();
  await expect(weekly.getByText("Minggu ini udah")).toBeVisible();

  await card.getByRole("button", { name: "Berhenti garap" }).click();
  await expect(cardFor(page, seed.main.name)).toHaveCount(0);
  await expect(page.getByText(EMPTY)).toBeVisible();
});

test("another member sees nothing of someone else's farming", async ({ page, browser }) => {
  await signIn(page, "farm-a");
  await startFarming(page, seed.main.slug);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, "farm-b");
  await otherPage.goto("/garapan");
  await expect(otherPage.getByText(EMPTY)).toBeVisible();
  await expect(otherPage.getByRole("article")).toHaveCount(0);
  await otherPage.goto(`/projects/${seed.main.slug}`);
  await expect(otherPage.getByRole("button", { name: "Mulai garap" })).toBeVisible();
  await other.close();
});

test("a project without source steps can still be farmed with the member's own task (review focus 2)", async ({ page }) => {
  await signIn(page, "farm-own");
  await startFarming(page, seed.conflicted.slug);

  await page.goto("/garapan");
  const card = cardFor(page, seed.conflicted.name);
  await expect(card.getByText("Belum ada daily task. Tambah task sendiri.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Ambil ulang step dari source" })).toBeVisible();

  await card.getByText("+ Tambah task sendiri").click();
  await card.getByRole("textbox", { name: "Task" }).fill("Like the latest post");
  await card.getByRole("combobox", { name: "Seberapa sering" }).selectOption("daily");
  await card.getByRole("button", { name: "Tambah task" }).click();
  const today = card.getByRole("region", { name: "Hari ini" });
  await expect(today.getByRole("checkbox", { name: "Like the latest post" })).toBeVisible();
  await expect(today.getByText("0 dari 1 task hari ini")).toBeVisible();

  await card.getByRole("button", { name: "Arsipkan task: Like the latest post" }).click();
  await expect(card.getByText("Belum ada daily task. Tambah task sendiri.")).toBeVisible();
});

test("ticking a task archived in another tab explains it on /garapan", async ({ page }) => {
  const email = await signIn(page, "farm-stale");
  await startFarming(page, seed.main.slug);
  await page.goto("/garapan");
  const card = cardFor(page, seed.main.name);
  const box = card.getByRole("checkbox", { name: "Check in on the points page" });
  await expect(box).toBeVisible();

  // The other tab: the task is archived after this page was drawn.
  const { error } = await adminClient()
    .from("farming_tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", await userIdOf(email))
    .eq("text", "Check in on the points page")
    .is("archived_at", null);
  if (error) throw error;

  await box.click();
  await expect(page).toHaveURL(/\/garapan\?error=task_inactive$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Task itu udah diarsipkan");
  await expect(card.getByRole("checkbox", { name: "Check in on the points page" })).toHaveCount(0);
});

test.describe("360px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("Garapan saya with a year-long heatmap does not scroll sideways", async ({ page }) => {
    await signIn(page, "farm-narrow");
    await startFarming(page, seed.conflicted.slug);
    await page.goto("/garapan");
    await expect(cardFor(page, seed.conflicted.name)).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360);
    // The heatmap scrolls inside its own box instead.
    const box = cardFor(page, seed.conflicted.name).getByRole("group", { name: `Progres ${seed.conflicted.name}` });
    const scroll = await box.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
    expect(scroll.inner).toBeGreaterThan(scroll.outer);
  });
});
