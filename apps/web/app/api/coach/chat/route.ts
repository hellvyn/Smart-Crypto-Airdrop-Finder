// POST /api/coach/chat  { threadId, message, kind: "chat" | "explain_step", stepId? }  ->  the Coach's answer, streamed
// as text/plain (spec §5.3, §6). Order: member, input (a seed phrase or private key is refused here), profile, thread,
// candidates (none: the empty-state copy, no coach_begin, no model), step, quota (coach_begin), the model;
// on the first text coach_mark_used runs before any of it is forwarded, so an aborted, truncated or timed-out answer
// still counts. The stream is cleaned per completed sentence (em dash, sensitive text) and the stored reply is redacted
// once more as a whole and cut to 16000 characters. Project links come as separate metadata (x-coach-links), built
// from the candidates' slugs, never from the model's text. Nothing here logs an email, a user id, a prompt or an answer.
import { askedProject, looksLikeSecret, selectCandidates, type Candidate, type UnfitReason } from "@saf/core";
import { streamText } from "@saf/llm";
import type { StreamTextEvent } from "@saf/llm";
import { getUser } from "@/lib/auth";
import {
  CHAT_DEADLINE_MS,
  CHAT_FIRST_TEXT_TIMEOUT_MS,
  MAX_MESSAGE_CHARS,
  candidateContext,
  candidateLinks,
  chatMessages,
  coachErrorFrom,
  coachErrorResponse,
  coachLlm,
  createStreamSanitizer,
  explainStepTurn,
  finalReply,
  getCoachProfile,
  loadCandidates,
  loadHistory,
  loadStep,
  loadThread,
  readJsonObject,
  remainingQuota,
  unauthorizedResponse,
} from "@/lib/coach";
import { coach } from "@/lib/copy";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Kind = "chat" | "explain_step";

/** The validated body, or null. `stepId` belongs to "explain_step" only. */
function parseBody(body: Record<string, unknown>): { threadId: string; message: string; kind: Kind; stepId: string | null } | null {
  const { threadId, message, kind, stepId } = body;
  if (!isUuid(threadId) || typeof message !== "string" || (kind !== "chat" && kind !== "explain_step")) return null;
  const text = message.trim();
  if (text === "" || text.length > MAX_MESSAGE_CHARS) return null;
  if (stepId === undefined || stepId === null) return { threadId, message: text, kind, stepId: null };
  if (kind !== "explain_step" || !isUuid(stepId)) return null;
  return { threadId, message: text, kind, stepId };
}

export async function POST(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const raw = await readJsonObject(request);
  const input = raw === null ? null : parseBody(raw);
  if (input === null) return coachErrorResponse("bad_input");
  // A seed phrase or a private key is never sent on: no database call, no model call, nothing stored.
  if (looksLikeSecret(input.message)) return coachErrorResponse("secret");

  try {
    const now = new Date();
    const db = await createServerClient();
    const profile = await getCoachProfile(db, user.id);
    const thread = await loadThread(db, input.threadId);
    if (!thread) return coachErrorResponse("not_member");
    // A plan thread needs the profile; "Tanya AI" about one project does not (owner 2026-10-11).
    if (!profile && !thread.projectId) return coachErrorResponse("bad_input");

    const all = await loadCandidates(db, now);
    // "Tanya AI": that one listed project, whatever the profile says. The profile never filters it out; a project that
    // does not fit it is still answered about, with the reason as context.
    let candidates: Candidate[] = [];
    let unfit: UnfitReason | null = null;
    if (thread.projectId) {
      const asked = askedProject(all, profile, thread.projectId);
      if (asked !== null) {
        candidates = [asked.candidate];
        unfit = asked.unfit;
      }
    } else if (profile) {
      candidates = selectCandidates(all, profile);
    }
    let turn = input.message;
    if (input.stepId !== null) {
      // The step must belong to a project this thread may talk about (one that passed curation).
      const step = await loadStep(db, input.stepId);
      if (step === null || !candidates.some((c) => c.id === step.projectId)) return coachErrorResponse("bad_input");
      turn = explainStepTurn(step.text, input.message);
    }
    // Nothing to talk about (a general thread the profile filters every project out of, or a project no longer listed):
    // the empty state, as a normal answer. No
    // coach_begin and no model call, so it costs no quota and no money.
    if (candidates.length === 0) {
      const remaining = await remainingQuota(db);
      const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
      if (remaining !== null) headers["X-Coach-Remaining"] = String(remaining);
      return new Response(coach.empty.noCandidates, { status: 200, headers });
    }
    const history = await loadHistory(db, input.threadId);

    const begin = await db.rpc("coach_begin", { p_thread_id: input.threadId, p_kind: input.kind, p_content: input.message });
    if (begin.error || typeof begin.data !== "string") return coachErrorResponse(coachErrorFrom(begin.error));
    const messageId = begin.data;
    const remaining = await remainingQuota(db);

    const llm = coachLlm();
    const own = new AbortController();
    const signal = AbortSignal.any([request.signal, own.signal]);
    const events = streamText(llm.chatModels, chatMessages(profile, candidates, now, history, turn, unfit), {
      providers: llm.providers,
      fetch: llm.fetch,
      claude: llm.claude,
      breaker: llm.breaker,
      signal,
      cache: true,
      firstTextTimeoutMs: CHAT_FIRST_TEXT_TIMEOUT_MS,
      deadlineMs: CHAT_DEADLINE_MS,
    })[Symbol.asyncIterator]();

    // Nothing is sent before the first text: a chain that fails outright is a plain 503, not a broken stream.
    const first = await events.next();
    const firstEvent: StreamTextEvent | undefined = first.done ? undefined : first.value;
    if (firstEvent === undefined || !("delta" in firstEvent)) {
      own.abort();
      return coachErrorResponse("unavailable");
    }
    // The model has started to answer: from here the message counts (coach_mark_used raises when its 2 minutes ran out).
    if (!(await markUsed(db, messageId))) {
      own.abort();
      await events.return?.(undefined).catch(() => undefined);
      return coachErrorResponse("unavailable");
    }

    const context = candidateContext(candidates, profile);
    const sanitizer = createStreamSanitizer(context);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let sent = "";
        const out = (text: string): void => {
          if (text === "") return;
          sent += text;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The reader went away; the abort signal ends the model call.
          }
        };
        const end = (action: () => void): void => {
          try {
            action();
          } catch {
            // Already closed by the reader.
          }
        };
        try {
          out(sanitizer.push(firstEvent.delta));
          for (;;) {
            const next = await events.next();
            if (next.done) break;
            const event = next.value;
            if ("delta" in event) {
              out(sanitizer.push(event.delta));
              continue;
            }
            if ("done" in event) {
              out(sanitizer.flush());
              const reply = finalReply(sent, context);
              if (reply.trim() !== "") {
                const d = event.done;
                // The member already has the whole answer and the message already counts (coach_mark_used), so a
                // failed save (an error result or a throw) only means the reply is missing from the history; the
                // stream still closes normally.
                try {
                  await db.rpc("coach_finish", {
                    p_user_message_id: messageId,
                    p_content: reply,
                    p_model: d.model,
                    p_in: d.inputTokens,
                    p_out: d.outputTokens,
                    p_cache_read: d.cacheReadTokens,
                    p_cache_write: d.cacheCreationTokens,
                  });
                } catch {
                  // See above.
                }
              }
              end(() => controller.close());
              return;
            }
            break; // failed
          }
        } catch {
          // Fall through: the answer did not complete.
        }
        // A cut-off answer is not stored (the message still counts). A reader that left just sees the end; any other
        // failure makes the stream fail, so the page can show the "unavailable" copy instead of a half answer.
        if (signal.aborted) end(() => controller.close());
        else end(() => controller.error(new Error("coach_stream_failed")));
      },
      cancel() {
        own.abort();
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Coach-Links": encodeURIComponent(JSON.stringify(candidateLinks(candidates))),
    };
    if (remaining !== null) headers["X-Coach-Remaining"] = String(remaining);
    return new Response(body, { status: 200, headers });
  } catch {
    return coachErrorResponse("unavailable");
  }
}

/** Whether `coach_mark_used` accepted the message. A raised error or a thrown one both mean no. */
async function markUsed(db: Awaited<ReturnType<typeof createServerClient>>, messageId: string): Promise<boolean> {
  try {
    const { error } = await db.rpc("coach_mark_used", { p_user_message_id: messageId });
    return !error;
  } catch {
    return false;
  }
}
