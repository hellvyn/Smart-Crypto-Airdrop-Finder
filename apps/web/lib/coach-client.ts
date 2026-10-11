// Browser side of the Coach routes (spec §5.2, §5.3, §5.7): the plan request and the streamed chat answer. It only
// uses `fetch` and the copy, so the components and Vitest can run it. Error texts come from the routes' own JSON
// (`{ error, message }`); a broken stream or a network failure becomes the "unavailable" copy.
import { parseLinksHeader, type CoachLink } from "./coach-text";
import { coach } from "./copy";

export interface PlanRecommendation {
  project_id: string;
  slug: string;
  name: string;
  reasons: { text: string; quote: string }[];
  minutes_per_day: number;
  capital_note: string;
}

export type PlanOutcome =
  | { ok: true; threadId: string; recommendations: PlanRecommendation[]; remaining: number | null }
  /** The server had nothing to plan (no candidate, or no valid plan): an honest message, and no chat. */
  | { ok: true; threadId: null; recommendations: []; remaining: number | null; message: string }
  | { ok: false; message: string; quota: boolean; code: string };

export type ChatBody = { threadId: string; message: string; kind: "chat" | "explain_step"; stepId?: string };

export type ChatOutcome =
  | { ok: true; text: string; remaining: number | null; links: CoachLink[] }
  /** `code` is the route's error (`quota`, `bad_input`, `not_member`, `unavailable`, `unauthorized`). */
  | { ok: false; message: string; quota: boolean; code: string };

const unavailable = { ok: false, message: coach.errors.unavailable, quota: false, code: "unavailable" } as const;

type Fetch = typeof fetch;

/** The `{ error, message }` of a refused request. */
async function failure(response: Response): Promise<{ ok: false; message: string; quota: boolean; code: string }> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const quota = body.error === "quota";
    const code = typeof body.error === "string" ? body.error : "unavailable";
    if (typeof body.message === "string" && body.message !== "") return { ok: false, message: body.message, quota, code };
    return { ok: false, message: quota ? coach.errors.quota : coach.errors.unavailable, quota, code };
  } catch {
    return unavailable;
  }
}

function remainingOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Asks the Coach for a plan from the member's saved profile. */
export async function requestPlan(fetchFn: Fetch = fetch): Promise<PlanOutcome> {
  try {
    const response = await fetchFn("/api/coach/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return await failure(response);
    const body = (await response.json()) as {
      threadId?: unknown;
      recommendations?: unknown;
      remaining?: unknown;
      message?: unknown;
    };
    const remaining = remainingOf(body.remaining);
    const recommendations = Array.isArray(body.recommendations) ? (body.recommendations as PlanRecommendation[]) : [];
    if (typeof body.threadId !== "string" || recommendations.length === 0) {
      return {
        ok: true,
        threadId: null,
        recommendations: [],
        remaining,
        message: typeof body.message === "string" ? body.message : coach.empty.noPlan,
      };
    }
    return { ok: true, threadId: body.threadId, recommendations, remaining };
  } catch {
    return unavailable;
  }
}

/**
 * Sends a chat or explain-step message and reads the answer as it streams. `onText` gets the whole answer so far
 * after every piece. A stream that breaks half way is an error, not a short answer.
 */
export async function streamCoachChat(
  body: ChatBody,
  onText: (textSoFar: string) => void,
  fetchFn: Fetch = fetch,
): Promise<ChatOutcome> {
  try {
    const response = await fetchFn("/api/coach/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return await failure(response);
    const remainingHeader = response.headers.get("X-Coach-Remaining");
    const remaining = remainingHeader === null ? null : remainingOf(Number(remainingHeader));
    const links = parseLinksHeader(response.headers.get("X-Coach-Links"));
    if (!response.body) return unavailable;

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      onText(text);
    }
    text += decoder.decode();
    onText(text);
    return text.trim() === "" ? unavailable : { ok: true, text, remaining, links };
  } catch {
    return unavailable;
  }
}
