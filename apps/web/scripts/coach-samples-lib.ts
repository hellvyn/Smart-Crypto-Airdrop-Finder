// Pure helpers of the Coach samples script (no I/O, no model calls): the result record, the per-model summary
// (count, failures, p50/p95 latency for the capacity check) and the Markdown the controller reviews.
import type { ValidPlanItem } from "@saf/core";

/** One generated answer. Nothing in it may identify a member: no email, user id or wallet address. */
export interface SampleResult {
  id: string;
  kind: "plan" | "chat" | "explain_step";
  label: string;
  /** Name of the fixed member profile (see `COACH_PROFILES`), not a real member. */
  profile: string;
  /** The member's message, or the fixed plan request. */
  request: string;
  /** Whether a model was called at all (a plan with no candidates is answered without one). */
  called: boolean;
  /** `"<provider>:<id>"` that answered; null when none did (or none was called). */
  model: string | null;
  /** False when the whole chain failed or the stream broke. */
  ok: boolean;
  latencyMs: number;
  /** Chat only: time to the first text. */
  firstTokenMs: number | null;
  /** The text the member would see, after `validatePlan` / redaction exactly as the routes do. */
  shown: string;
  /** Plan: recommendations dropped by `validatePlan`. Chat: null. */
  dropped: number | null;
  /** Chat: sensitive spans the stream guard replaced. Plan: null. */
  redactions: number | null;
  candidateCount: number;
  note: string | null;
}

export interface ModelSummary {
  model: string;
  count: number;
  failures: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface Summary {
  byModel: ModelSummary[];
  total: { cases: number; called: number; failures: number };
}

export const NO_MODEL = "(no model answered)";

/** Nearest-rank percentile (`p` in 0..100) of `values`, or null when there are none. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

/**
 * Per-model figures of a run. A case that called no model (an empty candidate list) is not a sample of any model and
 * is left out; a case whose whole chain failed is filed under `NO_MODEL`. Latency covers failures too: a model that
 * times out is exactly what the capacity check looks for.
 */
export function summarize(results: SampleResult[]): Summary {
  const groups = new Map<string, SampleResult[]>();
  for (const r of results) {
    if (!r.called) continue;
    const key = r.model ?? NO_MODEL;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const byModel = [...groups.entries()]
    .map(([model, rows]) => {
      const latencies = rows.map((r) => r.latencyMs);
      return {
        model,
        count: rows.length,
        failures: rows.filter((r) => !r.ok).length,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
      };
    })
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  const called = results.filter((r) => r.called);
  return { byModel, total: { cases: results.length, called: called.length, failures: called.filter((r) => !r.ok).length } };
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const EVM_ADDRESS = /0x[0-9a-fA-F]{40}/g;
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** A last guard on what is written to disk: an email, a wallet address or an id never reaches the output files. */
export function scrub(text: string): string {
  return text.replace(EMAIL, "[email dihapus]").replace(EVM_ADDRESS, "[alamat dihapus]").replace(UUID, "[id dihapus]");
}

/** A validated plan as plain text (names come from the server's candidates, like the page's cards). */
export function renderPlan(recommendations: ValidPlanItem[], names: Map<string, string>): string {
  return recommendations
    .map((r, i) => {
      const lines = [`${i + 1}. ${names.get(r.project_id) ?? "(tanpa nama)"} (${r.minutes_per_day} menit per hari)`];
      for (const reason of r.reasons) lines.push(`   - ${reason.text} [kutipan: "${reason.quote}"]`);
      lines.push(`   Modal: ${r.capital_note}`);
      return lines.join("\n");
    })
    .join("\n");
}

const ms = (value: number | null): string => (value === null ? "-" : String(value));

/** The readable file for the quality review: the summary table first, then one section per case with a score line. */
export function renderMarkdown(results: SampleResult[], summary: Summary, meta: { generatedAt: string }): string {
  const out: string[] = [
    "# Coach samples",
    "",
    `Generated ${meta.generatedAt}. ${summary.total.cases} cases, ${summary.total.called} called a model, ${summary.total.failures} failed.`,
    "",
    "## Summary per model",
    "",
    "| Model | Count | Failures | p50 ms | p95 ms |",
    "|---|---|---|---|---|",
    ...summary.byModel.map((m) => `| ${m.model} | ${m.count} | ${m.failures} | ${ms(m.p50Ms)} | ${ms(m.p95Ms)} |`),
    "",
    "## Cases",
  ];
  for (const r of results) {
    out.push(
      "",
      `### ${r.id}: ${r.label}`,
      "",
      `- Type: ${r.kind}, profile: ${r.profile}, candidates: ${r.candidateCount}`,
      `- Request: ${r.request}`,
      `- Model: ${r.model ?? "-"}`,
      `- Latency: ${r.latencyMs} ms${r.firstTokenMs === null ? "" : ` (first text ${r.firstTokenMs} ms)`}`,
      `- Result: ${r.called ? (r.ok ? "ok" : "FAILED") : "no model called"}`,
      `- Dropped: ${r.dropped ?? "-"}, redactions: ${r.redactions ?? "-"}`,
      ...(r.note === null ? [] : [`- Note: ${r.note}`]),
      "",
      "Shown to the member:",
      "",
      ...(r.shown.trim() === "" ? ["(nothing)"] : r.shown.split("\n").map((line) => `> ${line}`)),
      "",
      "Judgement: [ ] good  [ ] not good",
    );
  }
  return `${out.join("\n")}\n`;
}
