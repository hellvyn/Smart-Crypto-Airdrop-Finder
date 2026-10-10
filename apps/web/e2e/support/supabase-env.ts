// Test-harness only: resolves the local Supabase URL and keys for Playwright.
// The service role key is used by the tests (admin API: create users, generate auth links) and is never
// handed to the Next.js server (see playwright.config.ts) or imported by app code.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function readSupabaseStatus(): Record<string, string> {
  try {
    const text = execFileSync("npx", ["-y", "supabase@2.120.0", "status", "-o", "env"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseEnvLines(text);
  } catch {
    return {};
  }
}

/** Fills NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in process.env. */
export function loadSupabaseEnv(): { url: string; anonKey: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    const status = readSupabaseStatus();
    url ??= status.API_URL;
    anonKey ??= status.ANON_KEY;
    serviceRoleKey ??= status.SERVICE_ROLE_KEY;
  }
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Local Supabase is not running. Start it from the repo root with `npx -y supabase@2.120.0 start`, " +
        "or set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  return { url, anonKey };
}
