// Morning briefing (coach and briefing spec §4.3, §6): the facts of the day, the check of what the model writes about
// them, and the version without the AI. Pure: the pipeline reads the rows and writes the result.
import { z } from "zod";
import { cleanStyle, findBanned } from "../style.js";
import type { DeadlineKind, RiskLevel, Status } from "../types.js";
import { groundedAgainst } from "./guard.js";

/** The most items a briefing has. */
export const MAX_BRIEFING_ITEMS = 5;
/** The longest item text kept (characters). */
const MAX_ITEM_CHARS = 300;

export type BriefingFactKind = "risk" | "deadline" | "status" | "curated";

/** One thing that happened, in words the model may restate and nothing more. */
export interface BriefingFact {
  projectId: string;
  slug: string;
  name: string;
  kind: BriefingFactKind;
  text: string;
}

interface BriefingProject {
  projectId: string;
  slug: string;
  name: string;
}

/** One `project_changes` row of the last day. Rows that are not a status or risk change are ignored. */
export interface BriefingChange extends BriefingProject {
  field: "status" | "risk_level" | "curated";
  oldValue: string | null;
  newValue: string;
}

/** A stored deadline with its project; `date` is `YYYY-MM-DD`. */
export interface BriefingDeadline extends BriefingProject {
  kind: DeadlineKind;
  date: string;
}

/** One point of a briefing as stored in `briefings.items` and shown by the web. */
export interface BriefingItem {
  projectId: string;
  slug: string;
  name: string;
  text: string;
}

/** What the model answers: `{"items": [{"project_id", "text"}]}`. */
export const briefingAnswerSchema = z.object({
  items: z.array(z.object({ project_id: z.string(), text: z.string() })).max(40),
});
export type BriefingAnswer = z.infer<typeof briefingAnswerSchema>;

const STATUS_LABEL: Record<Status, string> = {
  live: "Live",
  announced: "Diumumkan",
  speculative: "Spekulatif",
  ended: "Ended",
  unknown: "Belum pasti",
};
const RISK_LABEL: Partial<Record<RiskLevel, string>> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  critical: "Kritis",
};
const RISK_RANK: Partial<Record<RiskLevel, number>> = { low: 0, medium: 1, high: 2, critical: 3 };

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** `2026-10-12` as "12 Oktober 2026"; the input unchanged when it is not a date. */
function dateText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = m === null ? undefined : MONTHS[Number(m[2]) - 1];
  return m === null || month === undefined ? date : `${Number(m[3])} ${month} ${m[1]}`;
}

const DEADLINE_TEXT: Partial<Record<DeadlineKind, (name: string, date: string) => string>> = {
  claim: (name, date) => `Claim ${name} ditutup ${date}.`,
  snapshot: (name, date) => `Snapshot ${name} ${date}.`,
  campaign_end: (name, date) => `Campaign ${name} berakhir ${date}.`,
};

const KIND_ORDER: Record<BriefingFactKind, number> = { risk: 0, deadline: 1, status: 2, curated: 3 };

/**
 * The facts of the day: a risk raise, a claim/snapshot/campaign_end deadline (the caller passes the next 48 hours),
 * a status change and a newly curated project, in that order (deadlines by date). A risk level that went down, stayed
 * or has no earlier level is not a raise. The same deadline from two documents is one fact.
 */
export function briefingInputs(
  changes: BriefingChange[],
  deadlines: BriefingDeadline[],
  curated: BriefingProject[],
): BriefingFact[] {
  const facts: (BriefingFact & { sort: string })[] = [];
  const fact = (p: BriefingProject, kind: BriefingFactKind, text: string, sort = ""): void => {
    facts.push({ projectId: p.projectId, slug: p.slug, name: p.name, kind, text, sort });
  };
  for (const c of changes) {
    if (c.field === "status") {
      const label = STATUS_LABEL[c.newValue as Status];
      if (label !== undefined && c.oldValue !== c.newValue) fact(c, "status", `${c.name} berubah status jadi ${label}.`);
    } else if (c.field === "risk_level") {
      const from = c.oldValue === null ? undefined : RISK_RANK[c.oldValue as RiskLevel];
      const to = RISK_RANK[c.newValue as RiskLevel];
      const label = RISK_LABEL[c.newValue as RiskLevel];
      if (from !== undefined && to !== undefined && label !== undefined && to > from) {
        fact(c, "risk", `Risiko ${c.name} naik jadi ${label}.`);
      }
    }
  }
  const seen = new Set<string>();
  for (const d of deadlines) {
    const text = DEADLINE_TEXT[d.kind]?.(d.name, dateText(d.date));
    const key = `${d.projectId}|${d.kind}|${d.date}`;
    if (text === undefined || seen.has(key)) continue;
    seen.add(key);
    fact(d, "deadline", text, d.date);
  }
  for (const c of curated) fact(c, "curated", `${c.name} baru masuk list.`);
  // Array.prototype.sort is stable: equal keys keep their input order.
  return facts
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .map(({ sort: _sort, ...rest }) => rest);
}

/** The banned words and phrases (`BANNED_WORDS`) the answer's texts use, in the order of the items. */
export function briefingBanned(answer: BriefingAnswer): string[] {
  return [...new Set(answer.items.flatMap((item) => findBanned(cleanStyle(item.text))))];
}

/**
 * The items of a model answer that may be shown: at most 5, one per project, each naming the `projectId` of a fact
 * (slug and name come from the fact, never from the model), restating no host, address, number or payment/secret term
 * that the facts of that project do not have (`groundedAgainst`), em dashes replaced, and none with a banned word.
 */
export function validateBriefing(answer: BriefingAnswer, facts: BriefingFact[]): BriefingItem[] {
  const items: BriefingItem[] = [];
  for (const raw of answer.items) {
    if (items.length >= MAX_BRIEFING_ITEMS) break;
    if (items.some((i) => i.projectId === raw.project_id)) continue;
    const own = facts.filter((f) => f.projectId === raw.project_id);
    const first = own[0];
    if (first === undefined) continue;
    const text = cleanStyle(raw.text).trim();
    if (text === "" || text.length > MAX_ITEM_CHARS) continue;
    if (findBanned(text).length > 0) continue;
    if (!groundedAgainst(text, own.map((f) => f.text).join("\n"))) continue;
    items.push({ projectId: first.projectId, slug: first.slug, name: first.name, text });
  }
  return items;
}

/** The briefing without the AI: the fact texts as they are, at most 5. */
export function fallbackBriefing(facts: BriefingFact[]): BriefingItem[] {
  return facts
    .slice(0, MAX_BRIEFING_ITEMS)
    .map((f) => ({ projectId: f.projectId, slug: f.slug, name: f.name, text: f.text }));
}
