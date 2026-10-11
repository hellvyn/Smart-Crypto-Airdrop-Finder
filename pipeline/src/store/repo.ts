import type {
  AiKind,
  CurationReason,
  CurationRecord,
  DatePrecision,
  DeadlineKind,
  ExtractedDeadline,
  ExtractionResult,
  LinkCheckStatus,
  NewSignal,
  RiskAssessment,
  RiskLevel,
  SignalKind,
  SignalSource,
  Status,
  StatusEvidence,
  TrackRecordProject,
} from "@saf/core";
import type { CollectedDocument, SourceKind } from "../collectors/types.js";
import type { RaisePage } from "../enrich/alphadrops-raises.js";
import type { ExtractionAttempt } from "../llm/extract.js";

/** `merge_failed`: extracted, but merging threw; it goes back to `pending` only when its hash changes. */
export type ExtractionStatus = "pending" | "done" | "not_airdrop" | "merge_failed";

export interface StoredDocument extends CollectedDocument {
  id: string;
  contentHash: string;
  extractionStatus: ExtractionStatus;
}

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  nameKey: string;
  tokenSymbol: string | null;
  chains: string[];
  officialDomains: string[];
  status: Status;
  conflict: boolean;
  lookalikeOf: string | null;
  firstSeen: Date;
  lastSeen: Date;
}

/** Numeric counters only. Never put free text, emails or wallet addresses in here (spec section 9). */
export interface RunStats {
  [counter: string]: number;
}

export type NewProject = Omit<ProjectRow, "id" | "firstSeen" | "lastSeen">;

/**
 * Signals a `replaceSignals` leaves in place: every signal of a source, the signals of a source whose
 * `value.investor` is the given name (e.g. the `vc_backer` of a VC whose portfolio was not checked this run), or the
 * signals of one kind from a source (e.g. AlphaDrops `reported_backer`, while its `curated_source` is rewritten).
 */
export type SignalKeep =
  | SignalSource
  | { source: SignalSource; investor: string }
  | { source: SignalSource; kind: SignalKind };

/** One extracted step (`tasks` row): done once, or repeated daily or weekly. */
export interface Step {
  text: string;
  cadence: "once" | "daily" | "weekly";
}

/** A v3 extraction fact, stored as an `evidence` row of one of the `FACT_FIELDS`. */
export interface Fact {
  field: string;
  value: string;
  quote: string;
}

type ExtractedProject = ExtractionResult["projects"][number];
// Records keyed by the schema's name enums, so a name added to the extraction schema fails to compile here until
// it is listed (and its stale evidence is replaced like the others).
const KEY_PARAMETER_NAMES: Record<ExtractedProject["key_parameters"][number]["name"], true> = {
  allocation: true,
  distribution: true,
  tge: true,
};
const SOURCE_RATING_NAMES: Record<ExtractedProject["source_ratings"][number]["name"], true> = {
  difficulty: true,
  cost: true,
};

/**
 * Evidence fields holding v3 extraction facts (curation spec §4.6): `key_parameter:<name>` and
 * `source_rating:<name>` (value + quote), `latest_update` (value = date or "", quote = the update sentence),
 * `claimed_backer` (value = investor), `capital_required` (value = level) and `capital_min_usd` (value = number
 * as text); the last two have no quote ("").
 */
export const FACT_FIELDS: readonly string[] = [
  ...Object.keys(KEY_PARAMETER_NAMES).map((name) => `key_parameter:${name}`),
  ...Object.keys(SOURCE_RATING_NAMES).map((name) => `source_rating:${name}`),
  "latest_update",
  "claimed_backer",
  "capital_required",
  "capital_min_usd",
];

export interface ProjectForScoring extends ProjectRow {
  /** Texts of `steps`, in the same order. */
  tasks: string[];
  /** Steps grouped by contributing document, in step order (`position`) within each document. */
  steps: { text: string; cadence: string }[];
  /** Evidence rows of the `FACT_FIELDS`, in insertion order. */
  facts: Fact[];
  /** Every stored deadline of the project, from all documents. `date` is `YYYY-MM-DD` or null. */
  deadlines: { kind: DeadlineKind; date: string | null; precision: DatePrecision }[];
  links: { url: string; kind: string }[];
  /** Number of distinct document source keys among the project's evidence. */
  sourceCount: number;
  /** Distinct `source_kind`s of the documents among the project's evidence, sorted. */
  sourceKinds: SourceKind[];
  /** Name of the `lookalikeOf` project (null when there is none). */
  lookalikeOfName: string | null;
  /** Official domains of the `lookalikeOf` project ([] when there is none). */
  lookalikeOfDomains: string[];
  /** `dangerous_ask` evidence (value = ask code, quote = source sentence), in insertion order. */
  sourceAsks: { code: string; quote: string }[];
  /** Stored `project_signals` rows, each with when it was last checked; in no particular order. */
  signals: StoredSignal[];
}

/** One stored `project_signals` row. */
export interface StoredSignal extends NewSignal {
  observedAt: Date;
}

export interface NewEvidence {
  projectId: string;
  documentId: string;
  field: string;
  value: string;
  quote: string;
  at: Date;
}

/** One `ai_analyses` row (history: the latest per project and kind wins). `result` is the post-processed JSON. */
export interface NewAiAnalysis {
  projectId: string;
  kind: AiKind;
  /** Hash of the analysis input; an unchanged hash and prompt version means the cached analysis is reused. */
  inputHash: string;
  result: unknown;
  /** Configured model id that answered. */
  model: string;
  /** Model the provider reported serving, when it said. */
  servedModel: string | null;
  promptVersion: string;
  createdAt: Date;
}

export type StoredAiAnalysis = NewAiAnalysis;

/** One `link_checks` row (#42): the latest check status of a claim/app link. Public read. */
export interface LinkCheck {
  url: string;
  status: LinkCheckStatus;
  checkedAt: Date;
}

/** One `claim_pages` row (#56): the text of a claim portal page as last fetched. Service role only. */
export interface ClaimPage {
  url: string;
  /** Page text after HTML-to-text (`claimPageText`); "" when the page had no text without running its scripts. */
  text: string;
  fetchedAt: Date;
}

/**
 * `curations.public_fail_reason` (#55): the message of the first `fail` reason, readable by anonymous visitors.
 * Null for a passing curation.
 */
export function publicFailReason(passed: boolean, reasons: CurationReason[]): string | null {
  if (passed) return null;
  return reasons.find((r) => r.kind === "fail")?.message ?? null;
}

/**
 * The `curated` project change a new curation causes: a `passed` flip, or a first curation that passes (old value
 * null). Null when nothing changes.
 */
export function curatedChange(
  previousPassed: boolean | null,
  passed: boolean,
): { oldValue: string | null; newValue: string } | null {
  if (previousPassed === passed || (previousPassed === null && !passed)) return null;
  return { oldValue: previousPassed === null ? null : String(previousPassed), newValue: String(passed) };
}

/**
 * Days after `ended_on` that a project whose latest curation passed is still scored (curation spec §5.3: the claim
 * period is when fake claim sites appear); after that its last result is frozen.
 */
export const ENDED_SCORING_DAYS = 90;

/** The earliest `ended_on` (`YYYY-MM-DD`) still scored on the UTC day of `now`. */
export function endedScoringSince(now: Date): string {
  return new Date(now.getTime() - ENDED_SCORING_DAYS * 86_400_000).toISOString().slice(0, 10);
}

export interface PipelineRepo {
  getDocumentHash(url: string): Promise<string | null>;
  /** Insert or update by URL. A changed hash resets the extraction status to "pending"; the same hash keeps it. */
  upsertDocument(doc: CollectedDocument, contentHash: string): Promise<StoredDocument>;
  /** Highest message id stored for a channel (documents `https://t.me/<channel>/<id>`), or null. */
  lastTelegramMessageId(channel: string): Promise<number | null>;
  /** Pending documents with non-empty text (purged ones are skipped), oldest `fetched_at` first, then by url. */
  listPendingDocuments(limit: number): Promise<StoredDocument[]>;
  saveExtraction(documentId: string, attempt: ExtractionAttempt, promptVersion: string): Promise<void>;
  setExtractionStatus(documentId: string, status: ExtractionStatus): Promise<void>;
  findProjectsByNameKey(nameKey: string): Promise<ProjectRow[]>;
  /** True when any project (whatever its name key) already uses this slug. */
  slugExists(slug: string): Promise<boolean>;
  createProject(p: NewProject, at: Date): Promise<ProjectRow>;
  /** Always bumps `lastSeen` to `at`. A status change also writes a `project_changes` row. */
  updateProject(id: string, patch: Partial<ProjectRow>, at: Date): Promise<void>;
  /**
   * Ignored when the same (project, document, field, value) already exists. The stored row also gets
   * `source_url` = the document's url, copied at insert so readers can link the source without reading
   * documents.
   */
  addEvidence(e: NewEvidence): Promise<void>;
  /** Deletes the evidence of one field that one document contributed to one project. */
  deleteEvidence(projectId: string, documentId: string, field: string): Promise<void>;
  /** Evidence rows with field "status", as input for `deriveStatus`. */
  listStatusEvidence(projectId: string): Promise<StatusEvidence[]>;
  /** Replaces the deadlines this document contributed to the project. */
  replaceDeadlines(projectId: string, documentId: string, ds: ExtractedDeadline[]): Promise<void>;
  /**
   * Replaces the steps (`tasks` rows) this document contributed to the project; `position` = index in `steps`. The
   * new rows have no `text_id` (their translation comes with the next Analyst analysis).
   */
  replaceTasks(projectId: string, documentId: string, steps: Step[]): Promise<void>;
  /**
   * Stores the Indonesian text of each of the project's steps (`tasks.text_id`, #45): `texts[i]` goes to the i-th
   * task in step order (document id, then position; the order of `ProjectForScoring.steps`). Writes nothing when
   * `texts` and the project's tasks differ in number.
   */
  saveStepTranslations(projectId: string, texts: string[]): Promise<void>;
  upsertLinks(
    projectId: string,
    links: { url: string; kind: string; referralStripped: boolean }[],
  ): Promise<void>;
  /**
   * Projects with `lastSeen` within `activeSinceDays` of `now`, and, however long ago they were last seen: the `ended`
   * projects whose latest curation passed with an `ended_on` at most `ENDED_SCORING_DAYS` before the UTC day of `now`
   * (curation spec §5.3), and the open projects whose latest curation passed (no `ended_on`) and that have a passing
   * open curation computed within `activeSinceDays`, so a listed project is re-checked until it fails or ends.
   */
  listProjectsForScoring(activeSinceDays: number, now: Date): Promise<ProjectForScoring[]>;
  latestRiskLevel(projectId: string): Promise<RiskLevel | null>;
  /** Appends a history row. A level change (or the first assessment) also writes a `project_changes` row. */
  saveRiskAssessment(projectId: string, a: RiskAssessment, at: Date): Promise<void>;
  startRun(at: Date): Promise<string>;
  finishRun(runId: string, stats: RunStats, at: Date): Promise<void>;
  /** Blanks the text of documents fetched more than `olderThanDays` ago (hash stays). Returns how many were blanked. */
  purgeDocumentText(olderThanDays: number, now: Date): Promise<number>;
  /**
   * Deletes every signal of the project except the kept ones (from a source, or an investor of a source, not checked
   * this run: its last signals stay, with their own `observed_at`), then stores `signals` with `observed_at` = `at`.
   * Throws on two signals with the same (kind, source, investor), kept ones included, or a verified
   * `claimed_backer`/`reported_backer`; not atomic, so the project is then left with only the kept signals until the
   * next successful replace.
   */
  replaceSignals(projectId: string, signals: NewSignal[], at: Date, keep?: readonly SignalKeep[]): Promise<void>;
  /** Cached portfolio domains of one VC (sorted) and when they were fetched; `fetchedAt` null when none are cached. */
  listVcPortfolio(vcId: string): Promise<{ domains: string[]; fetchedAt: Date | null }>;
  /** Replaces the VC's cached domains, all fetched at `at`. */
  saveVcPortfolio(vcId: string, domains: string[], at: Date): Promise<void>;
  /** The cached AlphaDrops raise page of one slug (`alphadrops_raises`) and when it was fetched; null when none. */
  listAlphaRaise(slug: string): Promise<(RaisePage & { fetchedAt: Date }) | null>;
  /** Inserts or replaces the cached raise page of one slug, fetched at `at`. */
  saveAlphaRaise(slug: string, page: RaisePage, at: Date): Promise<void>;
  /**
   * The AI analysis sources of a project: every document that gave the project evidence and whose text is not purged,
   * each once, ordered by url.
   */
  listProjectSourceTexts(projectId: string): Promise<{ url: string; text: string }[]>;
  /** Latest analysis of one kind (greatest `createdAt`, later insert wins ties), or null. */
  latestAiAnalysis(projectId: string, kind: AiKind): Promise<StoredAiAnalysis | null>;
  saveAiAnalysis(a: NewAiAnalysis): Promise<void>;
  /** Latest curation (greatest `computed_at`, later insert wins ties), or null. */
  latestCuration(projectId: string): Promise<{ passed: boolean; endedOn: string | null } | null>;
  /** True when the latest curation computed while the project was not `ended` passed; false when there is none. */
  passedBeforeEnd(projectId: string): Promise<boolean>;
  /**
   * Appends a history row with `public_fail_reason` (see `publicFailReason`). A `passed` flip, or a first curation
   * that passes, also writes a `project_changes` row with field `curated` (see `curatedChange`).
   */
  saveCuration(projectId: string, c: CurationRecord, at: Date): Promise<void>;
  /**
   * Every project with at least one passing curation, as `trackRecord()` (#43) needs it: `firstPassAt` and
   * `listedAtFirstPass` from the first passing curation (earliest `computed_at`, earlier insert wins ties), `tab` of the
   * latest curation, `coingeckoListed` = a verified `coingecko_listed` signal is stored now, `riskRaisedAfterPass` = a
   * `high`/`critical` risk assessment computed after the first pass. In no particular order.
   */
  listCurationHistoryForTrackRecord(): Promise<(TrackRecordProject & { projectId: string })[]>;
  /** Inserts or replaces the check of one claim/app link (`link_checks`, url is the key), checked at `at`. */
  saveLinkCheck(url: string, status: LinkCheckStatus, at: Date): Promise<void>;
  /** The stored checks of these URLs (URLs never checked are left out), ordered by url. */
  listLinkChecks(urls: string[]): Promise<LinkCheck[]>;
  /** Inserts or replaces the cached text of one claim portal page (`claim_pages`, url is the key), fetched at `at`. */
  saveClaimPage(url: string, text: string, at: Date): Promise<void>;
  /** The cached claim portal pages of these URLs (URLs never fetched are left out), ordered by url. */
  listClaimPages(urls: string[]): Promise<ClaimPage[]>;
}
