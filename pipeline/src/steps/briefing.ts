import { briefingAnswerSchema, briefingBanned, briefingInputs, fallbackBriefing, validateBriefing } from "@saf/core";
import type { BriefingChange, BriefingFact, BriefingItem } from "@saf/core";
import { callStructured, createCircuitBreaker } from "@saf/llm";
import type { ChatFn } from "@saf/llm";
import type { PipelineConfig } from "../config.js";
import { buildBriefingMessages, buildBriefingRewrite } from "../llm/prompts/briefing.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo } from "../store/repo.js";
import { CIRCUIT_BREAKER_THRESHOLD } from "./extract.js";

const DAY_MS = 86_400_000;
/** WIB is UTC+7 all year: the briefing's day is the WIB date, the day the members read it. */
const WIB_OFFSET_MS = 7 * 3_600_000;
/** The most facts sent to the model: enough for a busy day, small enough to stay cheap. */
const MAX_FACTS = 40;

export interface BriefingDeps {
  repo: PipelineRepo;
  chat: ChatFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The most the briefing may spend asking models (the whole chain, both calls). The daily job has a 60-minute limit and
 * has used 53 minutes before, so a hanging endpoint must not push logos and purge out of the run.
 */
export const BRIEFING_BUDGET_MS = 3 * 60_000;

/** `chat` cut off at `deadline` (ms on `now`): a request still running then counts as a failed attempt. */
function chatUntil(chat: ChatFn, now: () => Date, deadline: number): ChatFn {
  const failed = { content: "", finishReason: null, latencyMs: 0, httpStatus: 0, servedModel: null };
  return async (model, messages) => {
    const left = deadline - now().getTime();
    if (left <= 0) return failed;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof failed>((resolve) => {
      timer = setTimeout(() => resolve({ ...failed, latencyMs: left }), left);
    });
    try {
      return await Promise.race([chat(model, messages), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The daily briefing (coach and briefing spec §4.3, §6): the changes of the last 24 hours and the claim, snapshot and
 * campaign_end deadlines of the next 48 hours, for projects on the list, as facts; one model call turns them into at
 * most 5 points that `validateBriefing` checks. A banned word gets one rewrite, then the version without the AI.
 * Every model failing, or no point surviving, also gives that version.
 *
 * No facts: no call and nothing saved, so yesterday's briefing stays (the web shows the latest with its date).
 * Stats: `briefing_items` and `briefing_ai`. Neither the facts, the prompt nor the answer is logged.
 */
export async function runBriefing(deps: BriefingDeps, config: PipelineConfig, stats: DailyStats): Promise<void> {
  const { repo } = deps;
  const now = deps.now();

  // The briefing is for today in WIB (the run starts 06:00 WIB): deadlines from today WIB to two days after it.
  const day = utcDay(new Date(now.getTime() + WIB_OFFSET_MS));
  const changes = await repo.listBriefingChanges(new Date(now.getTime() - DAY_MS));
  const deadlines = await repo.listBriefingDeadlines(day, utcDay(new Date(Date.parse(day) + 2 * DAY_MS)));
  const listed = new Set(await repo.listListedProjects([...changes, ...deadlines].map((r) => r.projectId)));

  const isChange = (c: BriefingChange): boolean => listed.has(c.projectId) && c.field !== "curated";
  const curated = changes.filter((c) => listed.has(c.projectId) && c.field === "curated" && c.newValue === "true");
  const facts = briefingInputs(
    changes.filter(isChange),
    deadlines.filter((d) => listed.has(d.projectId)),
    curated,
  ).slice(0, MAX_FACTS);
  if (facts.length === 0) return;

  const { items, model } = await writeBriefing(deps, config, facts);
  await repo.saveBriefing(day, items, model, model !== null);
  stats.briefing_items = items.length;
  stats.briefing_ai = model === null ? 0 : 1;
}

/** The model's items and the model that wrote them, or the version without the AI (`model` null). */
async function writeBriefing(
  deps: BriefingDeps,
  config: PipelineConfig,
  facts: BriefingFact[],
): Promise<{ items: BriefingItem[]; model: string | null }> {
  const fallback = { items: fallbackBriefing(facts), model: null };
  const breaker = createCircuitBreaker(CIRCUIT_BREAKER_THRESHOLD);
  const deadline = deps.now().getTime() + BRIEFING_BUDGET_MS;
  const chat = chatUntil(deps.chat, deps.now, deadline);
  const ask = (messages: ReturnType<typeof buildBriefingMessages>) =>
    callStructured(messages, briefingAnswerSchema, config.analyzeModels, {
      chat,
      sleep: deps.sleep,
      breaker,
      shouldStop: () => deps.now().getTime() >= deadline,
    });

  const messages = buildBriefingMessages(facts);
  let outcome = await ask(messages);
  if (!outcome.ok) return fallback;
  const banned = briefingBanned(outcome.value);
  if (banned.length > 0) {
    // One rewrite; a banned word again means the version without the AI.
    outcome = await ask(buildBriefingRewrite(messages, outcome.value, banned));
    if (!outcome.ok || briefingBanned(outcome.value).length > 0) return fallback;
  }
  const items = validateBriefing(outcome.value, facts);
  return items.length === 0 ? fallback : { items, model: outcome.model };
}
