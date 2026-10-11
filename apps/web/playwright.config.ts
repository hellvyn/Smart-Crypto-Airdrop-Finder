import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";
import { loadSupabaseEnv } from "./e2e/support/supabase-env";

const { url, anonKey } = loadSupabaseEnv();
const baseURL = "http://127.0.0.1:3000";
const PRICES_STUB = "http://127.0.0.1:3101";
const LLM_STUB = "http://127.0.0.1:3102";

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
  webServer: [
    {
      // A local stand-in for DefiLlama's coins API: result prices in the e2e never touch the network.
      command: "node e2e/support/prices-stub.mjs",
      url: `${PRICES_STUB}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PRICES_STUB_PORT: "3101" },
    },
    {
      // A local stand-in for the freellm chat endpoint: the Coach e2e never calls a real model.
      command: "node e2e/support/llm-stub.mjs",
      url: `${LLM_STUB}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { LLM_STUB_PORT: "3102" },
    },
    {
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
        // A developer's real CoinGecko key in the shell must not make the tests call CoinGecko: without a key the
        // prices come from the local stub below.
        COINGECKO_API_KEY: "",
        // lib/prices.ts accepts this override only for a loopback address.
        PRICES_API_BASE: PRICES_STUB,
        // The Coach talks to the local stub only: freellm points at it, and with no Claude or NVIDIA key in the
        // environment no real model is reachable. The NVIDIA models stay in the chain but are never reached, because
        // the stub answers every request.
        LLM_BASE_URL: LLM_STUB,
        LLM_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        NVIDIA_API_KEY: "",
      },
    },
  ],
});
