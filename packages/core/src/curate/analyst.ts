// AI Analyst (curation spec §13 A1 and A6): verdict, effort estimate and Indonesian steps for one project. This module
// holds the answer contract and its post-processing; the prompt lives in the pipeline.
import { z } from "zod";
import { groundedAgainst } from "../coach/guard.js";
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

/**
 * Whether an AI translation of one step adds nothing the step does not say that could send a reader somewhere or make
 * them pay or give away a secret (curation spec §13: source text is data, the AI never adds trust). The rule is
 * `groundedAgainst` with the step as the context: see there for the tokens it compares. Built for refusal: a reworded
 * but harmless translation can be refused, never the other way round.
 */
export function stepTranslationGrounded(step: string, translation: string): boolean {
  return groundedAgainst(translation, step);
}

/**
 * Makes a schema-valid answer safe to store:
 * - a point is kept only when its `quote` passes `quoteInSource` against the text of the source its `source_url`
 *   names; when no point is left, the verdict becomes `pantau` with confidence `rendah`, since nothing backs it;
 * - em dashes in the Indonesian texts (points, effort note, steps; never quotes) become ", ";
 * - `steps_id` is kept only when it lines up with the project's `steps` (same count, same cadence at every position)
 *   and every translation passes `stepTranslationGrounded` against its step; otherwise it is stored empty. One
 *   ungrounded translation drops the whole set, so a prompt injection in a source never reaches a reader through the
 *   stored result (G5 C1), the same rule the `tasks.text_id` write follows.
 * Forbidden words are left in place (they are counted, not removed).
 */
export function postProcessAnalyst(
  value: AnalystAnswer,
  sources: { url: string; text: string }[],
  steps: readonly { text: string; cadence: string }[],
): AnalystAnswer {
  const supported = (p: AnalystAnswer["points"][number]): boolean =>
    sources.some((s) => s.url === p.source_url && quoteInSource(p.quote, s.text));
  const points = value.points.filter(supported).map((p) => ({ ...p, text: replaceEmDash(p.text) }));
  const unsupported = points.length === 0;
  const translations = value.steps_id.map((s) => ({ ...s, text: replaceEmDash(s.text) }));
  const usable =
    translations.length === steps.length &&
    translations.every((s, i) => s.cadence === steps[i]!.cadence && stepTranslationGrounded(steps[i]!.text, s.text));
  return {
    verdict: unsupported ? "pantau" : value.verdict,
    confidence: unsupported ? "rendah" : value.confidence,
    points,
    effort: { ...value.effort, note: replaceEmDash(value.effort.note) },
    steps_id: usable ? translations : [],
  };
}
