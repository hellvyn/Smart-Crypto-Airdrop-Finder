// AI Analyst (curation spec §13 A1 and A6): verdict, effort estimate and Indonesian steps for one project. This module
// holds the answer contract and its post-processing; the prompt lives in the pipeline.
import { z } from "zod";
import { quoteInSource } from "../schema/extraction.js";
import { replaceEmDash } from "./ai-style.js";

const VERDICTS = ["garap", "pantau", "skip"] as const;
const CONFIDENCES = ["tinggi", "sedang", "rendah"] as const;
const CADENCES = ["once", "daily", "weekly"] as const;

const pointSchema = z.object({
  /** Indonesian statement. */
  text: z.string().min(1),
  /** Exact words of the source at `source_url`. */
  quote: z.string(),
  source_url: z.string(),
});

/**
 * The Analyst answer, stored (after `postProcessAnalyst`) as `ai_analyses.result` of kind `analyst`. Every text is
 * Indonesian; the enum values are Indonesian on purpose, so an English answer fails and the next model is tried.
 */
export const analystSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.enum(CONFIDENCES),
  points: z.array(pointSchema).min(1).max(5),
  effort: z.object({
    minutes_per_day: z.number().nonnegative().nullable(),
    capital_usd_min: z.number().nonnegative().nullable(),
    note: z.string(),
  }),
  /** The project's steps translated or summarized in Indonesian, one per step, in step order. */
  steps_id: z.array(z.object({ text: z.string().min(1), cadence: z.enum(CADENCES) })),
});

export type AnalystAnswer = z.infer<typeof analystSchema>;

/**
 * A stored Analyst result (`ai_analyses.result` of kind `analyst`), for display. The same contract as `analystSchema`
 * except that `points` may be empty: `postProcessAnalyst` drops every point whose quote is not in its source, and a
 * result can be left with none. The answer schema keeps requiring a point, so a model answer without one is refused.
 */
export const storedAnalystSchema = analystSchema.extend({ points: z.array(pointSchema).max(5) });

export type StoredAnalyst = z.infer<typeof storedAnalystSchema>;
export type AnalystVerdict = AnalystAnswer["verdict"];

const HOST_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const HANDLE_RE = /@[a-z0-9_]{2,}/gi;
const ADDRESS_RE = /\b0x[0-9a-fA-F]{6,}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const SECRET_TERM_RE = /seed phrase|recovery phrase|secret phrase|mnemonic|private key|kunci (?:privat|pribadi|rahasia)|frasa (?:seed|pemulihan|rahasia)/i;
const PAYMENT_TERM_RE = /\b(?:send|transfer|pay|deposit|kirim|bayar|setor)/i;

/** A number as its digits only, so "0.01" and "0,01" or "1,000" and "1.000" compare equal. */
const digitsOf = (n: string): string => n.replace(/\D/g, "");

/**
 * The hosts, `@handles` and addresses in `text`, normalised for exact comparison: hosts, handles and `0x` addresses
 * lowercased (they are case-insensitive), base58 addresses untouched (case-sensitive: a case change names another
 * address). Each token is prefixed with its kind so one kind never grounds another.
 */
function tokensOf(text: string): string[] {
  const hosts = (text.match(HOST_RE) ?? []).map((h) => `host:${h.toLowerCase()}`);
  const handles = (text.match(HANDLE_RE) ?? []).map((h) => `handle:${h.toLowerCase()}`);
  const addresses = (text.match(ADDRESS_RE) ?? []).map((a) => `addr:${a.startsWith("0x") ? a.toLowerCase() : a}`);
  return [...hosts, ...handles, ...addresses];
}

/**
 * Whether an AI translation of one step adds nothing the step does not say that could send a reader somewhere or make
 * them pay or give away a secret (curation spec §13: source text is data, the AI never adds trust). Every host or URL,
 * `@handle`, `0x`/base58 address and number in `translation` must be one of those the same patterns find in `step`
 * (whole tokens, not substrings; `0x` addresses, hosts and handles ignoring case, base58 addresses exact; numbers
 * compared by digits), and a secret term (seed phrase, private key, kunci privat, ...) or a payment verb (send, pay,
 * kirim, bayar, ...) may appear only when the step has one too. Built for refusal: a reworded but harmless
 * translation can be refused, never the other way round.
 */
export function stepTranslationGrounded(step: string, translation: string): boolean {
  const stepTokens = new Set(tokensOf(step));
  if (tokensOf(translation).some((token) => !stepTokens.has(token))) return false;
  const stepNumbers = new Set((step.match(NUMBER_RE) ?? []).map(digitsOf));
  if ((translation.match(NUMBER_RE) ?? []).some((n) => !stepNumbers.has(digitsOf(n)))) return false;
  for (const term of [SECRET_TERM_RE, PAYMENT_TERM_RE]) {
    if (term.test(translation) && !term.test(step)) return false;
  }
  return true;
}

/**
 * Makes a schema-valid answer safe to store:
 * - a point is kept only when its `quote` passes `quoteInSource` against the text of the source its `source_url`
 *   names; when no point is left, the verdict becomes `pantau` with confidence `rendah`, since nothing backs it;
 * - em dashes in the Indonesian texts (points, effort note, steps; never quotes) become ", ".
 * Forbidden words are left in place (they are counted, not removed).
 */
export function postProcessAnalyst(value: AnalystAnswer, sources: { url: string; text: string }[]): AnalystAnswer {
  const supported = (p: AnalystAnswer["points"][number]): boolean =>
    sources.some((s) => s.url === p.source_url && quoteInSource(p.quote, s.text));
  const points = value.points.filter(supported).map((p) => ({ ...p, text: replaceEmDash(p.text) }));
  const unsupported = points.length === 0;
  return {
    verdict: unsupported ? "pantau" : value.verdict,
    confidence: unsupported ? "rendah" : value.confidence,
    points,
    effort: { ...value.effort, note: replaceEmDash(value.effort.note) },
    steps_id: value.steps_id.map((s) => ({ ...s, text: replaceEmDash(s.text) })),
  };
}
