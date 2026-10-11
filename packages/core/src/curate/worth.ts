// worth(): potential relative to effort (curation spec §6.3). Pure. Weights are a calibration starting point.
import { WORTH_MESSAGES as M } from "./messages.js";
import type { CurationReason, NewSignal, WorthInput, WorthLevel, WorthResult } from "./types.js";

const REPORTED_BACKER_MIN_USD = 5_000_000;
const TVL_HIGH_USD = 10_000_000;
const TVL_VERY_HIGH_USD = 100_000_000;
const MANY_TASKS = 8;

const AI_POINTS = { garap: 0, pantau: -1, skip: -2 } as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function levelFor(points: number): WorthLevel {
  if (points >= 4) return "high";
  if (points >= 2) return "medium";
  return "low";
}

export function worth(input: WorthInput): WorthResult {
  const reasons: CurationReason[] = [];
  let points = 0;
  const add = (code: string, message: string, delta: number) => {
    points += delta;
    reasons.push({ code, message, kind: "worth" });
  };
  const verified = (kind: NewSignal["kind"]) => input.signals.filter((s) => s.kind === kind && s.verified);

  // Backer: verified VC and reported funding are not summed, the highest wins.
  const vcTiers = verified("vc_backer").map((s) => Number(s.value.tier));
  const reportedBacked = input.signals.some(
    (s) => s.kind === "reported_backer" && (num(s.value.amount_usd) ?? 0) >= REPORTED_BACKER_MIN_USD,
  );
  if (vcTiers.length > 0) {
    if (vcTiers.includes(1)) add("vc_backer", M.vc_backer_tier1, 3);
    else add("vc_backer", M.vc_backer, 2);
  } else if (reportedBacked) {
    add("reported_backer", M.reported_backer, 1);
  }

  const maxTvl = Math.max(0, ...verified("tvl").map((s) => num(s.value.tvl_usd) ?? 0));
  if (maxTvl >= TVL_VERY_HIGH_USD) add("tvl_very_high", M.tvl_very_high, 2);
  else if (maxTvl >= TVL_HIGH_USD) add("tvl_high", M.tvl_high, 1);

  const listed = input.signals.some((s) => s.kind === "coingecko_listed");
  if (!listed && !input.tgePassed) add("no_token_yet", M.no_token_yet, 2);

  if (input.sourceCount > 1) add("multiple_sources", M.multiple_sources, 1);

  if (input.capitalRequired === "high") add("capital_high", M.capital_high, -2);
  else if (input.capitalRequired === "low") add("capital_low", M.capital_low, -1);
  else if (input.capitalRequired === "unknown") reasons.push({ code: "capital_unknown", message: M.capital_unknown, kind: "worth" });

  if (input.taskCount > MANY_TASKS) add("many_tasks", M.many_tasks, -1);

  // `vcTiers` / `reportedBacked` / `maxTvl` / `listed` are the potential signals; `curated_source` alone is not one.
  const hasPotentialSignal = vcTiers.length > 0 || reportedBacked || maxTvl >= TVL_HIGH_USD || listed;

  // AI can only lower (spec §13): every entry of AI_POINTS is <= 0.
  if (input.aiVerdict === "pantau") add("ai_pantau", M.ai_pantau, AI_POINTS.pantau);
  else if (input.aiVerdict === "skip") add("ai_skip", M.ai_skip, AI_POINTS.skip);

  const level: WorthLevel = !hasPotentialSignal && input.capitalRequired === "unknown" ? "insufficient_data" : levelFor(points);
  return { level, points, reasons };
}
