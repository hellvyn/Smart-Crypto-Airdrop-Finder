// Model comparison for the AI Analyst (owner decision, prepaid Claude credit ends 2026-10-27): runs the Analyst once
// per project per model, with exactly one model per call (no fallback mixing), and writes a JSON and a Markdown report
// into the git-ignored `eval/cases/model-compare/`.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... LLM_API_KEY=... NVIDIA_API_KEY=... \
//     pnpm --filter pipeline exec tsx eval/model-compare.ts --projects 15 --models sonnet,haiku,freellm,glm
//
// Read-only on the database: the repository handed to the shared code is `readOnlyRepo`, and the official-site step runs
// with no fetch budget, so nothing is fetched from the web and nothing is written. The sources are built by the same
// code the analyze stage uses (`listProjectSourceTexts` plus `officialSiteSources` and `defillamaDetailSources` read from
// their caches), and the prompt, schema and post-processing are the Analyst's own. stdout gets the summary table only:
// never source text, model output, project names or keys.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { forbiddenPhrases } from "@saf/core";
import { callStructured, createChat, createClaudeClient, loadProviders, modelKey } from "@saf/llm";
import type { ChatFn, ModelConfig } from "@saf/llm";
import { defaultConfig } from "../src/config.js";
import { analystAnalyzer } from "../src/llm/prompts/analyst.js";
import { combineExtraSources, officialSiteSources } from "../src/steps/analyze.js";
import type { Analyzer, SourceText } from "../src/steps/analyze.js";
import { defillamaDetailSources } from "../src/steps/collect.js";
import { loadOfficialSites } from "../src/steps/official-sites.js";
import { emptyStats } from "../src/stats.js";
import { SupabaseRepo } from "../src/store/supabase-repo.js";
import type { PipelineRepo, ProjectForScoring } from "../src/store/repo.js";
import { parseModelList, readOnlyRepo, renderReport, selectProjects, summarize } from "./model-compare-lib.js";
import type { CallRecord, Candidate, ModelSummary, ReportProject } from "./model-compare-lib.js";

const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "cases", "model-compare");
const DEFAULT_PROJECTS = 15;
const MAX_PROJECTS = 60;
const DEFAULT_CONCURRENCY = 3;
/** No new call starts after this many minutes, so the files are always written inside the workflow's 30-minute limit. */
const DEFAULT_BUDGET_MINUTES = 22;
const MINUTE_MS = 60_000;
const DEFILLAMA_PAGE = /^https:\/\/defillama\.com\/protocol\//;

/**
 * One Analyst call on exactly one model. The prompt, schema and `postProcess` are the analyzer's own; nothing here
 * reimplements them. Never throws and never keeps the raw answer: a failed call keeps only its failure code.
 */
export async function runCall(
  analyzer: Analyzer,
  project: ProjectForScoring,
  sources: SourceText[],
  model: ModelConfig,
  deps: { chat: ChatFn; sleep: (ms: number) => Promise<void> },
): Promise<CallRecord> {
  const base: CallRecord = {
    projectId: project.id,
    projectName: project.name,
    model: modelKey(model),
    ok: false,
    failure: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    pointsReturned: null,
    pointsKept: null,
    styleViolations: [],
    verdict: null,
    confidence: null,
    points: [],
    effortNote: "",
  };
  try {
    const outcome = await callStructured(analyzer.buildMessages(project, sources), analyzer.schema, [model], {
      chat: deps.chat,
      sleep: deps.sleep,
    });
    const known = outcome.attempts.filter((a) => a.usage !== undefined);
    base.latencyMs = outcome.attempts.length === 0 ? null : outcome.attempts.reduce((n, a) => n + a.latencyMs, 0);
    base.inputTokens = known.length === 0 ? null : known.reduce((n, a) => n + (a.usage?.inputTokens ?? 0), 0);
    base.outputTokens = known.length === 0 ? null : known.reduce((n, a) => n + (a.usage?.outputTokens ?? 0), 0);
    if (!outcome.ok) {
      base.failure = outcome.attempts.at(-1)?.error ?? "no_call";
      return base;
    }
    const answer = outcome.value as { points: unknown[] };
    const result = analyzer.postProcess(outcome.value, sources, project) as {
      verdict: string;
      confidence: string;
      points: { text: string; quote: string; source_url: string }[];
      effort: { note: string };
    };
    const prose = analyzer.indonesianTexts?.(result) ?? [];
    return {
      ...base,
      ok: true,
      pointsReturned: answer.points.length,
      pointsKept: result.points.length,
      styleViolations: [...new Set(prose.flatMap(forbiddenPhrases))],
      verdict: result.verdict,
      confidence: result.confidence,
      points: result.points.map((p) => ({ text: p.text, quote: p.quote, source_url: p.source_url })),
      effortNote: result.effort.note,
    };
  } catch (error) {
    // The error's name only: its message could carry source text.
    base.failure = `threw_${error instanceof Error ? error.name : typeof error}`;
    return base;
  }
}

interface Prepared {
  project: ProjectForScoring;
  sources: SourceText[];
  candidate: Candidate;
  report: ReportProject;
}

/**
 * The listed projects (latest curation passed) that have Analyst input, with the sources exactly as the analyze stage
 * builds them for the Analyst: the project's own source texts plus `extraSources` (official site text and DefiLlama
 * detail lines, both from their database caches). `repo` must be read-only.
 */
export async function prepareProjects(repo: PipelineRepo, now: Date): Promise<Prepared[]> {
  const config = defaultConfig;
  const all = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
  const listedIds = new Set(await repo.listListedProjects(all.map((p) => p.id)));
  const listed = all.filter((p) => listedIds.has(p.id));
  // No site budget: the sites already in the cache are used, none is fetched (and so none is written).
  const noFetch = async (): Promise<never> => {
    throw new Error("the model comparison fetches nothing");
  };
  const officialPages = await loadOfficialSites(
    { repo, fetchUntrusted: noFetch, now: () => now },
    { ...config, officialSites: { ...config.officialSites, maxPerRun: 0 } },
    listed,
    now,
    emptyStats(),
  );
  const extraSources = combineExtraSources(officialSiteSources(officialPages), defillamaDetailSources(repo, new Map(), now));

  const out: Prepared[] = [];
  const limit = pLimit(4);
  await Promise.all(
    listed.map((project) =>
      limit(async () => {
        const own = await repo.listProjectSourceTexts(project.id);
        const sources = [...own, ...(await extraSources(project, "analyst", own))];
        if (sources.length === 0) return;
        const rich = sources.some((s) => !DEFILLAMA_PAGE.test(s.url) && !s.url.startsWith("defillama-detail://"));
        const chars = sources.reduce((n, s) => n + [...s.text].length, 0);
        out.push({
          project,
          sources,
          candidate: { id: project.id, kind: rich ? "rich" : "thin", weight: chars },
          report: {
            id: project.id,
            name: project.name,
            sourceKinds: [...new Set(sources.map((s) => sourceLabel(s.url)))].join(", "),
            sourceCount: sources.length,
            sourceChars: chars,
          },
        });
      }),
    ),
  );
  return out.sort((a, b) => (a.project.id < b.project.id ? -1 : 1));
}

/** A coarse, non-identifying label of a source URL (its scheme or host), for the report. */
function sourceLabel(url: string): string {
  if (url.startsWith("official-site://")) return "official site";
  if (url.startsWith("defillama-detail://")) return "DefiLlama detail";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/** `--projects` as a count in 1..MAX_PROJECTS; empty or missing means the default. Throws on anything else. */
export function parseProjectCount(value: string | undefined): number {
  const raw = (value ?? "").trim();
  if (raw === "") return DEFAULT_PROJECTS;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= MAX_PROJECTS)) throw new Error(`--projects must be a number from 1 to ${MAX_PROJECTS}`);
  return n;
}

function summaryTable(rows: readonly ModelSummary[]): string {
  const f = (n: number | null, d = 1): string => (n === null ? "n/a" : n.toFixed(d));
  const head = ["model", "success", "schema_fail", "other_fail", "pts_kept", "dropped%", "style", "p50_s", "p95_s", "tok_in", "tok_out"];
  const body = rows.map((s) => [
    s.model,
    s.successRate === null ? "n/a" : `${s.ok}/${s.calls}`,
    String(s.schemaFailures),
    String(s.otherFailures),
    f(s.meanPointsKept),
    f(s.droppedPct, 0),
    String(s.styleViolationCalls),
    f(s.latencyP50 === null ? null : s.latencyP50 / 1000),
    f(s.latencyP95 === null ? null : s.latencyP95 / 1000),
    String(s.inputTokens),
    String(s.outputTokens),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]): string => r.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  return [line(head), ...body.map(line)].join("\n");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let count: number;
  let requested: ModelConfig[];
  try {
    count = parseProjectCount(argValue(argv, "--projects"));
    requested = parseModelList(argValue(argv, "--models"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    console.error("model-compare needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    return 2;
  }
  const providers = loadProviders(process.env);
  const skipped = requested.filter((m) => m.provider === "anthropic" && providers.anthropic.apiKey === "").map(modelKey);
  const models = requested.filter((m) => !skipped.includes(modelKey(m)));
  for (const k of skipped) console.log(`Skipping ${k}: ANTHROPIC_API_KEY is not set.`);
  if (models.length === 0) {
    console.error("No model left to compare.");
    return 2;
  }
  const claude = providers.anthropic.apiKey === "" ? null : createClaudeClient(providers.anthropic.apiKey, fetch);
  const chat = createChat(providers, { fetch, claude });
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const now = new Date();
  const repo = readOnlyRepo(new SupabaseRepo(createClient(url, key, { auth: { persistSession: false } })));
  const prepared = await prepareProjects(repo, now);
  const chosen = selectProjects(
    prepared.map((p) => p.candidate),
    count,
  );
  const byId = new Map(prepared.map((p) => [p.project.id, p]));
  const picked = chosen.flatMap((c) => byId.get(c.id) ?? []);
  console.log(`${prepared.length} listed projects have Analyst input; comparing ${picked.length} (${chosen.filter((c) => c.kind === "rich").length} with rich sources) on ${models.length} models.`);

  const deadline = Date.now() + DEFAULT_BUDGET_MINUTES * MINUTE_MS;
  const limit = pLimit(DEFAULT_CONCURRENCY);
  const records: CallRecord[] = [];
  let budgetSkipped = 0;
  await Promise.all(
    picked.flatMap((p) =>
      models.map((model) =>
        limit(async () => {
          if (Date.now() >= deadline) {
            budgetSkipped += 1;
            return;
          }
          records.push(await runCall(analystAnalyzer, p.project, p.sources, model, { chat, sleep }));
        }),
      ),
    ),
  );
  const order = new Map(picked.map((p, i) => [p.project.id, i]));
  const keys = models.map(modelKey);
  records.sort(
    (a, b) => (order.get(a.projectId) ?? 0) - (order.get(b.projectId) ?? 0) || keys.indexOf(a.model) - keys.indexOf(b.model),
  );

  const summaries = summarize(records, keys);
  const generatedAt = now.toISOString();
  const meta = { generatedAt, projectCount: picked.length, models: keys };
  const reportProjects = picked.map((p) => p.report);
  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, `model-compare-${stamp}.json`),
    `${JSON.stringify({ ...meta, skippedModels: skipped, callsSkippedForBudget: budgetSkipped, summaries, projects: reportProjects, records }, null, 2)}\n`,
  );
  writeFileSync(join(OUT_DIR, `model-compare-${stamp}.md`), `${renderReport(meta, summaries, reportProjects, records)}\n`);

  console.log(summaryTable(summaries));
  if (budgetSkipped > 0) console.log(`${budgetSkipped} calls were not started: the ${DEFAULT_BUDGET_MINUTES}-minute budget ran out.`);
  console.log(`Wrote model-compare-${stamp}.json and .md to pipeline/eval/cases/model-compare/.`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // The error's name only: a database error message could carry row data.
      console.error(`model-compare failed (${error instanceof Error ? error.name : typeof error}).`);
      process.exitCode = 1;
    },
  );
}
