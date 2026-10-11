import { expect, test } from "@playwright/test";
import { cleanupSeed, seedProjects, type Seed } from "./support/seed";

let seed: Seed;

test.beforeAll(async () => {
  seed = await seedProjects();
});

test.afterAll(async () => {
  await cleanupSeed();
});

test("the list shows a seeded project with its Risk and Status badges, and no stale banner", async ({ page }) => {
  await page.goto("/airdrops");
  await expect(page.getByRole("heading", { level: 1, name: "Daftar airdrop" })).toBeVisible();
  const row = page.locator(`[data-testid="project-row"][data-slug="${seed.main.slug}"]`);
  await expect(row.getByRole("link", { name: seed.main.name })).toHaveAttribute("href", `/projects/${seed.main.slug}`);
  // The newest assessment (High) wins over the older Low one.
  await expect(row.getByTestId("risk-badge")).toHaveText("Risiko Tinggi");
  await expect(row.getByTestId("status-badge")).toHaveText("Status Live");
  await expect(row).toContainText("ethereum, base");
  // Next firm deadline: the snapshot in 10 days, not the past claim or the quarter-level TGE.
  await expect(row).toContainText(/Snapshot \d{4}-\d{2}-\d{2} \(tanggal tepat\)/);
  await expect(page.getByRole("status")).toHaveCount(0);

  const conflict = page.locator(`[data-testid="project-row"][data-slug="${seed.conflicted.slug}"]`);
  await expect(conflict.getByTestId("status-badge")).toHaveText("Status Belum pasti");
  await expect(conflict.getByTestId("risk-badge")).toHaveText("Risiko Belum dinilai");
  await expect(conflict).toContainText("Chain belum diketahui");
});

test("filters from the query string narrow the list", async ({ page }) => {
  const mainRow = page.locator(`[data-testid="project-row"][data-slug="${seed.main.slug}"]`);
  await page.goto("/airdrops?status=live&risk=high&chain=base");
  await expect(mainRow).toBeVisible();
  await page.goto("/airdrops?risk=low");
  await expect(mainRow).toHaveCount(0);
  await page.goto("/airdrops?status=ended");
  await expect(mainRow).toHaveCount(0);
  await page.goto("/airdrops?chain=solana");
  await expect(mainRow).toHaveCount(0);
});

test("an old list link (/?query) lands on /airdrops with the same filters", async ({ page }) => {
  const mainRow = page.locator(`[data-testid="project-row"][data-slug="${seed.main.slug}"]`);
  await page.goto("/?status=live&risk=high&chain=base");
  await expect(page).toHaveURL(/\/airdrops\?status=live&risk=high&chain=base$/);
  await expect(mainRow).toBeVisible();
  await page.goto("/?risk=low");
  await expect(page).toHaveURL(/\/airdrops\?risk=low$/);
  await expect(mainRow).toHaveCount(0);
});

test("a visitor at / gets the landing with the way to the list and Login, the comparison table, and no signup", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Airdrop yang worth it digarap, udah kami cek duluan.");
  await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Apa bedanya gratis sama member?" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Apa bedanya gratis sama member?" }).getByRole("row")).toHaveCount(13);
  await expect(page.getByText(/daftar/i)).toHaveCount(0);
  await expect(page.locator("a[href*='signup']")).toHaveCount(0);
  await expect(page.getByText("Not financial advice. Tetap DYOR sebelum connect wallet.")).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Lihat airdrop" }).click();
  await expect(page).toHaveURL(/\/airdrops$/);
  await expect(page.locator(`[data-testid="project-row"][data-slug="${seed.main.slug}"]`)).toBeVisible();
});

test("the filter form and the project page lead back to /airdrops", async ({ page }) => {
  await page.goto("/airdrops?risk=high");
  await expect(page.getByRole("link", { name: "Hapus filter" })).toHaveAttribute("href", "/airdrops");
  await expect(page.getByRole("group", { name: "Risiko" }).getByLabel("Tinggi")).toBeChecked();
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(page).toHaveURL(/\/airdrops\?risk=high(&|$)/);

  await page.goto(`/projects/${seed.main.slug}`);
  await page.getByRole("link", { name: "← Balik ke list" }).click();
  await expect(page).toHaveURL(/\/airdrops$/);
});

test("the detail page shows reasons, coverage, evidence with its source, and the official checker link", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(seed.main.name);
  await expect(page.getByTestId("risk-badge")).toHaveText("Risiko Tinggi");
  await expect(page.getByTestId("status-badge")).toHaveText("Status Live");
  await expect(page.getByText("Claim domain is younger than 30 days")).toBeVisible();
  await expect(
    page.getByText(
      "4/9 security check jalan. Belum bisa dicek: Risiko kontrak token, Kontrak verified, Riwayat hack, Cross-check antar source, Review AI.",
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
