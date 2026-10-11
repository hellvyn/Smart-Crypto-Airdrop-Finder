// Daily pipeline entry point (GitHub Actions). Prints only the numeric run stats as one JSON line:
// never errors, URLs, document text, project names, emails or wallet addresses (spec section 9).
// Exits 1 after everything is persisted when a stage, source, ingest, merge or assessment failed.
import { runDailyJob } from "./daily-job.js";

runDailyJob(process.env).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.log(JSON.stringify({ run_error: 1 }));
    process.exitCode = 1;
  },
);
