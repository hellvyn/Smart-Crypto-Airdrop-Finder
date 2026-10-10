// Shared plain types for @saf/core. Keep this a types-only module.
export type Status = "live" | "announced" | "speculative" | "ended" | "unknown";
export type DeadlineKind = "claim" | "snapshot" | "campaign_end" | "withdraw_funds" | "tge" | "other";
export type DatePrecision = "exact" | "approximate" | "month" | "quarter";
export type Severity = "critical" | "high" | "medium" | "info";
export type RiskLevel = "low" | "medium" | "high" | "critical" | "insufficient_data";
export interface RiskReason {
  code: string;
  severity: Severity;
  message: string;
  source: string;
}
