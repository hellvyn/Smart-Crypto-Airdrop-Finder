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
const CADENCES = ["once", "daily", "weekly"] as const;
const KEY_PARAMETER_NAMES = ["allocation", "distribution", "tge"] as const;
const SOURCE_RATING_NAMES = ["difficulty", "cost"] as const;
const CAPITAL_LEVELS = ["none", "low", "high", "unknown"] as const;

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

const calendarDate = z
  .string()
  .refine(isRealCalendarDate, { message: "date must be a real calendar date in YYYY-MM-DD format" });

const deadlineSchema = z.object({
  kind: z.enum(DEADLINE_KINDS),
  date: calendarDate.nullable(),
  precision: z.enum(PRECISIONS),
  text: z.string(),
});

const stepSchema = z.object({ text: z.string(), cadence: z.enum(CADENCES) });
const keyParameterSchema = z.object({ name: z.enum(KEY_PARAMETER_NAMES), value: z.string(), quote: z.string() });
const sourceRatingSchema = z.object({ name: z.enum(SOURCE_RATING_NAMES), value: z.string(), quote: z.string() });
const latestUpdateSchema = z.object({ text: z.string(), date: calendarDate.nullable() });
const claimedBackerSchema = z.object({ investor: z.string(), quote: z.string() });

/** Wraps a `.default(...)` schema so an explicit `null` (what the prompt asks for unstated fields) parses to the default. */
function nullAsDefault<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => value ?? undefined, schema);
}

const projectSchema = z.object({
  name: z.string().min(1),
  token_symbol: z.string().nullable(),
  chains: z.array(z.string()),
  status: z.enum(STATUSES),
  status_evidence: z.string(),
  /** Flat task list kept for compatibility; filled from `steps` after extraction when the model leaves it empty. */
  tasks: nullAsDefault(z.array(z.string()).default([])),
  deadlines: z.array(deadlineSchema),
  official_urls: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  // v3 fields (spec §4.6). Optional in the model answer, so a v2-shaped answer still validates; an explicit
  // `null` also falls back to the default, since the prompt tells the model to answer `null` or `[]` when unstated.
  steps: nullAsDefault(z.array(stepSchema).default([])),
  key_parameters: nullAsDefault(z.array(keyParameterSchema).default([])),
  source_ratings: nullAsDefault(z.array(sourceRatingSchema).default([])),
  latest_update: nullAsDefault(latestUpdateSchema.nullable().default(null)),
  claimed_backers: nullAsDefault(z.array(claimedBackerSchema).default([])),
  capital_required: nullAsDefault(z.enum(CAPITAL_LEVELS).default("unknown")),
  /** Minimum deposit in USD as stated by the text; never converted from other tokens (spec #52). */
  capital_min_usd: nullAsDefault(z.number().positive().nullable().default(null)),
});

/** LLM extraction output contract (spec §4.3, §4.6). Unknown extra keys are stripped. */
export const extractionSchema = z.object({
  is_airdrop_content: z.boolean(),
  projects: z.array(projectSchema),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
export type ExtractedDeadline = ExtractionResult["projects"][number]["deadlines"][number];

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * True when `quote` occurs in `text` after both have their whitespace runs collapsed to one space and are
 * lowercased. An empty or whitespace-only quote never matches.
 */
export function quoteInSource(quote: string, text: string): boolean {
  const needle = collapse(quote);
  return needle !== "" && collapse(text).includes(needle);
}
