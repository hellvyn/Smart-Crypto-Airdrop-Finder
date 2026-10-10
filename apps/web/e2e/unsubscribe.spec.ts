import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";

const PASSWORD = "correct-horse-1";
const INVALID = "This link is invalid or already used.";

test.afterAll(async () => {
  await deleteCreatedUsers();
});

/** A user with the digest on, and the secret token that the email link carries. */
async function userWithToken(tag: string): Promise<{ email: string; id: string; token: string }> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error("user not found");
  const profile = await db.from("profiles").select("unsubscribe_token").eq("user_id", user.id).single();
  if (profile.error) throw profile.error;
  return { email, id: user.id, token: profile.data.unsubscribe_token as string };
}

async function digestEnabled(userId: string): Promise<boolean> {
  const { data, error } = await adminClient().from("profiles").select("digest_enabled").eq("user_id", userId).single();
  if (error) throw error;
  return data.digest_enabled as boolean;
}

test("opening the link (GET) shows the button and changes nothing", async ({ page, request }) => {
  const { id, token } = await userWithToken("u-get");
  await page.goto(`/unsubscribe?token=${token}`);
  await expect(page.getByRole("button", { name: "Unsubscribe from daily digest" })).toBeVisible();
  await expect(page.getByText("You are unsubscribed.")).toHaveCount(0);
  // A link scanner fetching the URL (even repeatedly) must not unsubscribe anyone.
  for (let i = 0; i < 2; i++) expect((await request.get(`/unsubscribe?token=${token}`)).ok()).toBe(true);
  expect(await digestEnabled(id)).toBe(true);
});

test("the page is noindex", async ({ page }) => {
  await page.goto(`/unsubscribe?token=${randomUUID()}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("clicking the button unsubscribes, signed out", async ({ page }) => {
  const { id, token } = await userWithToken("u-click");
  await page.goto(`/unsubscribe?token=${token}`);
  await page.getByRole("button", { name: "Unsubscribe from daily digest" }).click();
  await expect(page.getByText("You are unsubscribed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Turn it back on in Settings" })).toHaveCount(0);
  expect(page.url()).not.toContain(token);
  expect(await digestEnabled(id)).toBe(false);
});

test("a second POST with the same token still says unsubscribed", async ({ page, context }) => {
  const { id, token } = await userWithToken("u-twice");
  await page.goto(`/unsubscribe?token=${token}`);
  await page.getByRole("button", { name: "Unsubscribe from daily digest" }).click();
  await expect(page.getByText("You are unsubscribed.")).toBeVisible();

  // The same email link opened again (e.g. from another tab or a scanner) and submitted again.
  const second = await context.newPage();
  await second.goto(`/unsubscribe?token=${token}`);
  await second.getByRole("button", { name: "Unsubscribe from daily digest" }).click();
  await expect(second.getByText("You are unsubscribed.")).toBeVisible();
  expect(await digestEnabled(id)).toBe(false);
});

test("an unknown token looks the same as a form until the POST, then says invalid", async ({ page }) => {
  await page.goto(`/unsubscribe?token=${randomUUID()}`);
  await expect(page.getByRole("button", { name: "Unsubscribe from daily digest" })).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe from daily digest" }).click();
  await expect(page.getByText(INVALID)).toBeVisible();
  await expect(page.getByText("You are unsubscribed.")).toHaveCount(0);
});

test("a malformed or missing token shows the invalid copy and no form", async ({ page }) => {
  for (const path of ["/unsubscribe?token=not-a-uuid", "/unsubscribe?token=", "/unsubscribe"]) {
    await page.goto(path);
    await expect(page.getByText(INVALID)).toBeVisible();
    await expect(page.getByRole("button", { name: "Unsubscribe from daily digest" })).toHaveCount(0);
    await expect(page.locator("main form")).toHaveCount(0);
  }
});

test("signed in, the done view links to Settings", async ({ page }) => {
  const { email, id, token } = await userWithToken("u-signedin");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);

  await page.goto(`/unsubscribe?token=${token}`);
  await page.getByRole("button", { name: "Unsubscribe from daily digest" }).click();
  await expect(page.getByText("You are unsubscribed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Turn it back on in Settings" })).toHaveAttribute("href", "/settings");
  expect(await digestEnabled(id)).toBe(false);
});
