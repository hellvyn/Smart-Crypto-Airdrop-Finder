// Coach samples and capacity check (plan 9, task 10; gates G13 and G14).
//
//   pnpm --filter web coach-samples --candidates <candidates.json> [--out <dir>] [--only <case id>] [--dry-run]
//
// Generates the 20 fixed Coach answers (6 plans, 14 chat or explain-step requests) through the SAME code the routes
// use: `selectCandidates`, `planMessages` / `chatMessages`, `callStructured` / `streamText` over the Coach chain,
// `validatePlan`, the stream sanitizer and `finalReply` (apps/web/lib/coach.ts and @saf/core). Only the database is
// replaced: candidates come from a JSON file (an array shaped like @saf/core's `Candidate`), so no DB access is needed.
// The real provider chain runs only when `ANTHROPIC_API_KEY`, `LLM_API_KEY` or `NVIDIA_API_KEY` is set; otherwise the
// script says so and exits 0. It writes a JSON and a Markdown file into `--out` (default `apps/web/scripts/out/`,
// gitignored) and prints count, failures and p50/p95 latency per model. No email, user id or wallet address is ever
// read, printed or written: the profiles are fixed and made up, and the output goes through `scrub`.
//
// Modes: `--mode coach` (default). Another generator (the Briefing samples) plugs in by adding an entry to `MODES`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coachPlanAnswerSchema, selectCandidates, validatePlan } from "@saf/core";
import type { Candidate } from "@saf/core";
import { callStructured, loadProviders, streamText } from "@saf/llm";
import {
  PLAN_BUDGET_MS,
  candidateContext,
  chatMessages,
  chatWithDeadline,
  coachLlm,
  createStreamSanitizer,
  explainStepTurn,
  finalReply,
  planMessages,
  sleep,
} from "../lib/coach";
import { coach } from "../lib/copy";
import { COACH_PROFILES, SAMPLE_CASES } from "./coach-samples-cases";
import type { SampleCaseDef } from "./coach-samples-cases";
import { renderMarkdown, renderPlan, scrub, summarize } from "./coach-samples-lib";
import type { SampleResult, Summary } from "./coach-samples-lib";

/** The routes' `maxDuration`: a chat answer that is not done in this time is a failure, as it is for a member. */
const CHAT_BUDGET_MS = 60_000;
const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "out");

const USAGE = `Usage: pnpm --filter web coach-samples --candidates <candidates.json> [options]

  --candidates <path>  JSON array of candidates shaped like @saf/core's Candidate (required to generate)
  --out <dir>          where the .json and .md files go (default apps/web/scripts/out/, gitignored)
  --mode <name>        coach (default)
  --only <case id>     run one case only
  --dry-run            list the cases and how many candidates each one gets; no model is called
  --help               this text

Provider keys (server env, never committed): ANTHROPIC_API_KEY, LLM_API_KEY (and optional LLM_BASE_URL), NVIDIA_API_KEY.
Without any of them the script prints a notice and exits 0.`;

interface Args {
  help: boolean;
  dryRun: boolean;
  candidates: string | null;
  out: string;
  mode: string;
  only: string | null;
}

function parseArgs(argv: string[]): Args | string {
  const args: Args = { help: false, dryRun: false, candidates: null, out: DEFAULT_OUT_DIR, mode: "coach", only: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string | null => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return null;
      i += 1;
      return next;
    };
    if (flag === "--") continue;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--candidates" || flag === "--out" || flag === "--mode" || flag === "--only") {
      const v = value();
      if (v === null) return `${flag} needs a value`;
      if (flag === "--candidates") args.candidates = v;
      else if (flag === "--out") args.out = resolve(v);
      else if (flag === "--mode") args.mode = v;
      else args.only = v;
    } else return `unknown argument ${String(flag)}`;
  }
  return args;
}

function hasProviderKeys(env: Record<string, string | undefined>): boolean {
  const p = loadProviders(env);
  return p.anthropic.apiKey !== "" || p.freellm.apiKey !== "" || p.nvidia.apiKey !== "";
}

// ---- Candidates file ----

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function readCandidates(path: string): Promise<Candidate[] | string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return `cannot read ${path} as JSON`;
  }
  if (!Array.isArray(parsed)) return "the candidates file must be a JSON array";
  for (const [i, c] of parsed.entries()) {
    const ok =
      isRecord(c) &&
      typeof c.id === "string" &&
      typeof c.slug === "string" &&
      typeof c.name === "string" &&
      typeof c.tab === "string" &&
      typeof c.capital === "string" &&
      Array.isArray(c.chains) &&
      Array.isArray(c.points) &&
      Array.isArray(c.steps);
    if (!ok) return `candidate #${i} does not look like a Candidate (id, slug, name, tab, capital, chains, points, steps)`;
  }
  return parsed as Candidate[];
}

// ---- Cases ----

const elapsed = (since: number): number => Math.round(performance.now() - since);

interface RunContext {
  candidates: Candidate[];
  now: Date;
}

function base(def: SampleCaseDef, request: string, candidateCount: number): SampleResult {
  return {
    id: def.id,
    kind: def.kind,
    label: def.label,
    profile: def.profile,
    request,
    called: false,
    model: null,
    ok: true,
    latencyMs: 0,
    firstTokenMs: null,
    shown: "",
    dropped: null,
    redactions: null,
    candidateCount,
    note: null,
  };
}

/** What the routes pass to `selectCandidates` for this case: the pool (as loaded) and the thread's project, if any. */
function pickCandidates(def: SampleCaseDef, ctx: RunContext): Candidate[] {
  const profile = COACH_PROFILES[def.profile];
  const pool = def.pool === "non-free" ? ctx.candidates.filter((c) => c.capital !== "free") : ctx.candidates;
  if (def.scope === "first") {
    const first = selectCandidates(pool, profile)[0];
    return first === undefined ? [] : selectCandidates(pool, profile, first.id);
  }
  return selectCandidates(pool, profile);
}

/** The plan route, minus the database: no candidates, no model; else `callStructured`, `validatePlan`, the plan text. */
async function runPlan(def: SampleCaseDef, ctx: RunContext): Promise<SampleResult> {
  const profile = COACH_PROFILES[def.profile];
  const candidates = pickCandidates(def, ctx);
  const result = base(def, coach.planRequest, candidates.length);
  if (candidates.length === 0) return { ...result, shown: coach.empty.noCandidates, note: "no candidates, no model call (as the route)" };

  const llm = coachLlm(process.env);
  const started = Date.now();
  const clock = performance.now();
  const outcome = await callStructured(planMessages(profile, candidates, ctx.now), coachPlanAnswerSchema, llm.planModels, {
    chat: chatWithDeadline(llm.chat, started + PLAN_BUDGET_MS),
    sleep,
    breaker: llm.breaker,
    shouldStop: () => Date.now() - started > PLAN_BUDGET_MS,
  });
  const latencyMs = elapsed(clock);
  if (!outcome.ok) {
    return { ...result, called: true, ok: false, latencyMs, shown: coach.errors.unavailable, note: outcome.stopped ? "chain stopped" : "every model failed" };
  }

  const { recommendations, dropped } = validatePlan(outcome.value, candidates, profile);
  const names = new Map(candidates.map((c) => [c.id, c.name]));
  return {
    ...result,
    called: true,
    model: outcome.model,
    latencyMs,
    dropped,
    shown: recommendations.length === 0 ? coach.empty.noPlan : renderPlan(recommendations, names),
    note: recommendations.length === 0 ? "no_plan: every recommendation was dropped" : null,
  };
}

/** The chat route, minus the database: `streamText` over the chat chain, the stream sanitizer and `finalReply`. */
async function runChat(def: SampleCaseDef, ctx: RunContext): Promise<SampleResult> {
  const profile = COACH_PROFILES[def.profile];
  const message = def.message ?? "";
  const candidates = pickCandidates(def, ctx);
  const result = base(def, message, candidates.length);

  let turn = message;
  if (def.kind === "explain_step") {
    const step = candidates[0]?.steps[0];
    if (step === undefined) return { ...result, ok: false, note: "no candidate with a step in the file: nothing to explain" };
    turn = explainStepTurn(step.text, message);
  }

  const llm = coachLlm(process.env);
  const clock = performance.now();
  const events = streamText(llm.chatModels, chatMessages(profile, candidates, ctx.now, [], turn), {
    providers: llm.providers,
    fetch: llm.fetch,
    claude: llm.claude,
    breaker: llm.breaker,
    signal: AbortSignal.timeout(CHAT_BUDGET_MS),
    cache: true,
  });
  const context = candidateContext(candidates, profile);
  const sanitizer = createStreamSanitizer(context);
  let sent = "";
  let model: string | null = null;
  let ok = false;
  let firstTokenMs: number | null = null;
  for await (const event of events) {
    if ("delta" in event) {
      firstTokenMs ??= elapsed(clock);
      sent += sanitizer.push(event.delta);
    } else if ("done" in event) {
      sent += sanitizer.flush();
      model = event.done.model;
      ok = true;
    }
  }
  const latencyMs = elapsed(clock);
  const shown = finalReply(sent, context);
  return {
    ...result,
    called: true,
    model,
    ok,
    latencyMs,
    firstTokenMs,
    shown: ok ? shown : shown === "" ? coach.errors.unavailable : shown,
    redactions: sanitizer.redactions(),
    note: ok ? null : shown === "" ? "every model failed" : "stream broke after text: the route would not store this answer",
  };
}

async function runCase(def: SampleCaseDef, ctx: RunContext): Promise<SampleResult> {
  try {
    return await (def.kind === "plan" ? runPlan(def, ctx) : runChat(def, ctx));
  } catch (error) {
    // Only the error class, never its message: a message could carry a prompt or an answer.
    const name = error instanceof Error ? error.name : "Error";
    return { ...base(def, def.message ?? coach.planRequest, 0), called: true, ok: false, note: `unexpected ${name}` };
  }
}

// ---- Modes ----

/** A sample generator. `coach` is the only one now; the Briefing samples are one more entry here. */
type ModeRunner = (cases: readonly SampleCaseDef[], ctx: RunContext) => Promise<SampleResult[]>;

const runCoachMode: ModeRunner = async (cases, ctx) => {
  const results: SampleResult[] = [];
  // One at a time: parallel calls would distort the latency this run exists to measure.
  for (const def of cases) {
    const r = await runCase(def, ctx);
    console.log(`${r.ok ? "ok    " : "FAILED"} ${def.id} ${r.model ?? "-"} ${r.latencyMs} ms`);
    results.push(r);
  }
  return results;
};

const MODES: Record<string, { cases: readonly SampleCaseDef[]; run: ModeRunner }> = {
  coach: { cases: SAMPLE_CASES, run: runCoachMode },
};

// ---- Output ----

function printSummary(summary: Summary): void {
  console.log("\nSummary per model");
  console.log("model | count | failures | p50 ms | p95 ms");
  for (const m of summary.byModel) console.log(`${m.model} | ${m.count} | ${m.failures} | ${m.p50Ms ?? "-"} | ${m.p95Ms ?? "-"}`);
  const t = summary.total;
  console.log(`cases ${t.cases}, called a model ${t.called}, failed ${t.failures}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(`${args}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const mode = MODES[args.mode];
  if (mode === undefined) {
    console.error(`unknown mode "${args.mode}" (available: ${Object.keys(MODES).join(", ")})`);
    return 2;
  }
  if (!args.dryRun && !hasProviderKeys(process.env)) {
    console.log("No provider keys: set ANTHROPIC_API_KEY, LLM_API_KEY or NVIDIA_API_KEY to run the real chain. Nothing was called.");
    return 0;
  }
  if (args.candidates === null) {
    console.error(`--candidates is required\n\n${USAGE}`);
    return 2;
  }
  const candidates = await readCandidates(args.candidates);
  if (typeof candidates === "string") {
    console.error(candidates);
    return 2;
  }
  const cases = mode.cases.filter((c) => args.only === null || c.id === args.only);
  if (cases.length === 0) {
    console.error(`no case matches --only ${String(args.only)}`);
    return 2;
  }
  const ctx: RunContext = { candidates, now: new Date() };

  if (args.dryRun) {
    for (const def of cases) console.log(`${def.id} (${def.kind}, ${def.profile}): ${pickCandidates(def, ctx).length} candidates`);
    return 0;
  }

  const results = await mode.run(cases, ctx);
  const summary = summarize(results);
  const safe = results.map((r) => ({ ...r, shown: scrub(r.shown), request: scrub(r.request), note: r.note === null ? null : scrub(r.note) }));
  const generatedAt = ctx.now.toISOString();
  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  await mkdir(args.out, { recursive: true });
  const jsonPath = resolve(args.out, `${args.mode}-samples-${stamp}.json`);
  const mdPath = resolve(args.out, `${args.mode}-samples-${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify({ mode: args.mode, generatedAt, summary, results: safe }, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(safe, summary, { generatedAt }));
  printSummary(summary);
  console.log(`\nWrote ${jsonPath}\nWrote ${mdPath}`);
  return 0;
}

process.exitCode = await main();
