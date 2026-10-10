// Daily pipeline entry point (GitHub Actions). Prints only the numeric run stats as one JSON line:
// never errors, URLs, document text, project names, emails or wallet addresses (spec section 9).
// Exits 1 after everything is persisted when a stage, source, ingest, merge, assessment or digest failed.
// Email digests are sent only when BREVO_API_KEY is set; EMAIL_FROM and SITE_URL are then required, and a missing
// or invalid one fails only the notify stage (failed_step 7, exit 1): collect, score and purge still run.
import { createClient } from "@supabase/supabase-js";
import { defaultConfig, loadEmailEnv } from "./config.js";
import { createHttp } from "./http.js";
import { streamChat } from "./llm/nvidia.js";
import { BrevoSender } from "./notify/email-sender.js";
import { runDaily } from "./run.js";
import { runExitCode } from "./stats.js";
import { SupabaseRepo } from "./store/supabase-repo.js";

async function main(): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emailEnv = loadEmailEnv(process.env);
  if (!supabaseUrl || !serviceKey) {
    console.log(JSON.stringify({ config_error: 1 }));
    return 1;
  }
  const { brevo } = emailEnv;
  const apiKey = process.env.NVIDIA_API_KEY ?? "";
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let stats;
  try {
    stats = await runDaily(
      {
        repo: new SupabaseRepo(db),
        http: createHttp(),
        chat: (model, messages) => streamChat(model, messages, { fetch, apiKey }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => new Date(),
        sender: brevo === null ? undefined : new BrevoSender({ fetch, apiKey: brevo.apiKey, from: brevo.from }),
      },
      { ...defaultConfig, email: emailEnv.email },
    );
  } catch {
    // Full counters (with run_error and failed_step) are stored in pipeline_runs.
    console.log(JSON.stringify({ run_error: 1 }));
    return 1;
  }
  console.log(JSON.stringify(stats));
  return runExitCode(stats);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.log(JSON.stringify({ run_error: 1 }));
    process.exitCode = 1;
  },
);
