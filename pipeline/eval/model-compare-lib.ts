// Pure parts of the model comparison (`model-compare.ts`): model list, project selection, summary and report. No I/O,
// so they are unit-tested (`test/model-compare.test.ts`).
import { MODELS, modelKey } from "@saf/llm";
import type { ModelConfig } from "@saf/llm";

/** One kept point of an Analyst answer (after grounding), as the owner reads it. */
export interface ComparedPoint {
  text: string;
  quote: string;
  source_url: string;
}

/** One AI Analyst call: one project, one model, no fallback. */
export interface CallRecord {
  projectId: string;
  projectName: string;
  /** `"<provider>:<id>"` of the one model of the call. */
  model: string;
  ok: boolean;
  /** Failure code of the last attempt (`schema`, `json_parse`, `http_429`, `finish_length`, ...), or null when ok. */
  failure: string | null;
  /** Sum of the attempts' request time (a 429 retry counts, the wait between does not), or null when no call was made. */
  latencyMs: number | null;
  /** Tokens the transport reported, summed over the attempts; null when none reported any. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Points the model returned / points left after `postProcess` (grounding); null when the call failed. */
  pointsReturned: number | null;
  pointsKept: number | null;
  /** Forbidden style phrases found in the kept Indonesian prose. */
  styleViolations: string[];
  verdict: string | null;
  confidence: string | null;
  points: ComparedPoint[];
  effortNote: string;
}

export interface ModelSummary {
  model: string;
  calls: number;
  ok: number;
  failed: number;
  /** ok / calls, null without calls. */
  successRate: number | null;
  /** Failed because the answer was not JSON or did not match the schema. */
  schemaFailures: number;
  /** Failed for any other reason (HTTP error, timeout, cut-off, empty answer, refusal). */
  otherFailures: number;
  /** Mean points kept per successful call, null without one. */
  meanPointsKept: number | null;
  pointsReturned: number;
  pointsDropped: number;
  /** Dropped / returned points over the successful calls, in percent; null without points. */
  droppedPct: number | null;
  /** Calls whose kept prose uses at least one forbidden phrase. */
  styleViolationCalls: number;
  latencyP50: number | null;
  latencyP95: number | null;
  /** Sum over the calls that reported usage. */
  inputTokens: number;
  outputTokens: number;
  callsWithUsage: number;
}

const SCHEMA_FAILURES = new Set(["schema", "json_parse"]);

/** Nearest-rank percentile (`p` in 0..1) of `values`; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? null;
}

/** One row per model of `models` (in that order), from the calls of `records`. */
export function summarize(records: readonly CallRecord[], models: readonly string[]): ModelSummary[] {
  return models.map((model) => {
    const mine = records.filter((r) => r.model === model);
    const ok = mine.filter((r) => r.ok);
    const failed = mine.filter((r) => !r.ok);
    const returned = ok.reduce((n, r) => n + (r.pointsReturned ?? 0), 0);
    const kept = ok.reduce((n, r) => n + (r.pointsKept ?? 0), 0);
    const latencies = mine.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
    const withUsage = mine.filter((r) => r.inputTokens !== null || r.outputTokens !== null);
    return {
      model,
      calls: mine.length,
      ok: ok.length,
      failed: failed.length,
      successRate: mine.length === 0 ? null : ok.length / mine.length,
      schemaFailures: failed.filter((r) => r.failure !== null && SCHEMA_FAILURES.has(r.failure)).length,
      otherFailures: failed.filter((r) => r.failure === null || !SCHEMA_FAILURES.has(r.failure)).length,
      meanPointsKept: ok.length === 0 ? null : kept / ok.length,
      pointsReturned: returned,
      pointsDropped: returned - kept,
      droppedPct: returned === 0 ? null : ((returned - kept) / returned) * 100,
      styleViolationCalls: ok.filter((r) => r.styleViolations.length > 0).length,
      latencyP50: percentile(latencies, 0.5),
      latencyP95: percentile(latencies, 0.95),
      inputTokens: withUsage.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
      outputTokens: withUsage.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
      callsWithUsage: withUsage.length,
    };
  });
}

/** A project that can be analyzed: `rich` has more than a DefiLlama listing (aggregator pages, claim text, official site). */
export interface Candidate {
  id: string;
  kind: "rich" | "thin";
  /** Total source characters; the pick spreads over this range. */
  weight: number;
}

/** `k` items of `sorted` spread evenly over its length (the middle of each of k equal slices). */
function spread<T>(sorted: readonly T[], k: number): T[] {
  if (k >= sorted.length) return [...sorted];
  return Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) * sorted.length) / k)] as T);
}

/**
 * Picks `n` candidates: about two thirds with rich sources, the rest DefiLlama-only, each group spread over its size
 * range (not just the biggest). A short group is filled from the other one; fewer candidates than `n` returns all.
 * Deterministic: the order of `candidates` does not matter.
 */
export function selectProjects<C extends Candidate>(candidates: readonly C[], n: number): C[] {
  const bySize = (a: C, b: C): number => a.weight - b.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rich = candidates.filter((c) => c.kind === "rich").sort(bySize);
  const thin = candidates.filter((c) => c.kind === "thin").sort(bySize);
  if (candidates.length <= n) return [...rich, ...thin];
  let richN = Math.min(rich.length, Math.ceil((n * 2) / 3));
  let thinN = Math.min(thin.length, n - richN);
  richN = Math.min(rich.length, n - thinN);
  thinN = Math.min(thin.length, n - richN);
  return [...spread(rich, richN), ...spread(thin, thinN)];
}

/** Short names for `--models`. The full `<provider>:<id>` key works too. */
export const MODEL_ALIASES: Record<string, ModelConfig> = {
  sonnet: { provider: "anthropic", id: "claude-sonnet-5-5", extraBody: {} },
  haiku: { provider: "anthropic", id: "claude-haiku-5-5", extraBody: {} },
  // The free models are the production ones, with the production request options.
  freellm: MODELS.find((m) => m.provider === "freellm" && m.id === "auto") ?? { provider: "freellm", id: "auto", extraBody: {} },
  glm:
    MODELS.find((m) => m.provider === "nvidia" && m.id === "z-ai/glm-5.3-flash") ??
    { provider: "nvidia", id: "z-ai/glm-5.3-flash", extraBody: { reasoning_effort: "low" } },
};

/** The models of a `--models` value (comma separated aliases or keys); undefined or empty means all four. Throws on an unknown name. */
export function parseModelList(value: string | undefined): ModelConfig[] {
  const names = (value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (names.length === 0) return Object.values(MODEL_ALIASES);
  const out: ModelConfig[] = [];
  for (const name of names) {
    const model = Object.values(MODEL_ALIASES).find((m) => m === MODEL_ALIASES[name] || modelKey(m) === name || m.id === name);
    if (model === undefined) throw new Error(`unknown model "${name}" (use sonnet, haiku, freellm, glm or <provider>:<id>)`);
    if (!out.includes(model)) out.push(model);
  }
  return out;
}

const READ_METHOD = /^(list|latest|find|count|slug|passedBefore|lastTelegram|getDocumentHash)/;

/**
 * `repo` that only lets its read methods through: anything else throws before it runs. The comparison reads the
 * production database and must never write to it, so the repository it hands to shared code is wrapped in this.
 */
export function readOnlyRepo<T extends object>(repo: T): T {
  return new Proxy(repo, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && READ_METHOD.test(prop)) return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
      return () => {
        throw new Error(`read-only repository: ${String(prop)} is blocked`);
      };
    },
  });
}

export interface ReportMeta {
  generatedAt: string;
  projectCount: number;
  models: string[];
}

export interface ReportProject {
  id: string;
  name: string;
  /** Kinds of the sources the Analyst read, e.g. `airdrops_io, official-site`. */
  sourceKinds: string;
  sourceCount: number;
  sourceChars: number;
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const fmt = (n: number | null, digits = 1): string => (n === null ? "n/a" : n.toFixed(digits));
const seconds = (ms: number | null): string => (ms === null ? "n/a" : (ms / 1000).toFixed(1));

const COLUMNS = `- **Success**: calls that returned an answer the schema accepted, of all calls.
- **Schema/parse fail**: answers that were not JSON or did not match the Analyst schema. **Other fail**: HTTP errors, timeouts, cut-off or empty answers, refusals.
- **Mean points kept**: points left after grounding per successful call (the model returns 1 to 5).
- **% dropped**: share of the returned points whose quote was not found in the source it named (dropped by \`postProcess\`).
- **Style**: successful calls whose kept Indonesian prose uses a forbidden phrase.
- **p50 / p95 s**: request time per call in seconds, retries of a 429 included.
- **Tokens in / out**: summed over the calls whose provider reported usage (\`n\` shows how many did).`;

/** The Markdown report: summary table per model, then each project's four answers side by side for a human judge. */
export function renderReport(
  meta: ReportMeta,
  summaries: readonly ModelSummary[],
  projects: readonly ReportProject[],
  records: readonly CallRecord[],
): string {
  const out: string[] = [
    "# AI Analyst model comparison",
    "",
    `Generated ${meta.generatedAt}. ${meta.projectCount} projects, ${meta.models.length} models, one call per project per model (no fallback).`,
    "",
    "## 1. Summary per model",
    "",
    "| Model | Success | Schema/parse fail | Other fail | Mean points kept | % dropped | Style | p50 s | p95 s | Tokens in | Tokens out |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map((s) =>
      [
        s.model,
        s.successRate === null ? "n/a" : `${s.ok}/${s.calls} (${(s.successRate * 100).toFixed(0)}%)`,
        String(s.schemaFailures),
        String(s.otherFailures),
        fmt(s.meanPointsKept),
        s.droppedPct === null ? "n/a" : `${s.droppedPct.toFixed(0)}% (${s.pointsDropped}/${s.pointsReturned})`,
        String(s.styleViolationCalls),
        seconds(s.latencyP50),
        seconds(s.latencyP95),
        `${s.inputTokens} (n=${s.callsWithUsage})`,
        String(s.outputTokens),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    ),
    "",
    COLUMNS,
    "",
    "## 2. Per project",
    "",
    "Judge each project by reading the four answers side by side: is the verdict sensible, are the points real facts of the source, is the Indonesian natural. The quote and source URL of every point are in the JSON file.",
    "",
  ];
  projects.forEach((project, i) => {
    out.push(`## ${i + 1}. ${cell(project.name)}`, "");
    out.push(`Sources: ${project.sourceCount} (${cell(project.sourceKinds)}), ${project.sourceChars} characters.`, "");
    const mine = meta.models.map((m) => records.find((r) => r.projectId === project.id && r.model === m));
    out.push(`| | ${meta.models.map(cell).join(" | ")} |`, `|---|${meta.models.map(() => "---").join("|")}|`);
    const row = (label: string, f: (r: CallRecord) => string): void => {
      out.push(`| ${label} | ${mine.map((r) => (r === undefined ? "not run" : cell(f(r)))).join(" | ")} |`);
    };
    row("Verdict", (r) => (r.ok ? `${r.verdict} (${r.confidence})` : `FAILED: ${r.failure ?? "unknown"}`));
    row("Points", (r) =>
      !r.ok ? "-" : `${r.pointsKept} of ${r.pointsReturned} points kept: ${r.points.map((p, j) => `${j + 1}. ${p.text}`).join("<br>")}`,
    );
    row("Effort", (r) => (r.ok ? r.effortNote : "-"));
    row("Forbidden words", (r) => (r.ok ? (r.styleViolations.length === 0 ? "none" : r.styleViolations.join(", ")) : "-"));
    row("Time", (r) => `${seconds(r.latencyMs)} s`);
    out.push("");
  });
  return out.join("\n");
}
