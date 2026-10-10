// Public entry point of @saf/core. Later tasks add pure logic exports here.
export { cleanUrl } from "./url/clean.js";
export type { CleanedUrl } from "./url/clean.js";
export { registrableDomain, toUnicodeDomain } from "./url/domain.js";
export { filterUrlsInSource } from "./url/in-source.js";
export type { Status, DeadlineKind, DatePrecision } from "./types.js";
export { extractionSchema } from "./schema/extraction.js";
export type { ExtractionResult, ExtractedDeadline } from "./schema/extraction.js";
export { normalizeDeadline } from "./deadline/normalize.js";
export { normalizeName } from "./entity/name.js";
export { decideMerge } from "./entity/merge.js";
export type { ProjectRef, MergeDecision } from "./entity/merge.js";
export { deriveStatus, pickEvidenceDate } from "./status/derive.js";
export type { StatusEvidence } from "./status/derive.js";
export { isEvmAddress } from "./chain/adapter.js";
export type { ActivitySummary, ChainAdapter } from "./chain/adapter.js";
