// curate(): does a project pass the curated list? (curation spec §6.2). Pure.
import type { CheckId } from "../risk/assess.js";
import { CURATE_MESSAGES as M } from "./messages.js";
import type { CurateInput, CurateResult, CurationReason, NewSignal, Tab } from "./types.js";

/** AI scam patterns (#58) that fail curation on their own. `urgency`, `connect_wallet_to_check`, `other` do not. */
export const STRONG_SCAM_PATTERNS = ["secret_request", "payment_request", "impersonation", "fake_support"] as const;

const KEY_CHECKS: CheckId[] = ["dangerous_asks", "lookalike", "domain_age", "phishing_list"];
const OPEN_TAB: Partial<Record<CurateInput["status"], Tab>> = {
  live: "live_now",
  announced: "live_now",
  speculative: "early_bets",
};
const MIN_LEGIT_TVL_USD = 10_000_000;

const fail = (code: string, message: string): CurationReason => ({ code, message, kind: "fail" });

function isLegitSignal(s: NewSignal): boolean {
  switch (s.kind) {
    case "vc_backer":
    case "coingecko_listed":
      return s.verified;
    case "tvl":
      return s.verified && typeof s.value.tvl_usd === "number" && s.value.tvl_usd >= MIN_LEGIT_TVL_USD;
    case "curated_source":
      return true;
    default:
      return false; // claimed_backer and reported_backer are never verified
  }
}

function keyChecksRan(input: CurateInput): boolean {
  return KEY_CHECKS.every((id) => input.checks.some((c) => c.id === id && c.ran));
}

export function curate(input: CurateInput): CurateResult {
  const isEnded = input.status === "ended";
  const failures: CurationReason[] = [];

  if (isEnded) {
    if (!input.passedBeforeEnd) failures.push(fail("status_not_open", M.status_not_open_ended));
  } else if (!(input.status in OPEN_TAB)) {
    failures.push(fail("status_not_open", M.status_not_open));
  }

  // An ended project may have `insufficient_data` risk: the domain checks can stop working after a campaign ends.
  const riskBad =
    input.riskLevel === "high" ||
    input.riskLevel === "critical" ||
    (!isEnded && (input.riskLevel === "insufficient_data" || input.riskLevel === null));
  if (riskBad) failures.push(fail("risk_too_high", M.risk_too_high));

  if (!isEnded && !input.signals.some(isLegitSignal)) failures.push(fail("no_legit_signal", M.no_legit_signal));
  if (input.lookalikeOf !== null) failures.push(fail("lookalike", M.lookalike));
  if (!isEnded && (!input.hasOfficialDomain || !keyChecksRan(input))) {
    failures.push(fail("insufficient_checks", M.insufficient_checks));
  }
  if (input.aiScamPatterns.some((p) => (STRONG_SCAM_PATTERNS as readonly string[]).includes(p))) {
    failures.push(fail("scam_pattern", M.scam_pattern));
  }

  if (failures.length > 0) return { passed: false, tab: null, reasons: failures };
  if (isEnded) {
    return { passed: true, tab: "ended", reasons: [{ code: "ended_after_curation", message: M.ended_after_curation, kind: "pass" }] };
  }
  return { passed: true, tab: OPEN_TAB[input.status] ?? null, reasons: [{ code: "passed", message: M.passed, kind: "pass" }] };
}
