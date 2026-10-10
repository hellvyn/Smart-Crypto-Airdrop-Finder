import type { DailyStats } from "../stats.js";
import type { PipelineRepo } from "../store/repo.js";

/** Blanks document text past the retention window (content hashes stay for change detection). */
export async function purgeOldText(
  repo: PipelineRepo,
  retentionDays: number,
  now: Date,
  stats: DailyStats,
): Promise<void> {
  stats.purged += await repo.purgeDocumentText(retentionDays, now);
}
