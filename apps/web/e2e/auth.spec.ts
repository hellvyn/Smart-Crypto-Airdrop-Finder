import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";

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

test("wrong credentials show the error as-is, then logging in and out works", async ({ page }) => {
  const email = uniqueEmail("logout");
  await createConfirmedUser(email, PASSWORD);

  await page.goto("/login");
  await logIn(page, email, "wrong-password-9");
  await expect(formError(page)).toHaveText("Invalid login credentials");

  await logIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/watchlist$/);
  await expectSignedInAs(page, email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("user-email")).toHaveCount(0);
});

test("the login page has no signup or forgot-password link, and tells visitors to ask the admin", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Belum punya akses? Hubungi admin.")).toBeVisible();
  await expect(page.locator("main a[href*='signup']")).toHaveCount(0);
  await expect(page.locator("main a[href*='reset-password']")).toHaveCount(0);
  await expect(page.getByText(/sign up|forgot your password/i)).toHaveCount(0);
});

// Old email links and bookmarks must end in a plain 404, never a 500 or a redirect to a form.
for (const path of [
  "/signup",
  "/reset-password",
  "/update-password",
  "/auth/callback",
  "/auth/callback?token_hash=old-token&type=email",
  "/auth/callback?code=old-code",
  "/unsubscribe",
  "/unsubscribe?token=3f0b4d6c-8e53-4c43-9f0e-0d6d5a1f2b11",
]) {
  test(`${path} is gone (404)`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  });
}

test("signing up through the auth API with the anon key is refused", async () => {
  // The web app has no signup form any more; this checks that the API is shut too (supabase/config.toml).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = uniqueEmail("api-signup");

  const { data, error } = await anon.auth.signUp({ email, password: PASSWORD });
  expect(error?.code).toBe("signup_disabled");
  expect(data.user).toBeNull();
  expect(data.session).toBeNull();
});
