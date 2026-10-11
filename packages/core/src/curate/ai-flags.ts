// AI Scam Analyst and contradiction detection (curation spec §13 A2 and A3): the answer contracts, their
// post-processing, and the risk input taken from the stored results. The prompts live in the pipeline.
// Both can only add risk reasons (`assessRisk`); neither ever removes a warning or makes a project pass.
import { z } from "zod";
import type { RiskInput } from "../risk/assess.js";
import { quoteInSource } from "../schema/extraction.js";
import { replaceEmDash } from "./ai-style.js";

/** Social-engineering patterns the Scam Analyst flags. */
export const SCAM_PATTERNS = [
  "urgency",
  "connect_wallet_to_check",
  "fake_support",
  "secret_request",
  "payment_request",
  "impersonation",
  "other",
] as const;

/**
 * The Scam Analyst answer, stored (after `postProcessScam`) as `ai_analyses.result` of kind `scam` (member-only, #54).
 * `quote` copies the source exactly; `explanation` is Indonesian.
 */
export const scamSchema = z.object({
  flags: z.array(z.object({ pattern: z.enum(SCAM_PATTERNS), quote: z.string(), explanation: z.string() })),
});

export type ScamAnswer = z.infer<typeof scamSchema>;

/**
 * The contradiction answer, stored (after `postProcessContradictions`) as `ai_analyses.result` of kind
 * `contradictions` (public). Each item names two quotes and the sources they come from; the two may be the same
 * source (e.g. a label that disagrees with the text). `topic` and `explanation` are Indonesian.
 */
export const contradictionsSchema = z.object({
  items: z.array(
    z.object({
      topic: z.string(),
      quote_a: z.string(),
      url_a: z.string(),
      quote_b: z.string(),
      url_b: z.string(),
      explanation: z.string(),
    }),
  ),
});

export type ContradictionsAnswer = z.infer<typeof contradictionsSchema>;

type Source = { url: string; text: string };

/** Keeps the flags whose quote passes `quoteInSource` against any source; em dashes in explanations become ", ". */
export function postProcessScam(value: ScamAnswer, sources: Source[]): ScamAnswer {
  return {
    flags: value.flags
      .filter((f) => sources.some((s) => quoteInSource(f.quote, s.text)))
      .map((f) => ({ ...f, explanation: replaceEmDash(f.explanation) })),
  };
}

/**
 * Keeps a contradiction only when each quote passes `quoteInSource` against the source its url names, and the two
 * sides are not the same quote of the same source. Em dashes in topic and explanation (never quotes) become ", ".
 */
export function postProcessContradictions(value: ContradictionsAnswer, sources: Source[]): ContradictionsAnswer {
  const quoted = (quote: string, url: string): boolean => sources.some((s) => s.url === url && quoteInSource(quote, s.text));
  // Compared the way `quoteInSource` matches: whitespace runs collapsed, any case.
  const same = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
  const sameSide = (i: ContradictionsAnswer["items"][number]): boolean => i.url_a === i.url_b && same(i.quote_a, i.quote_b);
  return {
    items: value.items
      .filter((i) => quoted(i.quote_a, i.url_a) && quoted(i.quote_b, i.url_b) && !sameSide(i))
      .map((i) => ({ ...i, topic: replaceEmDash(i.topic), explanation: replaceEmDash(i.explanation) })),
  };
}

/**
 * `RiskInput.aiFlags` from the latest stored results of kind `scam` and `contradictions` (null when there is none).
 * The stored results are already post-processed, so every flag's quote passed `quoteInSource`. A result that does not
 * match its schema counts as missing: scam `null` (the AI review did not run), contradictions 0. Undefined when
 * neither analysis exists.
 */
export function aiFlagsFromAnalyses(scam: unknown, contradictions: unknown): RiskInput["aiFlags"] {
  if (scam == null && contradictions == null) return undefined;
  const scamParsed = scamSchema.safeParse(scam);
  const contradictionsParsed = contradictionsSchema.safeParse(contradictions);
  return {
    scam: scamParsed.success ? scamParsed.data.flags.map((f) => ({ pattern: f.pattern, quote: f.quote })) : null,
    contradictions: contradictionsParsed.success ? contradictionsParsed.data.items.length : 0,
  };
}
