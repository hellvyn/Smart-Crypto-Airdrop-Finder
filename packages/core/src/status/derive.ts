import type { Status } from "../types.js";

export interface StatusEvidence {
  status: Status;
  at: Date;
}

const isValid = (d: Date | null): d is Date => d !== null && !Number.isNaN(d.getTime());

/** Date an evidence item should be attributed to: published, else page-updated, else fetched. */
export function pickEvidenceDate(doc: {
  publishedAt: Date | null;
  pageUpdatedAt: Date | null;
  fetchedAt: Date;
}): Date {
  if (isValid(doc.publishedAt)) return doc.publishedAt;
  if (isValid(doc.pageUpdatedAt)) return doc.pageUpdatedAt;
  return doc.fetchedAt;
}

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Latest non-unknown evidence wins (ties: later array entry). `conflict` is true when
 * different non-unknown statuses were reported on the same UTC date as the latest evidence.
 */
export function deriveStatus(
  evidence: StatusEvidence[],
  current: Status | null,
): { status: Status; conflict: boolean } {
  const known = evidence.filter((e) => e.status !== "unknown" && !Number.isNaN(e.at.getTime()));
  let latest: StatusEvidence | undefined;
  for (const e of known) {
    if (latest === undefined || e.at.getTime() >= latest.at.getTime()) latest = e;
  }
  if (latest === undefined) return { status: current ?? "unknown", conflict: false };

  const day = utcDay(latest.at);
  const statuses = new Set(known.filter((e) => utcDay(e.at) === day).map((e) => e.status));
  return { status: latest.status, conflict: statuses.size >= 2 };
}
