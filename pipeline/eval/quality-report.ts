import { pathToFileURL } from "node:url";
import type { Tab } from "@saf/core";
import type { RunStats } from "../src/store/repo.js";
import { latestPerProject, serviceClientFromEnv } from "./supabase-read.js";

/** What the report needs of the latest curation of one project. */
export interface CurationFacts {
  passed: boolean;
  /** All four key safety checks (`dangerous_asks`, `lookalike`, `domain_age`, `phishing_list`) ran in the latest assessment. */
  keyChecksRan: boolean;
  tab: Tab | null;
}

export interface GateResult {
  id: string;
  label: string;
  /** Target as written in spec sections 12 and 13. */
  target: string;
  /** G1 and G2 are fractions (0.9 = 90%), G3 a count, G9 a count per run. null = not measurable. */
  value: number | null;
  pass: boolean;
  /** How the value came about, or why it could not be measured. */
  detail: string;
}

/** Gates the report cannot compute from the database, with the tool that measures each (spec sections 12, 13). */
const MANUAL_GATES: readonly { id: string; label: string; target: string; how: string }[] = [
  { id: "G4", label: "Akurasi status LLM", target: "≥ 90% di ≥ 30 kasus", how: "pnpm --filter pipeline eval" },
  { id: "G5", label: "Akurasi tanggal + jenis deadline", target: "≥ 90%", how: "pnpm --filter pipeline eval" },
  { id: "G6", label: "URL halusinasi", target: "0", how: "pnpm --filter pipeline eval" },
  { id: "G7", label: "Scam dari set uji yang lolos kurasi", target: "0 dari ≥ 30", how: "eval/scam-set/run.ts" },
  { id: "G8", label: "Airdrop legit dari set uji yang tersembunyi", target: "≤ 20%", how: "eval/scam-set/run.ts" },
  { id: "G10", label: "Urutan worth disetujui owner", target: "top 20 per tab di-review", how: "eval/worth-review.ts, lalu catat di spec 6.3" },
  { id: "G11", label: "Tesis AI Analyst direview owner", target: "≥ 20 sampel, ≥ 80% masuk akal", how: "eval/ai-samples.ts" },
  { id: "G12", label: "AI Scam Analyst di set uji scam", target: "menandai ≥ 80% scam; gak pernah menurunkan level risiko", how: "belum ada alat" },
  { id: "G13", label: "Kualitas Bahasa Indonesia output AI", target: "owner review ≥ 20 sampel", how: "eval/ai-samples.ts" },
  { id: "G14", label: "Kapasitas provider untuk Coach", target: "diukur sebelum Coach dibuka", how: "diukur sebelum Coach dibuka" },
];

/** Runs the averaged gates need: "rata-rata 3 run terakhir" (spec section 12). */
const RUNS_NEEDED = 3;
const G1_MIN = 0.8;
const G2_MIN = 0.95;
const G9_MIN = 5;
const KEY_CHECKS = ["dangerous_asks", "lookalike", "domain_age", "phishing_list"];

/** True when all four key safety checks of an assessment ran (curation spec 6.2 item 5). */
export function keyChecksRan(checks: readonly { id: string; ran: boolean }[]): boolean {
  return KEY_CHECKS.every((id) => checks.some((c) => c.id === id && c.ran));
}

const counter = (run: RunStats, key: string): number => run[key] ?? 0;
/** Hides float noise such as 0.8000000000000002, so a value that is exactly on target passes. */
const clean = (n: number): number => Math.round(n * 1e9) / 1e9;
const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** Mean over the runs that have a denominator of `numerator / denominator`; null when none has. */
function meanRatio(runs: readonly RunStats[], numerator: string, denominator: string): number | null {
  const ratios = runs.filter((r) => counter(r, denominator) > 0).map((r) => counter(r, numerator) / counter(r, denominator));
  return ratios.length === 0 ? null : clean(mean(ratios));
}

const notEnoughRuns = (runs: readonly RunStats[]): string | null =>
  runs.length < RUNS_NEEDED ? `only ${runs.length} of the ${RUNS_NEEDED} runs the target averages over` : null;

/**
 * G1, G2, G3 and G9 (spec section 12). `runs` are the last 3 finished `pipeline_runs.stats`; fewer than 3 fail the run
 * based gates, since the target is an average of 3 (an unmeasured gate must not look met). `curations` is the latest
 * curation of every project. An empty list fails G3 for the same reason.
 *
 * G1 is approximated by `projects_with_official_domain / assessed`: the stats do not split the scored projects by
 * status, so speculative and ended projects are in the denominator. G2 is the weaker of the `domain_age` and
 * `phishing_list` coverage (the other two key checks need no network and always run).
 */
export function computeGates(runs: readonly RunStats[], curations: readonly CurationFacts[]): GateResult[] {
  const shortRuns = notEnoughRuns(runs);

  const g1 = meanRatio(runs, "projects_with_official_domain", "assessed");
  const age = meanRatio(runs, "domain_age_ran", "projects_with_official_domain");
  const phishing = meanRatio(runs, "phishing_list_ran", "projects_with_official_domain");
  const g2 = age === null || phishing === null ? null : Math.min(age, phishing);
  const g9 = runs.length === 0 ? null : clean(mean(runs.map((r) => counter(r, "curation_passed_live_now"))));
  const uncheckedPassed = curations.filter((c) => c.passed && c.tab !== "ended" && !c.keyChecksRan).length;

  const runGate = (value: number | null, min: number, detail: string): Pick<GateResult, "value" | "pass" | "detail"> => ({
    value,
    pass: shortRuns === null && value !== null && value >= min,
    detail: shortRuns ?? (value === null ? "no run had projects to measure" : detail),
  });

  return [
    {
      id: "G1",
      label: "Cakupan domain resmi project",
      target: "≥ 80%",
      ...runGate(g1, G1_MIN, "projects_with_official_domain / assessed, all scored projects (not only live/announced)"),
    },
    {
      id: "G2",
      label: "Cek kunci jalan untuk project ber-domain",
      target: "≥ 95%",
      ...runGate(
        g2,
        G2_MIN,
        `domain_age ${age === null ? "n/a" : percent(age)}, phishing_list ${phishing === null ? "n/a" : percent(phishing)}; the weaker one counts`,
      ),
    },
    {
      id: "G3",
      label: "Project tampil tanpa 4 cek kunci",
      target: "0",
      value: uncheckedPassed,
      pass: curations.length > 0 && uncheckedPassed === 0,
      detail:
        curations.length === 0
          ? "no curations to check"
          : `${uncheckedPassed} of ${curations.filter((c) => c.passed).length} passing curations (ended tab exempt)`,
    },
    {
      id: "G9",
      label: "Isi list: project lolos di Live now",
      target: "≥ 5 rata-rata 3 run",
      ...runGate(g9, G9_MIN, `average of curation_passed_live_now over ${runs.length} runs`),
    },
  ];
}

const formatValue = (g: GateResult): string => {
  if (g.value === null) return "n/a";
  return g.id === "G1" || g.id === "G2" ? percent(g.value) : String(g.value);
};

/** Every gate of spec sections 12 and 13, in number order: computed ones with their result, the rest as manual. */
export function formatGateTable(computed: readonly GateResult[]): string {
  const rows = [
    ...computed.map((g) => ({
      n: Number(g.id.slice(1)),
      line: `${g.id.padEnd(4)} ${g.label} | target ${g.target} | ${formatValue(g)} | ${g.pass ? "PASS" : "FAIL"} | ${g.detail}`,
    })),
    ...MANUAL_GATES.map((g) => ({
      n: Number(g.id.slice(1)),
      line: `${g.id.padEnd(4)} ${g.label} | target ${g.target} | manual, not measured here | ${g.how}`,
    })),
  ].sort((a, b) => a.n - b.n);
  return rows.map((r) => r.line).join("\n");
}

async function main(): Promise<number> {
  const db = serviceClientFromEnv();
  if (db === null) {
    console.error("quality-report needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    return 2;
  }
  const { data: runRows, error } = await db
    .from("pipeline_runs")
    .select("stats")
    .not("finished_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(RUNS_NEEDED)
    .overrideTypes<{ stats: RunStats }[], { merge: false }>();
  if (error) throw new Error(`reading pipeline_runs failed (${error.code ?? "no code"})`);

  const [curations, assessments] = await Promise.all([
    latestPerProject<{ project_id: string; passed: boolean; tab: Tab | null }>(db, "curations", "project_id, passed, tab, computed_at, seq", "computed_at"),
    latestPerProject<{ project_id: string; checks: { id: string; ran: boolean }[] }>(db, "risk_assessments", "project_id, checks, computed_at, seq", "computed_at"),
  ]);
  const checksOf = new Map(assessments.map((a) => [a.project_id, a.checks]));
  const facts: CurationFacts[] = curations.map((c) => ({
    passed: c.passed,
    tab: c.tab,
    keyChecksRan: keyChecksRan(checksOf.get(c.project_id) ?? []),
  }));

  console.log(`Quality gates (runs used: ${runRows.length}, projects with a curation: ${facts.length})`);
  console.log(formatGateTable(computeGates(runRows.map((r) => r.stats), facts)));
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
