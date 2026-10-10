// Public entry point of @saf/core. Later tasks add pure logic exports here.
export { cleanUrl } from "./url/clean.js";
export type { CleanedUrl } from "./url/clean.js";
export { registrableDomain, toUnicodeDomain } from "./url/domain.js";
export { filterUrlsInSource } from "./url/in-source.js";
export type { Status, DeadlineKind, DatePrecision } from "./types.js";
export { extractionSchema } from "./schema/extraction.js";
export type { ExtractionResult, ExtractedDeadline } from "./schema/extraction.js";
export { normalizeDeadline } from "./deadline/normalize.js";
