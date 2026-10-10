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
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Airdrops" })).toBeVisible();
  const row = page.locator(`[data-testid="project-row"][data-slug="${seed.main.slug}"]`);
  await expect(row.getByRole("link", { name: seed.main.name })).toHaveAttribute("href", `/projects/${seed.main.slug}`);
  // The newest assessment (High) wins over the older Low one.
  await expect(row.getByTestId("risk-badge")).toContainText("High");
  await expect(row.getByTestId("status-badge")).toContainText("Live");
  await expect(row).toContainText("ethereum, base");
  // Next firm deadline: the snapshot in 10 days, not the past claim or the quarter-level TGE.
  await expect(row).toContainText("Snapshot");
  await expect(page.getByRole("status")).toHaveCount(0);

  const conflict = page.locator(`[data-testid="project-row"][data-slug="${seed.conflicted.slug}"]`);
  await expect(conflict.getByTestId("status-badge")).toContainText("Unconfirmed");
  await expect(conflict.getByTestId("risk-badge")).toContainText("Not assessed");
  await expect(conflict).toContainText("Chain unknown");
});

test("filters from the query string narrow the list", async ({ page }) => {
  const mainRow = page.locator(`[data-testid="project-row"][data-slug="${seed.main.slug}"]`);
  await page.goto("/?status=live&risk=high&chain=base");
  await expect(mainRow).toBeVisible();
  await page.goto("/?risk=low");
  await expect(mainRow).toHaveCount(0);
  await page.goto("/?status=ended");
  await expect(mainRow).toHaveCount(0);
  await page.goto("/?chain=solana");
  await expect(mainRow).toHaveCount(0);
});

test("the detail page shows reasons, coverage, evidence with its source, and the official checker link", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(seed.main.name);
  await expect(page.getByTestId("risk-badge")).toContainText("High");
  await expect(page.getByTestId("status-badge")).toContainText("Live");
  await expect(page.getByText("Claim domain is younger than 30 days")).toBeVisible();
  await expect(page.getByText(/4\/8 checks ran/)).toBeVisible();

  const evidence = page.getByRole("list", { name: "Evidence" });
  await expect(evidence).toContainText("Claims are open now");
  const source = evidence.getByRole("link");
  await expect(source).toHaveAttribute("href", `${seed.main.sourceUrl}`);
  await expect(source).toHaveAttribute("rel", "noopener noreferrer nofollow");

  const checker = page.getByRole("link", { name: "Official checker (unverified)" });
  await expect(checker).toHaveAttribute("href", seed.main.claimUrl);
  await expect(checker).toHaveAttribute("target", "_blank");
  // It sits in the same line as the Risk badge.
  await expect(page.getByTestId("risk-line").getByTestId("risk-badge")).toBeVisible();
  await expect(page.getByTestId("risk-line").getByRole("link", { name: /Official checker/ })).toBeVisible();

  // Deadlines and a non-http link are rendered, but the javascript: URL is plain text, never an anchor.
  await expect(page.getByText("Snapshot on the 10th")).toBeVisible();
  await expect(page.getByText("Bridge to the main chain")).toBeVisible();
  await expect(page.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(page.getByText("javascript:alert(1)")).toBeVisible();
});

test("a project with conflicting sources shows both quotes, and Chain unknown without a wallet check", async ({ page }) => {
  await page.goto(`/projects/${seed.conflicted.slug}`);
  await expect(page.getByRole("heading", { name: "Conflicting sources" })).toBeVisible();
  await expect(page.getByText(/Airdrop is live/)).toBeVisible();
  await expect(page.getByText(/Airdrop has ended/)).toBeVisible();
  await expect(page.getByText("Chain unknown")).toBeVisible();
  await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("status-badge")).toContainText("Unconfirmed");
});

test("an unknown slug is a 404", async ({ page }) => {
  const res = await page.goto("/projects/does-not-exist-e2e");
  expect(res?.status()).toBe(404);
});
