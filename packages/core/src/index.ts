// Public entry point of @saf/core. Later tasks add pure logic exports here.
export { cleanUrl } from "./url/clean.js";
export type { CleanedUrl } from "./url/clean.js";
export { registrableDomain, toUnicodeDomain } from "./url/domain.js";
export { filterUrlsInSource } from "./url/in-source.js";
export type { Status, DeadlineKind, DatePrecision } from "./types.js";
export { extractionSchema, quoteInSource } from "./schema/extraction.js";
export type { ExtractionResult, ExtractedDeadline } from "./schema/extraction.js";
export { normalizeDeadline } from "./deadline/normalize.js";
export { normalizeName } from "./entity/name.js";
export { decideMerge } from "./entity/merge.js";
export type { ProjectRef, MergeDecision } from "./entity/merge.js";
export { deriveStatus, pickEvidenceDate } from "./status/derive.js";
export type { StatusEvidence } from "./status/derive.js";
export { expireStatus } from "./status/expire.js";
export type { ExpireDeadline, ExpireResult } from "./status/expire.js";
export { isEvmAddress } from "./chain/adapter.js";
export type { ActivitySummary, ChainAdapter } from "./chain/adapter.js";
export type { Severity, RiskLevel, RiskReason } from "./types.js";
export { DANGEROUS_ASK_CODES, detectDangerousAsks, findDangerousAskSentences } from "./risk/dangerous-asks.js";
export type { DangerousAskCode } from "./risk/dangerous-asks.js";
export { isLookalike } from "./risk/lookalike.js";
export { assessRisk } from "./risk/assess.js";
export { classifyLink } from "./risk/claim-links.js";
export type { ClaimLink, LinkCheckStatus } from "./risk/claim-links.js";
export type { CheckId, RiskCheck, RiskInput, RiskAssessment } from "./risk/assess.js";
export { buildHeatmap, daysLeft, heatmapRange, localDay, mainProgress, streak, weeklyDone } from "./farming/tracker.js";
export type { HeatLevel, HeatmapCell, HeatmapRange, TrackerCheck, TrackerTask } from "./farming/tracker.js";
export { domainMatches } from "./curate/domain-match.js";
export type {
  AiKind,
  CurateInput,
  CurateResult,
  CurationReason,
  CurationRecord,
  NewSignal,
  SignalKind,
  SignalSource,
  Tab,
  WorthInput,
  WorthLevel,
  WorthResult,
} from "./curate/types.js";
export { curate, STRONG_SCAM_PATTERNS } from "./curate/curate.js";
export { worth } from "./curate/worth.js";
export { analystSchema, postProcessAnalyst } from "./curate/analyst.js";
export type { AnalystAnswer, AnalystVerdict } from "./curate/analyst.js";
export { FORBIDDEN_PHRASES, forbiddenPhrases, replaceEmDash } from "./curate/ai-style.js";
export {
  SCAM_PATTERNS,
  aiFlagsFromAnalyses,
  contradictionsSchema,
  postProcessContradictions,
  postProcessScam,
  scamSchema,
} from "./curate/ai-flags.js";
export type { ContradictionsAnswer, ScamAnswer } from "./curate/ai-flags.js";
