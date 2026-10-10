import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";
import { cleanupSeed, seedManyProjects, seedProjects, type Seed } from "./support/seed";

const PASSWORD = "correct-horse-1";
const WALLET = "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae";

let seed: Seed;
let unsupportedSlug: string;

test.beforeAll(async () => {
  seed = await seedProjects();
  // A project on a chain the wallet activity check does not support (stored as e.g. "PGabc123").
  unsupportedSlug = (await seedManyProjects(1)).slugs[0]!;
});

test.afterAll(async () => {
  await cleanupSeed();
  await deleteCreatedUsers();
});

/** A signed-in user (browser session) with one wallet; returns the user and wallet ids. */
async function userWithWallet(page: Page, tag: string): Promise<{ userId: string; walletId: string }> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  const db = adminClient();
  const { data: users, error: ue } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (ue) throw ue;
  const user = users.users.find((u) => u.email === email);
  if (!user) throw new Error("user not found");
  const { data: wallet, error } = await db
    .from("wallets")
    .insert({ user_id: user.id, address: WALLET, chain_family: "evm", label: "Main" })
    .select("id")
    .single();
  if (error) throw error;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  return { userId: user.id, walletId: wallet.id as string };
}

test("signed out, the project page has no wallet-related UI and the API answers 401 in JSON", async ({ page }) => {
  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByText("Chains: ethereum, base")).toBeVisible();
  await expect(page.getByRole("button", { name: /Check wallet activity/ })).toHaveCount(0);
  await expect(page.getByText("Chain not supported yet.")).toHaveCount(0);
  await expect(page.getByText("Wallet activity", { exact: true })).toHaveCount(0);

  const res = await page.request.post("/api/wallet-activity", { data: { walletId: "x", chain: "ethereum" }, maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("a signed-in user with a fresh cached result sees it without any provider call", async ({ page }) => {
  const { userId, walletId } = await userWithWallet(page, "wa-cache");
  const db = adminClient();
  const { error } = await db.from("wallet_checks").insert({
    user_id: userId,
    address: WALLET,
    chain: "ethereum",
    checked_at: new Date().toISOString(),
    result: {
      chain: "ethereum",
      txCount: 42,
      firstTxAt: "2021-03-05T10:00:00.000Z",
      lastTxAt: "2026-09-30T23:59:59.000Z",
      activeMonths: { value: 7, exact: false },
      source: "blockscout",
      fetchedAt: new Date().toISOString(),
    },
  });
  if (error) throw error;

  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByTestId("wallet-check")).toHaveCount(1);
  // Spec §7: the risk badge and the official checker link sit next to the wallet activity check.
  const riskLine = page.getByRole("region", { name: "Wallet activity" }).getByTestId("wallet-risk-line");
  await expect(riskLine.getByTestId("risk-badge")).toHaveText("Risk High");
  await expect(riskLine.getByRole("link", { name: "Official checker (unverified)" })).toHaveAttribute("href", seed.main.claimUrl);
  await page.getByRole("button", { name: /Check wallet activity on Ethereum/ }).click();
  await expect(page.getByText("Wallet activity on Ethereum: 42 transactions, first 2021-03-05, last 2026-09-30, active 7+ months")).toBeVisible();

  // A cache hit is not a request.
  const { count, error: ce } = await db.from("wallet_check_requests").select("*", { count: "exact", head: true }).eq("user_id", userId);
  if (ce) throw ce;
  expect(count).toBe(0);
  expect(walletId).toBeTruthy();
});

test("a project on an unsupported chain says so, and offers no check button", async ({ page }) => {
  await userWithWallet(page, "wa-unsupported");
  await page.goto(`/projects/${unsupportedSlug}`);
  await expect(page.getByText("Chain not supported yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Check wallet activity/ })).toHaveCount(0);
});

test("a project with no chains keeps the existing 'Chain unknown' copy and no check button", async ({ page }) => {
  await userWithWallet(page, "wa-nochain");
  await page.goto(`/projects/${seed.conflicted.slug}`);
  await expect(page.getByText("Chain unknown")).toBeVisible();
  await expect(page.getByRole("button", { name: /Check wallet activity/ })).toHaveCount(0);
  await expect(page.getByText("Chain not supported yet.")).toHaveCount(0);
});

test("the API refuses a wallet id of another user with 404", async ({ page }) => {
  const { walletId } = await userWithWallet(page, "wa-owner");
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  await userWithWallet(otherPage, "wa-intruder");
  const res = await otherPage.request.post("/api/wallet-activity", { data: { walletId, chain: "ethereum" } });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ kind: "not_owner" });
  const unsupported = await otherPage.request.post("/api/wallet-activity", { data: { walletId: "nope", chain: "ethereum" } });
  expect(unsupported.status()).toBe(404);
  const bad = await otherPage.request.post("/api/wallet-activity", { data: "{", headers: { "content-type": "application/json" } });
  expect(bad.status()).toBe(400);
  await other.close();
});

test("the hourly limit holds under parallel requests: 5 at once with 9 used lets exactly one through", async ({ page }) => {
  const { userId, walletId } = await userWithWallet(page, "wa-limit");
  const db = adminClient();
  const { error } = await db.from("wallet_check_requests").insert(Array.from({ length: 9 }, () => ({ user_id: userId })));
  if (error) throw error;

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => page.request.post("/api/wallet-activity", { data: { walletId, chain: "ethereum" } })),
  );
  const statuses = responses.map((r) => r.status());
  // One request claims the 10th slot (and asks the provider: 200, or 503 if it is unreachable); the rest are refused.
  expect(statuses.filter((s) => s === 429)).toHaveLength(4);
  expect(statuses.filter((s) => s !== 429).every((s) => s === 200 || s === 503)).toBe(true);
  for (const r of responses.filter((x) => x.status() === 429)) expect(await r.json()).toEqual({ kind: "rate_limited" });

  const { count, error: ce } = await db.from("wallet_check_requests").select("*", { count: "exact", head: true }).eq("user_id", userId);
  if (ce) throw ce;
  expect(count).toBe(10);
});

test("a signed-in user without wallets is pointed to /wallets from the header and the project page", async ({ page }) => {
  const email = uniqueEmail("wa-nowallet");
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);

  await page.getByRole("banner").getByRole("link", { name: "Wallets" }).click();
  await expect(page).toHaveURL(/\/wallets$/);

  await page.goto(`/projects/${seed.main.slug}`);
  await expect(page.getByRole("button", { name: /Check wallet activity/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Add a wallet to check wallet activity" }).click();
  await expect(page).toHaveURL(/\/wallets$/);
});

test("signed out, the header has no Wallets link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Wallets" })).toHaveCount(0);
});
