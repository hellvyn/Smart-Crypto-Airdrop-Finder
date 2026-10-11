// Curation and signal types (curation spec §4.1-4.2). Types only; `curate()` and `worth()` build on them.
import type { RiskCheck } from "../risk/assess.js";
import type { RiskLevel, Status } from "../types.js";

/** List tab of a passing project (#40): `ended` holds projects that ended after they passed. */
export type Tab = "live_now" | "early_bets" | "ended";
export type WorthLevel = "high" | "medium" | "low" | "insufficient_data";

/** One reason of a curation result. `message` is Indonesian UI text. */
export interface CurationReason {
  code: string;
  message: string;
  kind: "pass" | "fail" | "worth";
}

/** `project_signals.kind`. `claimed_backer` and `reported_backer` are never verified. */
export type SignalKind =
  | "vc_backer"
  | "tvl"
  | "coingecko_listed"
  | "curated_source"
  | "claimed_backer"
  | "reported_backer";
export type SignalSource = "vc_portfolio" | "defillama" | "airdrops_io" | "telegram" | "llm_text" | "alphadrops";

/** One `project_signals` row before it is stored. Backer kinds carry `value.investor`. */
export interface NewSignal {
  kind: SignalKind;
  value: Record<string, unknown>;
  source: SignalSource;
  verified: boolean;
}

export type AiKind = "analyst" | "scam" | "contradictions";

/** One `curations` row before it is stored. `endedOn` is a `YYYY-MM-DD` date. */
export interface CurationRecord {
  passed: boolean;
  worthLevel: WorthLevel | null;
  tab: Tab | null;
  statusAt: Status;
  endedOn: string | null;
  reasons: CurationReason[];
  coverage: Record<string, boolean>;
}

/** Everything `curate()` needs (curation spec §6.2). Pure data, no I/O. */
export interface CurateInput {
  /** Status after `expireStatus`. */
  status: Status;
  /** Latest risk level; null = not assessed yet. */
  riskLevel: RiskLevel | null;
  checks: RiskCheck[];
  lookalikeOf: string | null;
  hasOfficialDomain: boolean;
  signals: NewSignal[];
  /** The latest curation with `status_at` other than `ended` has `passed = true`. */
  passedBeforeEnd: boolean;
  /** Patterns of AI scam flags whose quote passed `quoteInSource`. */
  aiScamPatterns: string[];
}

export interface CurateResult {
  passed: boolean;
  /** Always null when `passed` is false. */
  tab: Tab | null;
  reasons: CurationReason[];
}

/** Everything `worth()` needs (curation spec §6.3). */
export interface WorthInput {
  signals: NewSignal[];
  /** A `tge` deadline is already in the past. */
  tgePassed: boolean;
  /** Number of independent sources that mention the project. */
  sourceCount: number;
  capitalRequired: "none" | "low" | "high" | "unknown";
  taskCount: number;
  /** Analyst verdict, null when there is no analysis yet. It can only lower the result. */
  aiVerdict: "garap" | "pantau" | "skip" | null;
}

export interface WorthResult {
  level: WorthLevel;
  points: number;
  reasons: CurationReason[];
}
