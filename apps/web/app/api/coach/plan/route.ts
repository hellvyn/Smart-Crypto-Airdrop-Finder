// POST /api/coach/plan  {}  ->  the Coach's farming plan for the signed-in member (spec §5.2, §6, §9).
// Order: member, profile, candidates (none: an empty state, no RPC, no model, no quota), quota left (0: 429), new thread, quota (coach_begin),
// the model, "used" mark as soon as it answers, validation, save, reply. Signed-out callers get a JSON 401.
// Nothing here logs an email, a user id, a prompt or an answer.
import { coachPlanAnswerSchema, selectCandidates, validatePlan } from "@saf/core";
import type { Candidate } from "@saf/core";
import { callStructured } from "@saf/llm";
import { getUser } from "@/lib/auth";
import {
  MAX_REPLY_CHARS,
  PLAN_BUDGET_MS,
  chatWithDeadline,
  coachErrorFrom,
  coachErrorResponse,
  coachJson,
  coachLlm,
  getCoachProfile,
  loadCandidates,
  planMessages,
  readJsonObject,
  remainingQuota,
  sleep,
  unauthorizedResponse,
} from "@/lib/coach";
import { coach } from "@/lib/copy";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The validated recommendations with each project's name and slug, so the page can draw the card and link it. */
function enrich(recommendations: ReturnType<typeof validatePlan>["recommendations"], candidates: Candidate[]) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return recommendations.map((r) => {
    const c = byId.get(r.project_id)!;
    return { ...r, slug: c.slug, name: c.name };
  });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  if ((await readJsonObject(request)) === null) return coachErrorResponse("bad_input");

  try {
    const now = new Date();
    const db = await createServerClient();
    const profile = await getCoachProfile(db, user.id);
    if (!profile) return coachErrorResponse("bad_input");

    const candidates = selectCandidates(await loadCandidates(db, now), profile);
    if (candidates.length === 0) {
      return coachJson(
        { state: "no_candidates", threadId: null, recommendations: [], remaining: await remainingQuota(db), message: coach.empty.noCandidates },
        200,
      );
    }

    // No message left today: say so before a thread is created that could never get a plan.
    if ((await remainingQuota(db)) === 0) return coachErrorResponse("quota");

    const thread = await db.rpc("coach_new_thread", { p_project_id: null });
    if (thread.error || typeof thread.data !== "string") return coachErrorResponse(coachErrorFrom(thread.error));
    const threadId = thread.data;
    const begin = await db.rpc("coach_begin", { p_thread_id: threadId, p_kind: "plan", p_content: coach.planRequest });
    if (begin.error || typeof begin.data !== "string") return coachErrorResponse(coachErrorFrom(begin.error));
    const messageId = begin.data;

    const llm = coachLlm();
    const started = Date.now();
    // callStructured has no cache option, so the plan request goes without prompt caching (only the chat is cached).
    const outcome = await callStructured(planMessages(profile, candidates, now), coachPlanAnswerSchema, llm.planModels, {
      chat: chatWithDeadline(llm.chat, started + PLAN_BUDGET_MS),
      sleep,
      breaker: llm.breaker,
      shouldStop: () => Date.now() - started > PLAN_BUDGET_MS || request.signal.aborted,
    });
    if (!outcome.ok) return coachErrorResponse("unavailable");

    // The model has answered: from here the message counts, whatever validation leaves (spec §4.4, Task 3 re-review).
    const used = await db.rpc("coach_mark_used", { p_user_message_id: messageId });
    if (used.error) return coachErrorResponse("unavailable");

    const { recommendations } = validatePlan(outcome.value, candidates, profile);
    if (recommendations.length === 0) {
      return coachJson(
        { state: "no_plan", threadId, recommendations: [], remaining: await remainingQuota(db), message: coach.empty.noPlan },
        200,
      );
    }

    const plan = enrich(recommendations, candidates);
    const saved = await db.rpc("coach_save_plan", { p_thread_id: threadId, p_plan: { recommendations: plan } });
    if (saved.error) return coachErrorResponse("unavailable");

    // The stored reply is a short line; the plan itself lives on the thread. The token counts are unknown here:
    // callStructured does not report usage. A failure of this last bookkeeping call does not take the plan away.
    const summary = `Rencana: ${plan.map((p) => p.name).join(", ")}`.slice(0, MAX_REPLY_CHARS);
    await db.rpc("coach_finish", {
      p_user_message_id: messageId,
      p_content: summary,
      p_model: outcome.model,
      p_in: null,
      p_out: null,
      p_cache_read: null,
      p_cache_write: null,
    });

    return coachJson({ threadId, recommendations: plan, remaining: await remainingQuota(db) }, 200);
  } catch {
    return coachErrorResponse("unavailable");
  }
}
