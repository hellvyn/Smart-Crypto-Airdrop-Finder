// Pure helpers of the project page (Plan 6 Task 5). No I/O, so they run in Vitest without Supabase.
import { CHECK_OF_REASON } from "@saf/core";
import type { CheckId, RiskReason } from "@saf/core";
import { detail } from "./copy";
import type { DetailCheck, DetailLink, EvidenceRow, ProjectDetail } from "./view";

const DAY_MS = 24 * 60 * 60 * 1000;
const WIB = "Asia/Jakarta";

/** Claim and app links: the ones `link_checks` checks (#42). */
export function isCheckedKind(kind: string): boolean {
  return kind === "claim" || kind === "app";
}

/**
 * "Claim open · link dicek" (#42), the same rule as `public_list.claim_open_checked` (0012): a claim deadline from
 * `today` (UTC) on, and at least one claim link, every one of them checked as official.
 */
export function claimOpenChecked(
  deadlines: ProjectDetail["deadlines"],
  links: DetailLink[],
  today: string,
): boolean {
  const claimLinks = links.filter((l) => l.kind === "claim");
  return (
    deadlines.some((d) => d.kind === "claim" && d.date !== null && d.date >= today) &&
    claimLinks.length > 0 &&
    claimLinks.every((l) => l.status === "official")
  );
}

/** A warning of the assessment came from this check (`CHECK_OF_REASON`, the map the public view uses too). */
export function isFlagged(id: CheckId, reasons: RiskReason[]): boolean {
  return reasons.some((r) => Object.hasOwn(CHECK_OF_REASON, r.code) && CHECK_OF_REASON[r.code] === id);
}

/** A domain's age in words: "2 tahun 3 bulan", "5 bulan", "12 hari". Years of 365 days, months of 30. */
export function domainAge(days: number): string {
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const words = detail.safety.age;
  if (years === 0 && months === 0) return words.days(days);
  return [years > 0 ? words.years(years) : null, months > 0 ? words.months(months) : null].filter(Boolean).join(" ");
}

const calendarDay = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const wibCalendarDay = new Intl.DateTimeFormat("id-ID", { timeZone: WIB, day: "numeric", month: "short", year: "numeric" });

/**
 * The day a domain was registered: the check time minus its age, as a day in WIB like every check time on the page
 * ("12 Jul 2024"). The age is in whole days (floored), so this is the registration day or the day after.
 */
export function registeredOn(computedAt: string, ageDays: number): string {
  return wibCalendarDay.format(new Date(Date.parse(computedAt) - ageDays * DAY_MS));
}

/** A calendar day (`YYYY-MM-DD`) as "1 Okt 2026"; anything else as it is. */
export function formatCalendarDay(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? calendarDay.format(new Date(`${day}T00:00:00Z`)) : day;
}

const wibTime = new Intl.DateTimeFormat("en-GB", { timeZone: WIB, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const wibDay = new Intl.DateTimeFormat("en-GB", { timeZone: WIB, day: "2-digit", month: "2-digit", year: "numeric" });

/** "06.00": the time of a check in WIB. */
export function wibClock(at: string): string {
  return wibTime.format(new Date(at)).replace(":", ".");
}

/** "10.10.2026": the day of a check in WIB, for the stamp. */
export function wibStampDay(at: string): string {
  return wibDay.format(new Date(at)).replaceAll("/", ".");
}

/** The host of a source URL without "www." ("airdrops.io"), or the text itself when it is no URL. */
export function sourceName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host ? host.replace(/^www\./, "") : url;
  } catch {
    return url;
  }
}

/** An AI `source_url` may only become a link when it is one of the project's source documents. */
export function linkableSource(url: string, sourceUrls: string[]): string | null {
  return sourceUrls.includes(url) ? url : null;
}

/**
 * The numbers of the security check strip (#53). "Source dibaca" counts distinct sources (`source_key`: one Telegram
 * channel is one source), as the scanner or the cross-check recorded them; null when neither did (old rows), never a
 * count of documents.
 */
export function safetyStrip(
  risk: { reasons: RiskReason[]; checks: DetailCheck[] },
  links: DetailLink[],
): { layers: number; sources: number | null; links: number; redFlags: number } {
  const checkedKind = links.filter((l) => isCheckedKind(l.kind));
  const sourcesOf = (id: CheckId) => risk.checks.find((c) => c.id === id)?.detail?.sources;
  const scanned = [sourcesOf("dangerous_asks"), sourcesOf("corroboration")].find((n) => typeof n === "number");
  return {
    // Every check that ran (the AI scam review included), plus the link check when the project has claim/app links.
    layers: risk.checks.filter((c) => c.ran).length + (checkedKind.length > 0 ? 1 : 0),
    sources: typeof scanned === "number" ? scanned : null,
    links: checkedKind.filter((l) => l.status !== null && l.status !== "unchecked").length,
    // An AI scam flag reaches the reasons as `ai_scam_pattern`, so it is counted there, for visitors and members alike.
    redFlags: risk.reasons.filter((r) => r.severity !== "info").length,
  };
}

/** The newest `latest_update` fact: latest date first (undated last), then the newest row. */
export function newestUpdate(facts: EvidenceRow[]): EvidenceRow | null {
  const updates = facts.filter((f) => f.field === "latest_update" && f.quote.trim() !== "");
  updates.sort((a, b) => (b.value || "").localeCompare(a.value || "") || b.at.localeCompare(a.at));
  return updates[0] ?? null;
}
