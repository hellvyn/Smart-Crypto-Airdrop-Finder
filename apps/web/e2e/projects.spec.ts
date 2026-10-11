import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";
import {
  cleanupSeed,
  seedCuratedList,
  seedProjectPage,
  seedProjects,
  type CuratedSeed,
  type ProjectPageSeed,
  type Seed,
} from "./support/seed";

let seed: Seed;
let curated: CuratedSeed;
let detailPage: ProjectPageSeed;

test.beforeAll(async () => {
  seed = await seedProjects();
  // After seedProjects, so its run ("4 dicek, 3 lolos") is the newest.
  curated = await seedCuratedList();
  detailPage = await seedProjectPage();
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await cleanupSeed();
});

/** A tab of the list, scoped to the tab bar (a project named "... Ended ..." is a link too). */
const tabLink = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Tab daftar" }).getByRole("link", { name, exact: true });
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
  await expect(tabLink(page, "Live sekarang")).toHaveAttribute("aria-current", "page");
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
  await tabLink(page, "Early").click();
  await expect(page).toHaveURL(/\/airdrops\?tab=early_bets$/);
  const early = rowFor(page, curated.early.slug);
  await expect(early.getByTestId("status-badge")).toHaveText("Status Spekulatif");
  await expect(early).toContainText("TVL $45 jt");
  await expect(early).toContainText("Terdaftar di CoinGecko");
  await expect(early).toContainText("Modal belum jelas");
  await expect(early).toContainText("Dicek hari ini");
  await expect(rowFor(page, curated.live.slug)).toHaveCount(0);

  await tabLink(page, "Ended").click();
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
  await expect(tabLink(page, "Live sekarang")).toHaveAttribute("aria-current", "page");
  await expect(rowFor(page, curated.live.slug)).toBeVisible();
});

test("?modal=free keeps only free projects and survives a tab switch; Modal belum jelas only under Semua", async ({ page }) => {
  await page.goto("/airdrops?modal=free");
  const modal = page.getByRole("navigation", { name: "Modal:" });
  await expect(modal.getByRole("link", { name: /^Gratis · \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(rowFor(page, curated.live.slug)).toBeVisible();
  await tabLink(page, "Early").click();
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

  test("the project page fits without scrolling sideways, for a member too", async ({ page }) => {
    await page.goto(`/projects/${detailPage.slug}`);
    await expect(page.getByTestId("key-check")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await signIn(page);
    await page.goto(`/projects/${detailPage.slug}`);
    await expect(page.getByText("0 kasus")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

const SECTIONS = [
  "01 · AI verdict",
  "02 · Sumber yang beda cerita",
  "03 · Step garap",
  "04 · Security check",
  "05 · Estimasi effort",
  "06 · Kenapa lolos",
  "Ringkasan",
  "Update terbaru",
];
const section = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("a member sees every section in order, the AI verdict labelled Analisis AI, and what each check found", async ({ page }) => {
  await signIn(page);
  await page.goto(`/projects/${detailPage.slug}`);
  await expect(page.locator("article.detail h2")).toHaveText(SECTIONS);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(detailPage.name);
  await expect(page.getByTestId("risk-head")).toHaveText("Risiko rendah");
  await expect(page.getByText("Claim open · link dicek")).toBeVisible();
  await expect(page.getByText("Dicek hari ini")).toBeVisible();
  await expect(page.getByText("Sangat worth it")).toBeVisible();

  const ai = section(page, "01 · AI verdict");
  await expect(ai.getByText("Analisis AI")).toBeVisible();
  await expect(ai.getByText("Garap", { exact: true })).toBeVisible();
  await expect(ai.getByText("Confidence: tinggi")).toBeVisible();
  await expect(ai.getByText(detailPage.memberOnly.point)).toBeVisible();
  await expect(ai.getByRole("link", { name: "source" })).toHaveAttribute("href", detailPage.sourceUrl);

  const safety = section(page, "04 · Security check");
  await expect(safety.getByText("0 kasus")).toBeVisible();
  await expect(safety.getByText("2 source", { exact: true })).toBeVisible();
  await expect(safety.getByText("Gak ada pola scam")).toBeVisible();
  await expect(safety.getByText("Member only")).toHaveCount(0);

  const effort = section(page, "05 · Estimasi effort");
  await expect(effort.getByText("±10")).toBeVisible();
  await expect(effort.getByText(detailPage.memberOnly.effortNote)).toBeVisible();
  await expect(effort.getByText("source.example: Easy")).toBeVisible();
  await expect(section(page, "06 · Kenapa lolos").getByText(detailPage.memberOnly.reason)).toBeVisible();
});

test("a visitor gets Member only for the AI verdict, effort and advanced checks, and none of their data in the HTML", async ({ page }) => {
  const res = await page.goto(`/projects/${detailPage.slug}`);
  expect(res?.status()).toBe(200);
  await expect(page.locator("article.detail h2")).toHaveText(SECTIONS);
  await expect(section(page, "01 · AI verdict").getByText("Member only")).toBeVisible();
  await expect(section(page, "05 · Estimasi effort").getByText("Member only")).toBeVisible();

  const advanced = page.getByRole("list", { name: "Advanced check" }).getByRole("listitem");
  await expect(advanced).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(advanced.nth(i)).toContainText("Member only");
  await expect(page.getByText("0 kasus")).toHaveCount(0);

  // The public parts are all there.
  const cards = page.getByTestId("key-check");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(2)).toContainText("2 tahun 3 bulan");
  await expect(cards.nth(1)).toContainText("Link project ini dibandingin sama 1.240 domain official di database kami.");
  await expect(page.getByText(detailPage.contradiction)).toBeVisible();
  await expect(page.getByText(detailPage.step)).toBeVisible();
  await expect(page.getByText(detailPage.update)).toBeVisible();
  await expect(page.getByText("VC: Paradigm ✓")).toBeVisible();
  await expect(page.getByText(/"Backed by Jump /)).toBeVisible();
  await expect(page.getByText("Klaim project, belum verified")).toBeVisible();

  await expect(page.getByText(/^(Garap|Pantau|Skip)$/)).toHaveCount(0);
  await expect(page.getByText(/worth it/i)).toHaveCount(0);
  await expect(page.getByText(/\bdaftar\b/i)).toHaveCount(0);
  await expect(page.locator("a[href*='signup']")).toHaveCount(0);

  // Not in the markup nor in the RSC payload: the member-only data is never queried for a visitor (#45, #54).
  const html = await (await page.request.get(`/projects/${detailPage.slug}`)).text();
  for (const text of Object.values(detailPage.memberOnly)) expect(html).not.toContain(text);
  expect(html).not.toMatch(/"verdict"|Confidence:|Sangat worth it|worth_level|"worthLevel":"high"/);
  expect(html).toContain(detailPage.contradiction);
});

test("the security check shows a phishing claim link as a warning, never as a link, and the facts in their own places", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(seed.main.name);
  await expect(page.getByTestId("risk-head")).toHaveText("Risiko tinggi");
  await expect(page.getByTestId("status-badge")).toHaveText("Status Live");
  const safety = section(page, "04 · Security check");
  await expect(safety.getByText("Claim domain is younger than 30 days")).toBeVisible();
  await expect(safety.getByText("Link di-hide: kedeteksi phishing")).toBeVisible();
  await expect(page.locator(`a[href="${seed.main.phishingUrl}"]`)).toHaveCount(0);
  await expect(page.locator("a[href*='claim-phish-']")).toHaveCount(0);
  await expect(safety.getByRole("link", { name: new URL(seed.main.claimUrl).host + new URL(seed.main.claimUrl).pathname })).toHaveAttribute(
    "rel",
    "noopener noreferrer nofollow",
  );
  // A row stored without details: the cards are there, without a detail sentence.
  await expect(page.getByTestId("key-check")).toHaveCount(4);
  await expect(page.getByText(/dicocokin satu-satu/)).toHaveCount(0);

  // v3 facts: the claimed backer as a claim, the update and the key parameter in their boxes; no source rating for a visitor.
  await expect(section(page, "06 · Kenapa lolos").getByText(/"Backed by Paradigm /)).toBeVisible();
  await expect(section(page, "06 · Kenapa lolos").getByText("Klaim project, belum verified")).toBeVisible();
  await expect(page.getByText("VC: Paradigm ✓")).toHaveCount(0);
  await expect(section(page, "Update terbaru").getByText(/Season 2 announced/)).toBeVisible();
  await expect(section(page, "Ringkasan").getByText("Alokasi: 10% of supply")).toBeVisible();
  await expect(page.getByText(/Easy/)).toHaveCount(0);

  // Deadlines, steps and a non-http link are rendered, but the javascript: URL is plain text, never an anchor.
  await expect(section(page, "Ringkasan").getByText(/^Snapshot: \d{1,2} [A-Z][a-z]{2} \d{4} \(tanggal tepat\)$/)).toBeVisible();
  await expect(page.getByText("Bridge to the main chain")).toBeVisible();
  await expect(page.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(page.getByText("javascript:alert(1)")).toBeVisible();
});

test("a project with conflicting sources shows both quotes, and Chain belum diketahui without a wallet check", async ({ page }) => {
  await page.goto(`/projects/${seed.conflicted.slug}`);
  await expect(page.getByRole("heading", { name: "02 · Sumber yang beda cerita" })).toBeVisible();
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

// ---- Not curated: warning, noindex (Plan 6 Task 6) ----

const noindex = (page: Page) => page.locator('meta[name="robots"]');
const banner = (page: Page) => page.getByTestId("not-curated");

test("a project whose latest curation failed opens with the warning above everything and is noindex", async ({ page }) => {
  const res = await page.goto(`/projects/${curated.failed.slug}`);
  expect(res?.status()).toBe(200);
  await expect(banner(page)).toHaveText("Gak masuk list: Risiko tinggi");
  await expect(page.locator("article.detail > :first-child")).toHaveAttribute("data-testid", "not-curated");
  await expect(noindex(page)).toHaveAttribute("content", "noindex");
  // Not a tab project: no pass stamp either.
  await expect(page.getByRole("img", { name: /LOLOS/ })).toHaveCount(0);
});

test("a project without any curation opens with 'belum dinilai' and is noindex", async ({ page }) => {
  const res = await page.goto(`/projects/${seed.main.slug}`);
  expect(res?.status()).toBe(200);
  await expect(banner(page)).toHaveText("Gak masuk list: belum dinilai");
  await expect(noindex(page)).toHaveAttribute("content", "noindex");
});

test("a project that passed has no warning and is indexable, also after it ended", async ({ page }) => {
  for (const slug of [curated.live.slug, curated.early.slug, curated.ended.slug]) {
    await page.goto(`/projects/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await expect(noindex(page)).toHaveCount(0);
  }
  await page.goto(`/projects/${curated.ended.slug}`);
  await expect(page.getByTestId("status-badge")).toHaveText("Status Ended");
  await expect(page.getByTestId("ended-on")).toHaveText("Ended 15 Jan 2025");
});

test("a member sees the same public reason in the banner, never the member-only one", async ({ page }) => {
  await signIn(page);
  await page.goto(`/projects/${curated.failed.slug}`);
  await expect(banner(page)).toHaveText("Gak masuk list: Risiko tinggi");
  await expect(banner(page)).not.toContainText(curated.failedMemberReason);
  await expect(noindex(page)).toHaveAttribute("content", "noindex");
});

test("a visitor's page for a failed project carries none of its member-only text", async ({ request }) => {
  const res = await request.get(`/projects/${curated.failed.slug}`);
  expect(res.status()).toBe(200);
  expect(await res.text()).not.toContain(curated.failedMemberReason);
});
