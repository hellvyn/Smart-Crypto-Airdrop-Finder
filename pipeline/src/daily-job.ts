// The daily job behind `main.ts`: reads the environment, builds the real dependencies, runs the pipeline and
// returns the process exit code. Split out of the entry point so tests can run it with fakes.
import { createClient } from "@supabase/supabase-js";
import { createChat, createClaudeClient, loadProviders, usableModels } from "@saf/llm";
import { defaultConfig } from "./config.js";
import { createFetchImage, createFetchUntrusted, createHttp } from "./http.js";
import { runDaily } from "./run.js";
import type { PipelineDeps } from "./run.js";
import { runExitCode } from "./stats.js";
import { SupabaseRepo } from "./store/supabase-repo.js";

/**
 * Runs one daily pipeline job and returns its exit code. Prints exactly one JSON line of numeric counters
 * through `log`. `overrides` replace the real dependencies (tests only); the production entry passes none.
 */
export async function runDailyJob(
  env: Record<string, string | undefined>,
  overrides: Partial<PipelineDeps> = {},
  log: (line: string) => void = console.log,
): Promise<number> {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    log(JSON.stringify({ config_error: 1 }));
    return 1;
  }
  const providers = loadProviders(env);
  const claude = providers.anthropic.apiKey === "" ? null : createClaudeClient(providers.anthropic.apiKey, fetch);
  // Without ANTHROPIC_API_KEY the analyses skip Claude entirely: no request and no circuit breaker failure.
  const config = { ...defaultConfig, analyzeModels: usableModels(defaultConfig.analyzeModels, providers) };

  let stats;
  try {
    stats = await runDaily(
      {
        repo: new SupabaseRepo(createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })),
        http: createHttp(),
        fetchUntrusted: createFetchUntrusted(),
        fetchImage: createFetchImage(),
        chat: createChat(providers, { fetch, claude }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => new Date(),
        ...overrides,
      },
      config,
    );
  } catch {
    // Full counters (with run_error and failed_step) are stored in pipeline_runs.
    log(JSON.stringify({ run_error: 1 }));
    return 1;
  }
  log(JSON.stringify(stats));
  return runExitCode(stats);
}
