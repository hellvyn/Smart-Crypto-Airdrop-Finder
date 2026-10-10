import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";
import { loadSupabaseEnv } from "./e2e/support/supabase-env";

const { url, anonKey } = loadSupabaseEnv();
const baseURL = "http://127.0.0.1:3000";

// Use the Chromium build this Playwright version expects (CI installs it). When only a different preinstalled
// build is available (PLAYWRIGHT_BROWSERS_PATH sandbox), launch that one directly.
const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath =
  !existsSync(chromium.executablePath()) && existsSync(FALLBACK_CHROMIUM) ? FALLBACK_CHROMIUM : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    // CI builds in its own step; locally build first so the run uses production output. The host and port are the
    // test server's (baseURL), not defaults of `pnpm start`, which stays a plain `next start` for deployments.
    command: `${process.env.CI ? "" : "pnpm build && "}pnpm exec next start --hostname 127.0.0.1 --port 3000`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      NEXT_PUBLIC_SITE_URL: baseURL,
      // The web server must never see the service role key; it is for the test harness only.
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  },
});
