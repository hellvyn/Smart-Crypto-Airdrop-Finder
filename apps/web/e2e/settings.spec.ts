import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";

const PASSWORD = "correct-horse-1";
const WALLET = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";

test.afterAll(async () => {
  await deleteCreatedUsers();
});

async function signedInUser(page: Page, tag: string): Promise<{ email: string; id: string }> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  const { data, error } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error("user not found");
  return { email, id: user.id };
}

async function profileOf(userId: string) {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("digest_enabled, new_airdrops_opt_in, timezone")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

test("signed out, /settings sends the user to log in", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
});

test("the settings page shows the profile defaults", async ({ page }) => {
  await signedInUser(page, "s-defaults");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Email me a daily digest")).toBeChecked();
  await expect(page.getByLabel("Email me new airdrops")).not.toBeChecked();
  await expect(page.getByLabel("Time zone")).toHaveValue("UTC");
  await expect(page.getByRole("heading", { name: "Delete account" })).toBeVisible();
});

test("turning the digest off persists after a reload", async ({ page }) => {
  const { id } = await signedInUser(page, "s-digest");
  await page.goto("/settings");
  await page.getByLabel("Email me a daily digest").uncheck();
  await page.getByLabel("Email me new airdrops").check();
  await page.getByLabel("Time zone").selectOption("Asia/Jakarta");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Email me a daily digest")).not.toBeChecked();
  await expect(page.getByLabel("Email me new airdrops")).toBeChecked();
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Jakarta");
  expect(await profileOf(id)).toEqual({ digest_enabled: false, new_airdrops_opt_in: true, timezone: "Asia/Jakarta" });
});

test("an unknown time zone shows an error and changes nothing", async ({ page }) => {
  const { id } = await signedInUser(page, "s-tz");
  await page.goto("/settings");
  await page.getByLabel("Email me a daily digest").uncheck();
  // The select only offers valid zones; post a forged value to exercise the server-side check.
  await page.getByLabel("Time zone").evaluate((el) => {
    const select = el as HTMLSelectElement;
    select.add(new Option("Mars/Base", "Mars/Base"));
    select.value = "Mars/Base";
  });
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Unknown time zone.")).toBeVisible();
  await expect(page.getByText("Settings saved.")).toHaveCount(0);
  expect(await profileOf(id)).toEqual({ digest_enabled: true, new_airdrops_opt_in: false, timezone: "UTC" });
});

test("deleting the account needs DELETE typed exactly, then removes the account and its data", async ({ page, context }) => {
  const { email, id } = await signedInUser(page, "s-del");
  const db = adminClient();

  // Some data to be deleted along with the account.
  const wallet = await db.from("wallets").insert({ user_id: id, address: WALLET, chain_family: "evm" });
  if (wallet.error) throw wallet.error;
  const now = new Date().toISOString();
  const tag = Date.now();
  const project = await db
    .from("projects")
    .insert({ slug: `e2e-settings-${tag}`, name: "E2E Settings", name_key: `e2esettings${tag}`, chains: [], status: "live", first_seen: now, last_seen: now })
    .select("id")
    .single();
  if (project.error) throw project.error;
  const watch = await db.from("watchlist").insert({ user_id: id, project_id: project.data.id });
  if (watch.error) throw watch.error;
  const check = await db.from("wallet_checks").insert({ user_id: id, address: WALLET, chain: "ethereum", result: { e2e: true } });
  if (check.error) throw check.error;
  const request = await db.from("wallet_check_requests").insert({ user_id: id });
  if (request.error) throw request.error;

  try {
    await page.goto("/settings");
    // Wrong confirmation: error, account intact.
    await page.getByLabel(/Type DELETE to confirm/).fill("delete");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText("Type DELETE to confirm.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/settings/);
    expect((await db.auth.admin.getUserById(id)).data.user).not.toBeNull();
    const stillThere = await db.from("wallets").select("id").eq("user_id", id);
    expect(stillThere.data).toHaveLength(1);

    // Right confirmation: signed out, notice shown.
    await page.getByLabel(/Type DELETE to confirm/).fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/\?deleted=1$/);
    await expect(page.getByText("Your account was deleted.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();

    // The session is gone ...
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
    // ... the old credentials no longer work ...
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await context.clearCookies();

    // ... and the user's rows are gone.
    expect((await db.auth.admin.getUserById(id)).data.user).toBeNull();
    for (const table of ["wallets", "watchlist", "profiles", "wallet_checks", "wallet_check_requests"]) {
      const res = await db.from(table).select("user_id").eq("user_id", id);
      expect(res.error).toBeNull();
      expect(res.data, table).toHaveLength(0);
    }
  } finally {
    await db.from("projects").delete().eq("id", project.data.id);
  }
});
