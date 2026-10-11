// Curation and signal types (curation spec §4.1-4.2). Types only; `curate()` and `worth()` build on them.
import type { Status } from "../types.js";

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
