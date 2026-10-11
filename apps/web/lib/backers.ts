// The backers AlphaDrops reports (#41) in one line, for the list row badge (SignalBadges) and section 06 (WhyListed).
import { list } from "@/lib/copy";
import type { CuratedSignal } from "@/lib/view";

/** Investors named before "…". */
const MAX_REPORTED = 3;

/** A signal's `investor`, trimmed; null when missing or blank. */
export function investorOf(s: CuratedSignal): string | null {
  const v = s.value.investor;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * "Menurut AlphaDrops: a16z (lead), Delphi, …" from the `reported_backer` signals, or null when there is none. One
 * entry per investor (case-insensitive, first spelling kept), lead when any of its signals says so; leads first, at
 * most 3 named, "…" for the rest.
 */
export function reportedBackersText(signals: CuratedSignal[]): string | null {
  const byKey = new Map<string, { name: string; lead: boolean }>();
  for (const s of signals) {
    const name = s.kind === "reported_backer" ? investorOf(s) : null;
    if (name === null) continue;
    const known = byKey.get(name.toLowerCase());
    if (known) known.lead ||= s.value.lead === true;
    else byKey.set(name.toLowerCase(), { name, lead: s.value.lead === true });
  }
  if (byKey.size === 0) return null;
  const all = [...byKey.values()];
  const ordered = [...all.filter((r) => r.lead), ...all.filter((r) => !r.lead)];
  const names = ordered.slice(0, MAX_REPORTED).map((r) => (r.lead ? list.signals.lead(r.name) : r.name));
  if (ordered.length > MAX_REPORTED) names.push(list.signals.more);
  return list.signals.reported(names.join(", "));
}
