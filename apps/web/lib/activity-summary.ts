// Pure helpers (safe for client code): ActivitySummary <-> JSON, as stored in wallet_checks.result and sent by the API.
import type { ActivitySummary } from "@saf/core";

/** The JSON stored in wallet_checks.result and sent over the wire: dates as ISO strings. */
export interface StoredSummary {
  chain: string;
  txCount: number;
  firstTxAt: string | null;
  lastTxAt: string | null;
  activeMonths: { value: number; exact: boolean };
  source: string;
  fetchedAt: string;
}

export function serializeSummary(s: ActivitySummary): StoredSummary {
  return {
    chain: s.chain,
    txCount: s.txCount,
    firstTxAt: s.firstTxAt ? s.firstTxAt.toISOString() : null,
    lastTxAt: s.lastTxAt ? s.lastTxAt.toISOString() : null,
    activeMonths: { value: s.activeMonths.value, exact: s.activeMonths.exact },
    source: s.source,
    fetchedAt: s.fetchedAt.toISOString(),
  };
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t);
}

/** Rebuilds an ActivitySummary (with Date objects) from stored/wire JSON; null when it is not a valid summary. */
export function parseSummary(v: unknown): ActivitySummary | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const am = o.activeMonths as { value?: unknown; exact?: unknown } | null | undefined;
  const firstTxAt = parseDate(o.firstTxAt);
  const lastTxAt = parseDate(o.lastTxAt);
  const fetchedAt = parseDate(o.fetchedAt);
  if (
    typeof o.chain !== "string" ||
    typeof o.source !== "string" ||
    !Number.isSafeInteger(o.txCount) ||
    (o.txCount as number) < 0 ||
    firstTxAt === undefined ||
    lastTxAt === undefined ||
    !fetchedAt ||
    !am ||
    !Number.isSafeInteger(am.value) ||
    typeof am.exact !== "boolean"
  ) {
    return null;
  }
  return {
    chain: o.chain,
    txCount: o.txCount as number,
    firstTxAt,
    lastTxAt,
    activeMonths: { value: am.value as number, exact: am.exact },
    source: o.source,
    fetchedAt,
  };
}
