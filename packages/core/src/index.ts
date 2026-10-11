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
export { CHECK_OF_REASON, assessRisk } from "./risk/assess.js";
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
export { curate, ENDED_SCORING_DAYS, KEY_CHECKS, STRONG_SCAM_PATTERNS } from "./curate/curate.js";
export { worth } from "./curate/worth.js";
export { trackRecord } from "./curate/track-record.js";
export type { TrackRecord, TrackRecordProject } from "./curate/track-record.js";
export { analystSchema, postProcessAnalyst, stepTranslationGrounded, storedAnalystSchema } from "./curate/analyst.js";
export type { AnalystAnswer, AnalystVerdict, StoredAnalyst } from "./curate/analyst.js";
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
export { BANNED_WORDS, cleanStyle, findBanned } from "./style.js";
export { GLOSSARY } from "./coach/glossary.js";
export type { GlossaryEntry } from "./coach/glossary.js";
export { groundedAgainst, redactSensitive } from "./coach/guard.js";
export { COACH_CAPITAL_BANDS, COACH_GOALS, COACH_LEVELS, COACH_MINUTES, coachProfileSchema } from "./coach/profile.js";
export type { CoachProfile } from "./coach/profile.js";
export { MAX_CANDIDATES, selectCandidates } from "./coach/candidates.js";
export type { Candidate } from "./coach/candidates.js";
export { MAX_RECOMMENDATIONS, coachPlanAnswerSchema, validatePlan } from "./coach/plan.js";
export type { CoachPlanAnswer, ValidPlanItem } from "./coach/plan.js";
export { BANNED_LINE_PREFIX, LANGKAH_NOL, buildCoachSystemPrompt } from "./coach/prompt.js";
