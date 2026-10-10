// Email quota allocation: pure, deterministic. Higher urgency (lower number) goes first.

export function allocateQuota(
  candidates: { key: string; priority: 0 | 1 | 2 }[],
  opts: { dailyLimit: number; reserveRatio: number; sentToday: number },
): { send: string[]; skipped: number } {
  const { dailyLimit, reserveRatio, sentToday } = opts;
  const valid =
    Number.isFinite(dailyLimit) &&
    dailyLimit >= 0 &&
    Number.isFinite(reserveRatio) &&
    reserveRatio >= 0 &&
    reserveRatio <= 1 &&
    Number.isFinite(sentToday) &&
    sentToday >= 0;
  const budget = valid ? Math.max(0, Math.floor(dailyLimit * (1 - reserveRatio)) - sentToday) : 0;
  // Array.prototype.sort is stable: equal priorities keep their input order.
  const ordered = [...candidates].sort((x, y) => x.priority - y.priority);
  const send = ordered.slice(0, budget).map((c) => c.key);
  return { send, skipped: candidates.length - send.length };
}
