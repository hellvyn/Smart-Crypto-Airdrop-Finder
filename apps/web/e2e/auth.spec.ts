import { expect, test, type Page } from "@playwright/test";
import {
  createConfirmedUser,
  deleteCreatedUsers,
  recoveryLink,
  signupVerificationLink,
  uniqueEmail,
} from "./support/admin";

const PASSWORD = "correct-horse-1";

test.afterAll(async () => {
  await deleteCreatedUsers();
});

async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** The form's error message (Next.js also renders an empty role=alert route announcer outside <main>). */
function formError(page: Page) {
  return page.locator("main").getByRole("alert");
}

async function expectSignedInAs(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId("user-email")).toHaveText(email);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("opening /watchlist signed out redirects to /login, and back after logging in", async ({ page }) => {
  const email = uniqueEmail("redirect");
  await createConfirmedUser(email, PASSWORD);

  await page.goto("/watchlist");
  await expect(page).toHaveURL(/\/login\?next=%2Fwatchlist$/);
  await expect(page.getByTestId("user-email")).toHaveCount(0);

  await logIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByRole("heading", { name: "Your watchlist" })).toBeVisible();
  await expectSignedInAs(page, email);
});

test("an off-site next parameter is ignored after login", async ({ page }) => {
  const email = uniqueEmail("next");
  await createConfirmedUser(email, PASSWORD);

  await page.goto("/login?next=//evil.example/steal");
  await logIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:3000\/watchlist$/);
});

test("signup form creates an account and signs the user in", async ({ page }) => {
  // Local supabase/config.toml keeps email confirmations off (no SMTP in CI), so signup signs in directly.
  // The verification-link path is covered by the next test.
  const email = uniqueEmail("signup");
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("heading", { name: "Your watchlist" })).toBeVisible();
  await expectSignedInAs(page, email);
});

test("signup verification link confirms the email, then login works", async ({ page }) => {
  const email = uniqueEmail("verify");
  const link = await signupVerificationLink(email, PASSWORD);

  // Before verifying, Supabase refuses the login and the message is shown as-is.
  await page.goto("/login");
  await logIn(page, email, PASSWORD);
  await expect(formError(page)).toHaveText("Email not confirmed");

  await page.goto(link);
  await expect(page).toHaveURL(/\/watchlist$/);
  await expectSignedInAs(page, email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("user-email")).toHaveCount(0);

  await logIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/watchlist$/);
  await expectSignedInAs(page, email);
});

test("password reset: request, recovery link, new password, login with it", async ({ page }) => {
  const email = uniqueEmail("reset");
  const newPassword = "new-battery-staple-2";
  await createConfirmedUser(email, PASSWORD);

  // The request form posts to Supabase and shows its answer. Without an SMTP server (CI, sandbox) that answer
  // is Supabase's send error; with one it is the confirmation. Either way a message is rendered.
  await page.goto("/reset-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator("main").locator("[role=status], [role=alert]")).toBeVisible();

  await page.goto(await recoveryLink(email));
  await expect(page).toHaveURL(/\/update-password$/);
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  await expectSignedInAs(page, email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await logIn(page, email, PASSWORD);
  await expect(formError(page)).toHaveText("Invalid login credentials");

  await logIn(page, email, newPassword);
  await expect(page).toHaveURL(/\/watchlist$/);
  await expectSignedInAs(page, email);
});

test("an invalid or used link shows an error on the login page", async ({ page }) => {
  await page.goto("/auth/callback?token_hash=not-a-real-token&type=signup");
  await expect(page).toHaveURL(/\/login\?error=link$/);
  await expect(formError(page)).toHaveText("This link is invalid or has expired. Request a new one.");
});
