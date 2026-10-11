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
  await page.getByRole("button", { name: "Login", exact: true }).click();
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

test("a visitor sees no Mulai garap on the project page, and /garapan needs an account", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  // The page did render its actions row (the visitor's watch link), but farming is for signed-in members only.
  await expect(page.getByRole("link", { name: "Login buat pakai watchlist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mulai garap" })).toHaveCount(0);
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

test("once a snapshot has passed, the heatmap still holds today and the streak counts it", async ({ page }) => {
  const email = await signIn(page, "farm-passed");
  await startFarming(page, seed.main.slug);

  // Farming began five days ago and a snapshot fell yesterday; the seeded snapshot in ten days is still ahead.
  const db = adminClient();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const project = await db.from("projects").select("id").eq("slug", seed.main.slug).single();
  if (project.error) throw project.error;
  const projectId = project.data.id as string;
  const source = await db.from("deadlines").select("document_id").eq("project_id", projectId).limit(1).single();
  if (source.error) throw source.error;
  const moved = await db
    .from("farming_projects")
    .update({ started_at: `${day(-5)}T12:00:00Z` })
    .eq("user_id", await userIdOf(email))
    .eq("project_id", projectId);
  if (moved.error) throw moved.error;
  const added = await db
    .from("deadlines")
    .insert({ project_id: projectId, document_id: source.data.document_id, kind: "snapshot", date: day(-1), precision: "exact", text: "Snapshot yesterday" })
    .select("id")
    .single();
  if (added.error) throw added.error;

  try {
    await page.goto("/garapan");
    const card = cardFor(page, seed.main.name);
    await expect(card.getByText("Sisa 11 hari sampai snapshot")).toBeVisible();
    await expect(todayCell(card)).toHaveAttribute("data-day", day(0));
    await expect(card.getByText("Streak: 0 hari")).toBeVisible();

    const today = card.getByRole("region", { name: "Hari ini" });
    await today.getByRole("checkbox", { name: "Swap once on the DEX" }).click();
    await today.getByRole("checkbox", { name: "Check in on the points page" }).click();
    await expect(today.getByText("2 dari 2 task hari ini")).toBeVisible();
    await expect(todayCell(card)).toHaveClass(/heat-level-3/);
    await expect(card.getByText("Streak: 1 hari")).toBeVisible();
  } finally {
    const removed = await db.from("deadlines").delete().eq("id", added.data.id);
    if (removed.error) throw removed.error;
  }
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

/**
 * An ended project (status ended, latest curation in the Ended tab) the member farms, created through the service
 * role. `geckoId` adds a coingecko_listed signal; the local price stub prices every coin except "e2e-noprice-*".
 * Deleting the project removes the farming row and the result with it.
 */
async function endedProjectFarmedBy(email: string, tag: string, geckoId: string | null): Promise<{ id: string; name: string }> {
  const db = adminClient();
  const unique = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name = `E2E Ended ${unique}`;
  const now = new Date().toISOString();
  const project = await db
    .from("projects")
    .insert({ slug: `e2e-ended-${unique}`, name, name_key: name.toLowerCase(), token_symbol: "ENDR", status: "ended", first_seen: now, last_seen: now })
    .select("id")
    .single();
  if (project.error) throw project.error;
  const id = project.data.id as string;
  const endedOn = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const curation = await db.from("curations").insert({ project_id: id, passed: true, tab: "ended", status_at: "ended", ended_on: endedOn, computed_at: now });
  if (curation.error) throw curation.error;
  if (geckoId) {
    const signal = await db
      .from("project_signals")
      .insert({ project_id: id, kind: "coingecko_listed", value: { gecko_id: geckoId }, source: "defillama", verified: true, observed_at: now });
    if (signal.error) throw signal.error;
  }
  const farming = await db.from("farming_projects").insert({ user_id: await userIdOf(email), project_id: id });
  if (farming.error) throw farming.error;
  return { id, name };
}

async function deleteProject(id: string): Promise<void> {
  const { error } = await adminClient().from("projects").delete().eq("id", id);
  if (error) throw error;
}

test("an ended project asks for the result; 1250 tokens show in Hasil kamu and raise Total hasil garapan", async ({ page }) => {
  const email = await signIn(page, "farm-result");
  await startFarming(page, seed.main.slug);
  const ended = await endedProjectFarmedBy(email, "priced", "e2e-priced-token");
  try {
    await page.goto("/garapan");
    const summary = page.getByTestId("garapan-summary");
    await expect(summary).toContainText("≈ $0");
    await expect(summary).toContainText("Total hasil garapan");
    // A project still running has no result form.
    await expect(cardFor(page, seed.main.name).getByRole("region", { name: "Dapet berapa dari airdrop ini?" })).toHaveCount(0);

    const card = cardFor(page, ended.name);
    const ask = card.getByRole("region", { name: "Dapet berapa dari airdrop ini?" });
    const claimed = new Date(Date.now() - 2 * 86_400_000);
    await ask.getByLabel("Jumlah token").fill("1250");
    await ask.getByLabel("Tanggal claim").fill(claimed.toISOString().slice(0, 10));
    await ask.getByRole("button", { name: "Simpan" }).click();

    await expect(page).toHaveURL(/\/garapan$/);
    const result = card.getByRole("region", { name: "Hasil kamu" });
    await expect(result.getByText("1.250 ENDR")).toBeVisible();
    // The stub prices the token at $0.32 on the claim day and $0.304 now.
    const day = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(claimed);
    await expect(result.getByText(`≈ $400 waktu claim (${day}) · sekarang ≈ $380`)).toBeVisible();
    await expect(summary).toContainText("≈ $400");

    // Sharing for the member average is opt-in, and the box remembers it.
    const share = result.getByRole("checkbox", { name: "Boleh dipakai anonim buat rata-rata hasil member" });
    await expect(share).toHaveAttribute("aria-checked", "false");
    await share.click();
    await expect(result.getByRole("checkbox", { name: "Boleh dipakai anonim buat rata-rata hasil member" })).toHaveAttribute("aria-checked", "true");
    // One member is far below the 5 needed for an average.
    await expect(card.getByText(/Rata-rata member/)).toHaveCount(0);
  } finally {
    await deleteProject(ended.id);
  }
});

test("without a price the token amount is still saved, and a refused form clears after the next success", async ({ page }) => {
  const email = await signIn(page, "farm-noprice");
  const ended = await endedProjectFarmedBy(email, "noprice", "e2e-noprice-token");
  try {
    await page.goto("/garapan");
    const card = cardFor(page, ended.name);
    const ask = card.getByRole("region", { name: "Dapet berapa dari airdrop ini?" });

    // A claim date in the future is refused with a message.
    await ask.getByLabel("Jumlah token").fill("10");
    await ask.getByLabel("Tanggal claim").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    await ask.getByLabel("Tanggal claim").evaluate((el) => el.removeAttribute("max"));
    await ask.getByRole("button", { name: "Simpan" }).click();
    await expect(page).toHaveURL(/\/garapan\?error=invalid_claim_date$/);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();

    await ask.getByLabel("Jumlah token").fill("1250");
    await ask.getByLabel("Tanggal claim").fill(new Date().toISOString().slice(0, 10));
    await ask.getByRole("button", { name: "Simpan" }).click();
    await expect(page).toHaveURL(/\/garapan$/);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    const result = card.getByRole("region", { name: "Hasil kamu" });
    await expect(result.getByText("1.250 ENDR")).toBeVisible();
    await expect(result.getByText("Harga belum ketemu, jumlah token tetap tersimpan.")).toBeVisible();
    await expect(page.getByTestId("garapan-summary")).toContainText("≈ $0");
  } finally {
    await deleteProject(ended.id);
  }
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
