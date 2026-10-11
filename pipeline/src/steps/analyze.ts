import { createHash } from "node:crypto";
import pLimit from "p-limit";
import type { z } from "zod";
import { forbiddenPhrases } from "@saf/core";
import type { AiKind } from "@saf/core";
import type { PipelineConfig } from "../config.js";
import { createCircuitBreaker } from "../llm/circuit-breaker.js";
import type { ChatMessage } from "../llm/nvidia.js";
import { analystAnalyzer } from "../llm/prompts/analyst.js";
import { contradictionsAnalyzer } from "../llm/prompts/contradictions.js";
import { scamAnalyzer } from "../llm/prompts/scam.js";
import { callStructured } from "../llm/structured.js";
import type { ChatFn } from "../llm/structured.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";
import { CIRCUIT_BREAKER_THRESHOLD } from "./extract.js";

const MINUTE_MS = 60_000;

/** One input document of an analysis. */
export interface SourceText {
  url: string;
  text: string;
}

/**
 * One kind of AI analysis. Source text is written by whoever runs the project, scammers included: `buildMessages`
 * must hand it to the model as data, never as instructions (spec §13). The stored result can only add warnings or
 * lower a recommendation; it never decides whether a project passes curation.
 */
export interface Analyzer<T = unknown, R = unknown> {
  kind: AiKind;
  /** Stored with each analysis; a new version makes every project of this kind analyzed again. */
  promptVersion: string;
  /**
   * The prompt may only use what `analysisInputHash` covers (name, status, steps, facts, sources), so an unchanged
   * hash really means an unchanged prompt and the cached analysis stays valid.
   */
  buildMessages(project: ProjectForScoring, sources: SourceText[]): ChatMessage[];
  /** The answer must match this schema, or the next model is tried. */
  schema: z.ZodType<T>;
  /** Turns a schema-valid answer into the stored `ai_analyses.result` (e.g. drops points whose quote is not in `sources`). */
  postProcess(value: T, sources: SourceText[]): R;
  /**
   * The Indonesian prose of a stored result (never its quotes). A new analysis whose stored prose uses a forbidden
   * phrase counts once in `ai_style_violations`; it is stored all the same. Prose that `postProcess` dropped is never
   * shown, so it does not count.
   */
  indonesianTexts?(result: R): string[];
  /**
   * Writes what other tables take from a new result (e.g. the Analyst's step translations in `tasks.text_id`). Runs
   * before the analysis is stored, so when it throws the previous analysis stays the latest and the next run retries.
   */
  saveDerived?(repo: PipelineRepo, project: ProjectForScoring, result: R): Promise<void>;
}

/** The analyses each run makes, in this order per project. */
export const ANALYZERS: Analyzer[] = [analystAnalyzer, scamAnalyzer, contradictionsAnalyzer];

export interface AnalyzeDeps {
  repo: PipelineRepo;
  chat: ChatFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** Defaults to `ANALYZERS`. */
  analyzers?: Analyzer[];
  /**
   * Extra input documents of one analyzer for one project (e.g. claim portal pages for the scam analyst), next to
   * the project's own source texts. They go into that analyzer's prompt and input hash only.
   */
  extraSources?: (project: ProjectForScoring, kind: AiKind) => Promise<SourceText[]>;
  /** Where a failed analysis is reported (project id and kind only, never source text); defaults to console.warn. */
  warn?: (line: string) => void;
}

/**
 * The run's `extraSources` (#56): each project's claim portal pages (`readClaimPages`, by project id) go to the AI
 * Scam Analyst only; no other analysis gets them.
 */
export function claimPageSources(
  pages: ReadonlyMap<string, SourceText[]>,
): NonNullable<AnalyzeDeps["extraSources"]> {
  return async (project, kind) => (kind === "scam" ? (pages.get(project.id) ?? []) : []);
}

/**
 * sha256 (hex) of what an analysis reads: the source texts, the project's name, steps (in order), facts and status.
 * Sources and facts are sorted first, so the order the database returns them in does not matter.
 */
export function analysisInputHash(project: ProjectForScoring, sourceTexts: string[]): string {
  const facts = project.facts.map((f) => JSON.stringify([f.field, f.value, f.quote])).sort();
  const canonical = JSON.stringify({
    name: project.name,
    status: project.status,
    steps: project.steps.map((s) => [s.text, s.cadence]),
    facts,
    sources: [...sourceTexts].sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Runs every analyzer on every project, `llmConcurrency` projects at a time, and stores each new analysis.
 *
 * - The input of an analysis is the project's unpurged source documents (`listProjectSourceTexts`) plus the
 *   analyzer's `extraSources`. A project with no input is not analyzed; its previous analysis, if any, stays.
 * - Cache: when the latest stored analysis of that kind has the same input hash (see `analysisInputHash`, over each
 *   source's url and text) and prompt version, it is reused without a call (`ai_analyses_cached`).
 * - Budget: `analyzeBudgetMinutes` after the stage starts (by `deps.now()`) no new LLM call starts, and at most
 *   `maxAnalysesPerRun` analyses start. Analyses not started, or stopped between models, count as
 *   `ai_analyses_deferred`; so does an analysis that finds every model's circuit open.
 * - Models are tried as in extraction (`callStructured`), with one circuit breaker for the whole stage. When every
 *   model fails, or the analysis throws, it counts as `ai_analyses_failed`, is reported through `warn` (project id
 *   and kind), and the previous analysis stays the latest. No failure stops the other analyses.
 * - Style: a new analysis whose stored `indonesianTexts` use a forbidden phrase counts in `ai_style_violations`.
 */
export async function runAnalyses(
  deps: AnalyzeDeps,
  config: PipelineConfig,
  projects: ProjectForScoring[],
  stats: DailyStats,
): Promise<void> {
  const { repo } = deps;
  const analyzers = deps.analyzers ?? ANALYZERS;
  if (analyzers.length === 0) return;
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const reportFailure = (project: ProjectForScoring, kind: AiKind, why: string): void => {
    stats.ai_analyses_failed += 1;
    warn(`analyze: ${kind} analysis of project ${project.id} failed (${why})`);
  };
  const deadline = deps.now().getTime() + config.analyzeBudgetMinutes * MINUTE_MS;
  const budgetSpent = (): boolean => deps.now().getTime() >= deadline;
  const breaker = createCircuitBreaker(CIRCUIT_BREAKER_THRESHOLD);
  const limit = pLimit(config.llmConcurrency);
  let started = 0;

  const analyzeOne = async (project: ProjectForScoring, own: SourceText[], analyzer: Analyzer): Promise<void> => {
    const extra = deps.extraSources ? await deps.extraSources(project, analyzer.kind) : [];
    const sources = [...own, ...extra];
    if (sources.length === 0) return;
    const inputHash = analysisInputHash(project, sources.map((s) => `${s.url}\n${s.text}`));
    const previous = await repo.latestAiAnalysis(project.id, analyzer.kind);
    if (previous !== null && previous.inputHash === inputHash && previous.promptVersion === analyzer.promptVersion) {
      stats.ai_analyses_cached += 1;
      return;
    }
    if (budgetSpent() || started >= config.maxAnalysesPerRun) {
      stats.ai_analyses_deferred += 1;
      return;
    }
    started += 1;
    const outcome = await callStructured(analyzer.buildMessages(project, sources), analyzer.schema, config.models, {
      chat: deps.chat,
      sleep: deps.sleep,
      breaker,
      shouldStop: budgetSpent,
    });
    if (!outcome.ok) {
      if (outcome.stopped) stats.ai_analyses_deferred += 1;
      // Failure codes only (e.g. http_429, schema); the raw answers can quote the sources.
      else reportFailure(project, analyzer.kind, outcome.attempts.map((a) => a.error ?? "ok").join(", "));
      return;
    }
    const result = analyzer.postProcess(outcome.value, sources);
    await analyzer.saveDerived?.(repo, project, result);
    await repo.saveAiAnalysis({
      projectId: project.id,
      kind: analyzer.kind,
      inputHash,
      result,
      model: outcome.model,
      servedModel: outcome.servedModel,
      promptVersion: analyzer.promptVersion,
      createdAt: deps.now(),
    });
    stats.ai_analyses_run += 1;
    const prose = analyzer.indonesianTexts?.(result) ?? [];
    if (prose.some((text) => forbiddenPhrases(text).length > 0)) stats.ai_style_violations += 1;
  };

  const analyzeProject = async (project: ProjectForScoring): Promise<void> => {
    let own: SourceText[];
    try {
      own = await repo.listProjectSourceTexts(project.id);
    } catch (error) {
      for (const analyzer of analyzers) reportFailure(project, analyzer.kind, `sources: ${errorName(error)}`);
      return;
    }
    for (const analyzer of analyzers) {
      try {
        await analyzeOne(project, own, analyzer);
      } catch (error) {
        // The error's name only: its message could carry source text or stored values.
        reportFailure(project, analyzer.kind, `threw ${errorName(error)}`);
      }
    }
  };

  await Promise.all(projects.map((project) => limit(() => analyzeProject(project))));
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
