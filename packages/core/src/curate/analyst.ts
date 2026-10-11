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
export type AnalystVerdict = AnalystAnswer["verdict"];

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
