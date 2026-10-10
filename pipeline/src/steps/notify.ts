import pLimit from "p-limit";
import { allocateQuota, buildDigest, renderDigestEmail } from "@saf/core";
import type { Digest, DigestProject } from "@saf/core";
import type { EmailConfig } from "../config.js";
import type { EmailSender } from "../notify/email-sender.js";
import { DuplicateDigestError } from "../store/repo.js";
import type { DigestRecipient, PipelineRepo, RunStats } from "../store/repo.js";

/** Maximum parallel send requests. */
const SEND_CONCURRENCY = 5;
/** "New airdrops today" = first seen in the last 24 hours, not a lookalike, newest first. */
const NEW_PROJECT_HOURS = 24;
/** At most this many new airdrops per digest. */
const NEW_PROJECT_LIMIT = 10;

export interface NotifyStats extends RunStats {
  digests_sent: number;
  /** Recipients whose digest had nothing in it (no email is sent). */
  digests_empty: number;
  /** Digests not sent because the day's quota ran out (lowest priority first). */
  digests_skipped_quota: number;
  /** Digests that could not be built, sent or logged. They are not logged, so a later run can send them. */
  digests_failed: number;
  /** Recipients who already got today's digest from an earlier run (found in the log before sending). */
  digests_already_sent: number;
  /**
   * Digests that were sent but could not be logged because a concurrent run had already logged that user's
   * digest for today: the user got two emails today.
   */
  digests_duplicate: number;
}

/**
 * Sends the daily digest: at most one per user per UTC day, only to recipients with a confirmed email, only
 * when it has content, within the day's quota. A digest is logged only after the provider accepted it.
 *
 * One recipient's failure (context read, render, send or log) is counted in `digests_failed` and never stops
 * the others; there is no retry within a run. Reading the recipients, today's count or the new projects is
 * stage-level: it throws before anything is sent. Stats hold counts only, never addresses or user ids.
 */
export interface NotifyDeps {
  repo: PipelineRepo;
  sender: EmailSender;
  /**
   * Start time of the run. The UTC send date (`ref_date`), the deadline window, the change window and the new
   * projects window are all taken from it, so a run that crosses 00:00 UTC still sends under its start date.
   */
  runStart: Date;
  /** Clock for `sent_at` only. */
  now: () => Date;
}

export async function notifyStep(deps: NotifyDeps, cfg: EmailConfig): Promise<NotifyStats> {
  const { repo, sender } = deps;
  const now = deps.runStart;
  const refDate = now.toISOString().slice(0, 10);
  const stats: NotifyStats = {
    digests_sent: 0,
    digests_empty: 0,
    digests_skipped_quota: 0,
    digests_failed: 0,
    digests_already_sent: 0,
    digests_duplicate: 0,
  };

  const recipients = await repo.listDigestRecipients();
  const sentToday = await repo.countDigestsSent(refDate);
  let newProjects: DigestProject[] | null = null;
  if (recipients.some((r) => r.newAirdropsOptIn)) newProjects = await repo.listNewProjects(NEW_PROJECT_HOURS, now, NEW_PROJECT_LIMIT);

  const candidates: { recipient: DigestRecipient; digest: Digest }[] = [];
  for (const recipient of recipients) {
    try {
      if (await repo.hasDigest(recipient.userId, refDate)) {
        stats.digests_already_sent += 1;
        continue;
      }
      const context = await repo.getDigestContext(recipient.userId, recipient.lastDigestAt, now);
      const digest = buildDigest({
        ...context,
        now,
        newProjects: recipient.newAirdropsOptIn ? (newProjects ?? []) : null,
      });
      if (digest === null) stats.digests_empty += 1;
      else candidates.push({ recipient, digest });
    } catch {
      stats.digests_failed += 1;
    }
  }

  const allocation = allocateQuota(
    candidates.map((c, i) => ({ key: String(i), priority: c.digest.priority })),
    { dailyLimit: cfg.dailyLimit, reserveRatio: cfg.reserveRatio, sentToday },
  );
  stats.digests_skipped_quota += allocation.skipped;

  const limit = pLimit(SEND_CONCURRENCY);
  await Promise.all(
    allocation.send.map((key) =>
      limit(async () => {
        const { recipient, digest } = candidates[Number(key)] as (typeof candidates)[number];
        await sendOne(deps, cfg, recipient, digest, refDate, stats);
      }),
    ),
  );
  return stats;
}

/** Renders, sends and logs one digest. Never throws. */
async function sendOne(
  deps: NotifyDeps,
  cfg: EmailConfig,
  recipient: DigestRecipient,
  digest: Digest,
  refDate: string,
  stats: NotifyStats,
): Promise<void> {
  let ok = false;
  try {
    const unsubscribeUrl = `${cfg.siteUrl}/unsubscribe?token=${encodeURIComponent(recipient.unsubscribeToken)}`;
    const email = renderDigestEmail(digest, { siteUrl: cfg.siteUrl, unsubscribeUrl });
    const message = { to: recipient.email, subject: email.subject, html: email.html, text: email.text, listUnsubscribe: unsubscribeUrl };
    ok = (await deps.sender.send(message)).ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    stats.digests_failed += 1;
    return;
  }
  try {
    await deps.repo.logDigest(recipient.userId, refDate, deps.now());
    stats.digests_sent += 1;
  } catch (error) {
    // A unique violation means another run logged today's digest for this user first: this one was a second email.
    if (error instanceof DuplicateDigestError) stats.digests_duplicate += 1;
    // Sent but not logged: a rerun today could send it again, so this fails the job (runExitCode).
    else stats.digests_failed += 1;
  }
}
