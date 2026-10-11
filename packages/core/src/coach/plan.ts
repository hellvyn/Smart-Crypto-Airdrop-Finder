// Coach plan (coach and briefing spec §5.2 and §6): the answer contract the model must meet, and the server-side
// validation that decides what of it reaches the member. The model only picks and explains; nothing it writes is
// trusted until `validatePlan` has checked it against the candidates this member was given.
import { z } from "zod";
import { cleanStyle } from "../style.js";
import { quoteInSource } from "../schema/extraction.js";
import type { Candidate } from "./candidates.js";
import { groundedAgainst } from "./guard.js";
import type { CoachProfile } from "./profile.js";

/** The most recommendations a plan shows. */
export const MAX_RECOMMENDATIONS = 5;

const reasonSchema = z.object({
  /** Indonesian, in the model's own words. Judged by `groundedAgainst`. */
  text: z.string().min(1).max(400),
  /** Exact words of the candidate's points or steps. Judged by `quoteInSource`. */
  quote: z.string().min(8).max(600),
});

const recommendationSchema = z.object({
  project_id: z.string().min(1),
  reasons: z.array(reasonSchema).min(1).max(3),
  minutes_per_day: z.number().int().min(1).max(240),
  /** One line on the capital this project needs for this member. Replaced by `serverCapitalNote` when not grounded. */
  capital_note: z.string().min(1).max(300),
});

/** The plan the model answers with: 3 to 5 recommendations, best first. */
export const coachPlanAnswerSchema = z.object({
  recommendations: z.array(recommendationSchema).min(3).max(MAX_RECOMMENDATIONS),
});

export type CoachPlanAnswer = z.infer<typeof coachPlanAnswerSchema>;

/** One recommendation that passed validation; same shape as the answer's, with style cleaned. */
export type ValidPlanItem = CoachPlanAnswer["recommendations"][number];

/** The texts of a candidate a quote may come from. */
function quotableTexts(candidate: Candidate): string[] {
  return [...candidate.points.flatMap((p) => [p.text, p.quote]), ...candidate.steps.map((s) => s.text)];
}

/**
 * What free text about `candidate` may repeat: its name, chains, points, steps and the figures the member was shown
 * (the word deposit for a Butuh $ project, minimum deposit, minutes per day, deadline), plus the member's own minutes budget. Source URLs are left out, so a
 * reason cannot send the reader to a host the member never saw in the plan.
 */
function contextOf(candidate: Candidate, profile: CoachProfile): string {
  return [
    candidate.name,
    candidate.chains.join(" "),
    ...quotableTexts(candidate),
    // A candidate tagged "Butuh $" may be described as needing a deposit; the guard would refuse the word otherwise.
    candidate.capital === "deposit" ? "Butuh deposit" : "",
    candidate.capitalMinUsd === null ? "" : String(candidate.capitalMinUsd),
    candidate.minutesPerDay === null ? "" : String(candidate.minutesPerDay),
    candidate.nextDeadline ?? "",
    String(profile.minutes_per_day),
  ].join("\n");
}

/**
 * Keeps of `answer` what is safe to show `profile`'s member. A recommendation is dropped when:
 * - its `project_id` is not one of `candidates` (this member's list, not any listed project), or repeats an earlier one;
 * - none of its reasons survives: a reason goes when its quote is not found by `quoteInSource` in that candidate's
 *   points or steps, or when its text fails `groundedAgainst` the candidate's context.
 * A capital note that fails `groundedAgainst` does not drop the item: it is replaced by `serverCapitalNote`, written from
 * the candidate's own capital tag. Em dashes in the texts become commas (`cleanStyle`; quotes stay verbatim). The plan
 * is then cut to 5, and the minute budget keeps recommendations in order, skipping any that would take the total past
 * the profile's `minutes_per_day`. `dropped` counts the recommendations that did not make it, whatever the reason.
 */
export function validatePlan(
  answer: CoachPlanAnswer,
  candidates: Candidate[],
  profile: CoachProfile,
): { recommendations: ValidPlanItem[]; dropped: number } {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const kept: ValidPlanItem[] = [];

  for (const rec of answer.recommendations) {
    const candidate = byId.get(rec.project_id);
    if (candidate === undefined || seen.has(rec.project_id)) continue;
    const context = contextOf(candidate, profile);
    const sources = quotableTexts(candidate);
    const reasons = rec.reasons
      .filter((r) => sources.some((source) => quoteInSource(r.quote, source)) && groundedAgainst(r.text, context))
      .map((r) => ({ text: cleanStyle(r.text), quote: r.quote }));
    if (reasons.length === 0) continue;
    seen.add(rec.project_id);
    kept.push({
      project_id: rec.project_id,
      reasons,
      minutes_per_day: rec.minutes_per_day,
      capital_note: groundedAgainst(rec.capital_note, context)
        ? cleanStyle(rec.capital_note)
        : serverCapitalNote(candidate),
    });
  }

  const recommendations: ValidPlanItem[] = [];
  let minutes = 0;
  for (const rec of kept.slice(0, MAX_RECOMMENDATIONS)) {
    if (minutes + rec.minutes_per_day > profile.minutes_per_day) continue;
    minutes += rec.minutes_per_day;
    recommendations.push(rec);
  }
  return { recommendations, dropped: answer.recommendations.length - recommendations.length };
}

/** The capital note the server writes from `candidate`'s capital tag, used when the model's note is not grounded. */
export function serverCapitalNote(candidate: Candidate): string {
  if (candidate.capital === "free") return "Gratis, mungkin tetap butuh sedikit gas kalau di mainnet.";
  if (candidate.capital === "deposit") {
    return candidate.capitalMinUsd === null
      ? "Butuh deposit, minimumnya belum disebut."
      : `Butuh deposit minimal $${candidate.capitalMinUsd}.`;
  }
  return "Modal belum jelas, cek sumbernya.";
}
