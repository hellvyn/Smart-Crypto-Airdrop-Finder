import type { DailyStats } from "../stats.js";
import type { PipelineRepo } from "../store/repo.js";

const DAY_MS = 86_400_000;
/** Coach threads (and their messages) and briefings are kept this long. */
const COACH_RETENTION_DAYS = 30;
/** The quota ledger only matters for the current WIB day; 2 days leaves a margin. */
const COACH_USAGE_RETENTION_DAYS = 2;

/** Blanks document text past the retention window (content hashes stay for change detection). */
export async function purgeOldText(
  repo: PipelineRepo,
  retentionDays: number,
  now: Date,
  stats: DailyStats,
): Promise<void> {
  stats.purged += await repo.purgeDocumentText(retentionDays, now);
}

/** Deletes coach threads and briefings older than 30 days and quota ledger rows older than 2 days (counts only). */
export async function purgeCoach(repo: PipelineRepo, now: Date, stats: DailyStats): Promise<void> {
  const old = await repo.purgeCoachAndBriefings(new Date(now.getTime() - COACH_RETENTION_DAYS * DAY_MS));
  stats.coach_threads_purged += old.threads;
  stats.coach_usage_purged += await repo.purgeCoachUsage(new Date(now.getTime() - COACH_USAGE_RETENTION_DAYS * DAY_MS));
}
