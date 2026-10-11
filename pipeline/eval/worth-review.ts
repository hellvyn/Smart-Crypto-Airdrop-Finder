import { pathToFileURL } from "node:url";
import type { CurationReason, Tab, WorthLevel } from "@saf/core";
import { latestPerProject, readProjects, serviceClientFromEnv } from "./supabase-read.js";

const TOP_N = 20;
const TABS: readonly Tab[] = ["live_now", "early_bets", "ended"];
const WORTH_ORDER: readonly (WorthLevel | null)[] = ["high", "medium", "low", "insufficient_data", null];

/** A project on the curated list, as far as the owner's review needs it. */
export interface ReviewRow {
  name: string;
  tab: Tab;
  worthLevel: WorthLevel | null;
  reasons: CurationReason[];
  /** ISO timestamp of the project's `last_seen`. */
  lastSeen: string;
}

/**
 * The first `n` projects of each tab, in the order of curation spec 6.3 as far as the stored data allows: worth level
 * (`high` first), then newest `last_seen`. The spec's other tie-breakers (strongest signal, nearest deadline) are applied
 * by the list itself; for this review only the worth order is judged.
 */
export function topPerTab(rows: readonly ReviewRow[], n: number): Record<Tab, ReviewRow[]> {
  const byTab = (tab: Tab): ReviewRow[] =>
    rows
      .filter((r) => r.tab === tab)
      .sort(
        (a, b) =>
          WORTH_ORDER.indexOf(a.worthLevel) - WORTH_ORDER.indexOf(b.worthLevel) ||
          b.lastSeen.localeCompare(a.lastSeen) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, n);
  return { live_now: byTab("live_now"), early_bets: byTab("early_bets"), ended: byTab("ended") };
}

/**
 * Text for the owner's review (gate G10): per tab, each project's name, worth level and the worth reasons that gave
 * it. The point total is not stored in `curations` (only the reasons are), so it is not printed.
 */
export function formatWorthReview(top: Record<Tab, ReviewRow[]>): string {
  const lines: string[] = [];
  for (const tab of TABS) {
    lines.push(`\n== ${tab} (top ${TOP_N}) ==`);
    if (top[tab].length === 0) lines.push("  (none)");
    top[tab].forEach((r, i) => {
      lines.push(`${String(i + 1).padStart(2)}. ${r.name}  ${r.worthLevel ?? "no worth level"}`);
      for (const reason of r.reasons.filter((x) => x.kind === "worth")) lines.push(`      - ${reason.message}`);
    });
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const db = serviceClientFromEnv();
  if (db === null) {
    console.error("worth-review needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    return 2;
  }
  const [curations, projects] = await Promise.all([
    latestPerProject<{ project_id: string; passed: boolean; tab: Tab | null; worth_level: WorthLevel | null; reasons: CurationReason[] }>(
      db,
      "curations",
      "project_id, passed, tab, worth_level, reasons, computed_at, seq",
      "computed_at",
    ),
    readProjects(db),
  ]);
  const rows: ReviewRow[] = [];
  for (const c of curations) {
    const project = projects.get(c.project_id);
    if (!c.passed || c.tab === null || project === undefined) continue;
    rows.push({ name: project.name, tab: c.tab, worthLevel: c.worth_level, reasons: c.reasons, lastSeen: project.last_seen });
  }
  console.log(`Curated list: ${rows.length} projects. Mark the ones whose order makes no sense, then record the final weights in spec 6.3.`);
  console.log(formatWorthReview(topPerTab(rows, TOP_N)));
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
