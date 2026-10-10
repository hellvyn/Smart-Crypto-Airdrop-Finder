import { z } from "zod";
import type { DatePrecision, DeadlineKind, Status } from "../types.js";

const STATUSES = ["live", "announced", "speculative", "ended", "unknown"] as const satisfies readonly Status[];
const DEADLINE_KINDS = [
  "claim",
  "snapshot",
  "campaign_end",
  "withdraw_funds",
  "tge",
  "other",
] as const satisfies readonly DeadlineKind[];
const PRECISIONS = ["exact", "approximate", "month", "quarter"] as const satisfies readonly DatePrecision[];

const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a YYYY-MM-DD string naming a real calendar date. */
function isRealCalendarDate(value: string): boolean {
  const m = DATE_FORMAT.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0..99 to 1900..1999, so setUTCFullYear restores the real year.
  d.setUTCFullYear(year);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const deadlineSchema = z.object({
  kind: z.enum(DEADLINE_KINDS),
  date: z
    .string()
    .refine(isRealCalendarDate, { message: "date must be a real calendar date in YYYY-MM-DD format" })
    .nullable(),
  precision: z.enum(PRECISIONS),
  text: z.string(),
});

const projectSchema = z.object({
  name: z.string().min(1),
  token_symbol: z.string().nullable(),
  chains: z.array(z.string()),
  status: z.enum(STATUSES),
  status_evidence: z.string(),
  tasks: z.array(z.string()),
  deadlines: z.array(deadlineSchema),
  official_urls: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

/** LLM extraction output contract (spec §4.3). Unknown extra keys are stripped. */
export const extractionSchema = z.object({
  is_airdrop_content: z.boolean(),
  projects: z.array(projectSchema),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
export type ExtractedDeadline = ExtractionResult["projects"][number]["deadlines"][number];
