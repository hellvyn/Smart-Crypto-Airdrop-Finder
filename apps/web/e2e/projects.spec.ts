import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";
import { cleanupSeed, seedCuratedList, seedProjects, type CuratedSeed, type Seed } from "./support/seed";

let seed: Seed;
let curated: CuratedSeed;

test.beforeAll(async () => {
  seed = await seedProjects();
  // After seedProjects, so its run ("4 dicek, 3 lolos") is the newest.
  curated = await seedCuratedList();
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await cleanupSeed();
});

const rowFor = (page: Page, slug: string) => page.locator(`[data-testid="project-row"][data-slug="${slug}"]`);

async function signIn(page: Page): Promise<void> {
  const email = uniqueEmail("list");
  await createConfirmedUser(email, "correct-horse-1");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("the default tab shows only the live_now project, with its badges, key checks and check time", async ({ page }) => {
  await page.goto("/airdrops");
  await expect(page.getByRole("link", { name: "Live sekarang" })).toHaveAttribute("aria-current", "page");
  const row = rowFor(page, curated.live.slug);
  await expect(row.getByRole("link", { name: curated.live.name })).toHaveAttribute("href", `/projects/${curated.live.slug}`);
  await expect(row.getByTestId("risk-badge")).toHaveText("Risiko Rendah");
  await expect(row.getByTestId("status-badge")).toHaveText("Status Live");
  await expect(row).toContainText("4/4 security check jalan");
  await expect(row).toContainText("Dicek hari ini");
  await expect(row).toContainText("Gratis");
  await expect(row).toContainText("Claim open · link dicek");
  await expect(row).toContainText("VC: Paradigm ✓");
  await expect(row).toContainText("Menurut AlphaDrops: a16z (lead)");
  await expect(row).toContainText("Sumber kurasi");
  await expect(row).toContainText(/Claim \d{4}-\d{2}-\d{2} \(tanggal tepat\)/);
  for (const other of [curated.early, curated.ended, curated.failed, seed.main]) await expect(rowFor(page, other.slug)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("Early and Ended tabs show their own project; Ended carries the end date and a frozen check time", async ({ page }) => {
  await page.goto("/airdrops");
  await page.getByRole("link", { name: "Early" }).click();
  await expect(page).toHaveURL(/\/airdrops\?tab=early_bets$/);
  const early = rowFor(page, curated.early.slug);
  await expect(early.getByTestId("status-badge")).toHaveText("Status Spekulatif");
  await expect(early).toContainText("TVL $45 jt");
  await expect(early).toContainText("Terdaftar di CoinGecko");
  await expect(early).toContainText("Modal belum jelas");
  await expect(early).toContainText("Dicek hari ini");
  await expect(rowFor(page, curated.live.slug)).toHaveCount(0);

  await page.getByRole("link", { name: "Ended" }).click();
  await expect(page).toHaveURL(/\/airdrops\?tab=ended$/);
  const ended = rowFor(page, curated.ended.slug);
  await expect(ended.getByTestId("status-badge")).toHaveText("Status Ended");
  await expect(ended).toContainText("Ended 15 Jan 2025");
  await expect(ended).toContainText("Last check 2 Apr 2025");
  await expect(ended).toContainText("2/4 security check jalan");
  await expect(page.getByText("Baru ended")).toBeVisible();
  await expect(rowFor(page, curated.early.slug)).toHaveCount(0);
});

test("a project whose latest curation failed is in no tab, and every row says when it was checked", async ({ page }) => {
  for (const tab of ["live_now", "early_bets", "ended"]) {
    await page.goto(`/airdrops?tab=${tab}`);
    await expect(page.getByTestId("project-row").first()).toBeVisible();
    await expect(rowFor(page, curated.failed.slug)).toHaveCount(0);
    const rows = page.getByTestId("project-row");
    const n = await rows.count();
    for (let i = 0; i < n; i++) await expect(rows.nth(i).getByTestId("checked")).toHaveText(/^(Dicek|Belum dicek lagi sejak|Last check) /);
  }
});

test("an unknown ?tab= falls back to Live sekarang", async ({ page }) => {
  const res = await page.goto("/airdrops?tab=xyz");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Live sekarang" })).toHaveAttribute("aria-current", "page");
  await expect(rowFor(page, curated.live.slug)).toBeVisible();
});

test("?modal=free keeps only free projects and survives a tab switch; Modal belum jelas only under Semua", async ({ page }) => {
  await page.goto("/airdrops?modal=free");
  const modal = page.getByRole("navigation", { name: "Modal:" });
  await expect(modal.getByRole("link", { name: /^Gratis · \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(rowFor(page, curated.live.slug)).toBeVisible();
  await page.getByRole("link", { name: "Early" }).click();
  await expect(page).toHaveURL(/\/airdrops\?tab=early_bets&modal=free$/);
  await expect(rowFor(page, curated.early.slug)).toHaveCount(0);

  await page.goto("/airdrops?tab=early_bets&modal=deposit");
  await expect(page.getByText("Modal belum jelas")).toHaveCount(0);
  await page.goto("/airdrops?tab=early_bets");
  await expect(rowFor(page, curated.early.slug).getByText("Modal belum jelas")).toBeVisible();
});

test("the summary shows today's run and the track record", async ({ page }) => {
  await page.goto("/airdrops?tab=early_bets");
  const summary = page.getByRole("region", { name: "Update hari ini" });
  await expect(summary.getByTestId("summary-checked")).toHaveText("4 dicek");
  await expect(summary.getByTestId("summary-passed")).toHaveText("3 lolos");
  await expect(page.getByRole("region", { name: "Track record kami" })).toContainText(
    "5 Token listing · 4 Ended tanpa token · 3 Belakangan jadi risky",
  );
});

test("a visitor sees no Worth it, and ?sort=worth&worth=high is ignored", async ({ page }) => {
  const res = await page.goto("/airdrops?sort=worth&worth=high");
  expect(res?.status()).toBe(200);
  // The live project is worth "low": a worth filter would have hidden it.
  await expect(rowFor(page, curated.live.slug)).toBeVisible();
  await expect(page.getByText("Baru dicek")).toBeVisible();
  await expect(page.getByText(/worth it/i)).toHaveCount(0);
  await expect(page.locator("a[href*='worth']")).toHaveCount(0);
});

test("a member sees Worth it on each row and can filter by it", async ({ page }) => {
  await signIn(page);
  await page.goto("/airdrops");
  await expect(rowFor(page, curated.live.slug).getByText("Kurang worth it")).toBeVisible();
  await expect(page.getByText("Paling worth it")).toBeVisible();
  await expect(page.getByRole("option", { name: "Worth it: semua" })).toHaveCount(1);
  await page.goto("/airdrops?worth=high");
  await expect(rowFor(page, curated.live.slug)).toHaveCount(0);
  await page.goto("/airdrops?tab=early_bets&worth=medium");
  await expect(rowFor(page, curated.early.slug).getByText("Worth it", { exact: true })).toBeVisible();
});

test("filters from the query string narrow the list", async ({ page }) => {
  const live = rowFor(page, curated.live.slug);
  await page.goto("/airdrops?status=live&risk=low&chain=base");
  await expect(live).toBeVisible();
  await page.goto("/airdrops?risk=high");
  await expect(live).toHaveCount(0);
  await page.goto("/airdrops?status=announced");
  await expect(live).toHaveCount(0);
  await page.goto("/airdrops?chain=solana");
  await expect(live).toHaveCount(0);
});

test("an old list link (/?query) lands on /airdrops with the same filters", async ({ page }) => {
  const live = rowFor(page, curated.live.slug);
  await page.goto("/?status=live&risk=low&chain=base");
  await expect(page).toHaveURL(/\/airdrops\?status=live&risk=low&chain=base$/);
  await expect(live).toBeVisible();
  await page.goto("/?risk=high");
  await expect(page).toHaveURL(/\/airdrops\?risk=high$/);
  await expect(live).toHaveCount(0);
});

test("a visitor at / gets the landing with today's numbers, the track record, the way to the list and Login, and no signup", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Airdrop yang worth it digarap, udah kami cek duluan.");
  await expect(page.getByTestId("today-checked")).toHaveText("4airdrop dicek");
  await expect(page.getByTestId("today-passed")).toHaveText("3lolos");
  await expect(page.locator("#jejak")).toContainText("Dari 12 airdrop yang lolos sebelum token listing");
  await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Apa bedanya gratis sama member?" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Apa bedanya gratis sama member?" }).getByRole("row")).toHaveCount(13);
  await expect(page.getByText(/daftar/i)).toHaveCount(0);
  await expect(page.locator("a[href*='signup']")).toHaveCount(0);
  await expect(page.getByText("Not financial advice. Tetap DYOR sebelum connect wallet.")).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Lihat airdrop" }).click();
  await expect(page).toHaveURL(/\/airdrops$/);
  await expect(rowFor(page, curated.live.slug)).toBeVisible();
});

test("the filter form keeps the tab, and the project page leads back to /airdrops", async ({ page }) => {
  await page.goto("/airdrops?tab=early_bets&risk=high");
  await expect(page.getByRole("link", { name: "Hapus filter" })).toHaveAttribute("href", "/airdrops?tab=early_bets");
  await expect(page.getByRole("group", { name: "Risiko" }).getByLabel("Tinggi")).toBeChecked();
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(page).toHaveURL(/\/airdrops\?tab=early_bets&risk=high(&|$)/);

  await page.goto(`/projects/${seed.main.slug}`);
  await page.getByRole("link", { name: "← Balik ke list" }).click();
  await expect(page).toHaveURL(/\/airdrops$/);
});

test.describe("360px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the Modal: options wrap onto a new line instead of scrolling sideways", async ({ page }) => {
    await page.goto("/airdrops?tab=early_bets");
    const modal = page.getByRole("navigation", { name: "Modal:" });
    const fits = await modal.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test("the detail page shows reasons, coverage, evidence with its source, and the official checker link", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(seed.main.name);
  await expect(page.getByTestId("risk-badge")).toHaveText("Risiko Tinggi");
  await expect(page.getByTestId("status-badge")).toHaveText("Status Live");
  await expect(page.getByText("Claim domain is younger than 30 days")).toBeVisible();
  await expect(
    page.getByText(
      "4/9 cek jalan. Belum bisa dicek: Risiko kontrak token, Kontrak verified, Riwayat hack, Cross-check antar source, Review AI.",
    ),
  ).toBeVisible();

  const evidence = page.getByRole("list", { name: "Bukti" });
  await expect(evidence).toContainText("Claims are open now");
  const source = evidence.getByRole("link");
  await expect(source).toHaveAttribute("href", `${seed.main.sourceUrl}`);
  await expect(source).toHaveAttribute("rel", "noopener noreferrer nofollow");
  // Unverified v3 facts (claimed backers, key parameters, ratings, capital, latest update) are not public evidence.
  const hidden = [
    "claimed backer", "Paradigm", "key parameter", "10% of supply", "source rating", "Difficulty",
    "latest update", "Season 2 announced", "capital",
  ];
  for (const text of hidden) await expect(evidence).not.toContainText(text);
  await expect(page.getByText("Paradigm")).toHaveCount(0);

  const checker = page.getByRole("link", { name: "Checker official (belum verified)" });
  await expect(checker).toHaveAttribute("href", seed.main.claimUrl);
  await expect(checker).toHaveAttribute("target", "_blank");
  // It sits in the same line as the Risk badge.
  await expect(page.getByTestId("risk-line").getByTestId("risk-badge")).toBeVisible();
  await expect(page.getByTestId("risk-line").getByRole("link", { name: "Checker official (belum verified)" })).toBeVisible();

  // Deadlines and a non-http link are rendered, but the javascript: URL is plain text, never an anchor.
  await expect(page.getByText("Snapshot on the 10th")).toBeVisible();
  await expect(page.getByText("Bridge to the main chain")).toBeVisible();
  await expect(page.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(page.getByText("javascript:alert(1)")).toBeVisible();
});

test("a project with conflicting sources shows both quotes, and Chain belum diketahui without a wallet check", async ({ page }) => {
  await page.goto(`/projects/${seed.conflicted.slug}`);
  await expect(page.getByRole("heading", { name: "Sumber yang beda cerita" })).toBeVisible();
  await expect(page.getByText(/Airdrop is live/)).toBeVisible();
  await expect(page.getByText(/Airdrop has ended/)).toBeVisible();
  await expect(page.getByText("Chain belum diketahui")).toBeVisible();
  await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("status-badge")).toHaveText("Status Belum pasti");
});

test("an unknown slug is a 404", async ({ page }) => {
  const res = await page.goto("/projects/does-not-exist-e2e");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halaman gak ketemu");
  await page.getByRole("link", { name: "← Balik ke list" }).click();
  await expect(page).toHaveURL(/\/airdrops$/);
});
