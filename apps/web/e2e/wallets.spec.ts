import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";

const PASSWORD = "correct-horse-1";
const CHECKSUM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const LOWER = CHECKSUM.toLowerCase();

test.afterAll(async () => {
  await deleteCreatedUsers();
});

async function signedInUser(page: Page, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  return email;
}

const rows = (page: Page) => page.getByTestId("wallet-row");
const rowFor = (page: Page, address: string) => page.locator(`[data-testid="wallet-row"][data-address="${address}"]`);

async function addWallet(page: Page, address: string, label?: string) {
  await page.getByLabel("Wallet address").fill(address);
  if (label !== undefined) await page.getByLabel("Label (optional)").fill(label);
  await page.getByRole("button", { name: "Add wallet" }).click();
}

test("signed out, /wallets sends the user to log in", async ({ page }) => {
  await page.goto("/wallets");
  await expect(page).toHaveURL(/\/login\?next=%2Fwallets/);
});

test("an empty wallet list says so", async ({ page }) => {
  await signedInUser(page, "w-empty");
  await page.goto("/wallets");
  await expect(page.getByRole("heading", { name: "Your wallets" })).toBeVisible();
  await expect(page.getByText("You have not added any wallets yet.")).toBeVisible();
});

test("adding a checksum-cased address stores it lowercase, in short form with the full address as title", async ({ page }) => {
  await signedInUser(page, "w-add");
  await page.goto("/wallets");
  await addWallet(page, `  ${CHECKSUM}  `, "Main");
  await expect(page).toHaveURL(/\/wallets$/);
  await expect(rows(page)).toHaveCount(1);
  const row = rowFor(page, LOWER);
  await expect(row).toBeVisible();
  await expect(row.locator("code")).toHaveText("0x5aae…eaed");
  await expect(row.locator("code")).toHaveAttribute("title", LOWER);
  await expect(row).toContainText("Main");
});

test("adding the same wallet again (mixed case) shows the duplicate message", async ({ page }) => {
  await signedInUser(page, "w-dup");
  await page.goto("/wallets");
  await addWallet(page, LOWER);
  await expect(rows(page)).toHaveCount(1);
  await addWallet(page, CHECKSUM);
  await expect(page.getByText("You already added this wallet.")).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test("an invalid address shows a message and adds nothing", async ({ page }) => {
  await signedInUser(page, "w-bad");
  await page.goto("/wallets");
  await addWallet(page, "0x123");
  await expect(page.getByText("That doesn't look like an EVM address (0x + 40 hex characters).")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test("a label over 64 characters is refused", async ({ page }) => {
  await signedInUser(page, "w-label");
  await page.goto("/wallets");
  // The input's maxLength stops typing at 64; post the form directly to exercise the server-side check.
  await page.getByLabel("Label (optional)").evaluate((el) => el.removeAttribute("maxlength"));
  await addWallet(page, LOWER, "x".repeat(65));
  await expect(page.getByText("Label must be 64 characters or fewer.")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test("the 21st wallet is refused with the limit message", async ({ page }) => {
  const email = await signedInUser(page, "w-limit");
  const db = adminClient();
  const { data: users, error: ue } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (ue) throw ue;
  const user = users.users.find((u) => u.email === email);
  if (!user) throw new Error("user not found");
  const seeded = Array.from({ length: 20 }, (_, i) => ({
    user_id: user.id,
    address: `0x${i.toString(16).padStart(40, "0")}`,
    chain_family: "evm",
  }));
  const { error } = await db.from("wallets").insert(seeded);
  if (error) throw error;
  await page.goto("/wallets");
  await expect(rows(page)).toHaveCount(20);
  await addWallet(page, LOWER);
  await expect(page.getByText("You can add up to 20 wallets.")).toBeVisible();
  await expect(rows(page)).toHaveCount(20);
});

test("deleting needs a confirmation, and the wallet is gone afterwards", async ({ page }) => {
  await signedInUser(page, "w-del");
  await page.goto("/wallets");
  await addWallet(page, LOWER);
  await expect(rows(page)).toHaveCount(1);

  await rows(page).getByRole("link", { name: /Delete wallet/ }).click();
  await expect(page.getByText("Delete this wallet?")).toBeVisible();
  // Cancelling keeps it.
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText("Delete this wallet?")).toHaveCount(0);

  await rows(page).getByRole("link", { name: /Delete wallet/ }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("You have not added any wallets yet.")).toBeVisible();
});

test("another user cannot see (or confirm-delete) the first user's wallet", async ({ page, browser }) => {
  await signedInUser(page, "w-a");
  await page.goto("/wallets");
  await addWallet(page, LOWER);
  await expect(rowFor(page, LOWER)).toBeVisible();
  const confirmHref = await rowFor(page, LOWER).getByRole("link", { name: /Delete wallet/ }).getAttribute("href");
  expect(confirmHref).toMatch(/^\/wallets\?confirm=/);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signedInUser(otherPage, "w-b");
  await otherPage.goto("/wallets");
  await expect(rows(otherPage)).toHaveCount(0);
  await otherPage.goto(confirmHref!);
  await expect(otherPage.getByText("Delete this wallet?")).toHaveCount(0);
  await expect(otherPage.getByText("You have not added any wallets yet.")).toBeVisible();
  // The same address is theirs to add: wallets are per user.
  await addWallet(otherPage, LOWER);
  await expect(rows(otherPage)).toHaveCount(1);
  await other.close();

  await page.goto("/wallets");
  await expect(rows(page)).toHaveCount(1);
});
