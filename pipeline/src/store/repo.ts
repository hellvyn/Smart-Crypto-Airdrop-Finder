import type {
  DigestInput,
  DigestProject,
  ExtractedDeadline,
  RiskAssessment,
  RiskLevel,
  Status,
  StatusEvidence,
} from "@saf/core";
import type { CollectedDocument } from "../collectors/types.js";
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

export interface ProjectForScoring extends ProjectRow {
  tasks: string[];
  links: { url: string; kind: string }[];
  /** Number of distinct document source keys among the project's evidence. */
  sourceCount: number;
  /** Name of the `lookalikeOf` project (null when there is none). */
  lookalikeOfName: string | null;
  /** Official domains of the `lookalikeOf` project ([] when there is none). */
  lookalikeOfDomains: string[];
  /** `dangerous_ask` evidence (value = ask code, quote = source sentence), in insertion order. */
  sourceAsks: { code: string; quote: string }[];
}

export interface NewEvidence {
  projectId: string;
  documentId: string;
  field: string;
  value: string;
  quote: string;
  at: Date;
}

/** A user who gets the daily digest: digest enabled and email confirmed. Never logged or put in stats. */
export interface DigestRecipient {
  userId: string;
  email: string;
  newAirdropsOptIn: boolean;
  unsubscribeToken: string;
  /** Greatest `sent_at` of the user's digest log rows; null when they never got one. */
  lastDigestAt: Date | null;
}

/** The per-user part of a `DigestInput`. */
export type DigestContext = Omit<DigestInput, "now" | "newProjects">;

/** `logDigest` hit the (user, kind, ref_date) unique key: a digest for that day is already logged. */
export class DuplicateDigestError extends Error {
  constructor() {
    super("digest already logged for this day");
    this.name = "DuplicateDigestError";
  }
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
  /** Replaces the tasks this document contributed to the project. */
  replaceTasks(projectId: string, documentId: string, tasks: string[]): Promise<void>;
  upsertLinks(
    projectId: string,
    links: { url: string; kind: string; referralStripped: boolean }[],
  ): Promise<void>;
  /** Projects with `lastSeen` within `activeSinceDays` of `now`. */
  listProjectsForScoring(activeSinceDays: number, now: Date): Promise<ProjectForScoring[]>;
  latestRiskLevel(projectId: string): Promise<RiskLevel | null>;
  /** Appends a history row. A level change (or the first assessment) also writes a `project_changes` row. */
  saveRiskAssessment(projectId: string, a: RiskAssessment, at: Date): Promise<void>;
  startRun(at: Date): Promise<string>;
  finishRun(runId: string, stats: RunStats, at: Date): Promise<void>;
  /** Blanks the text of documents fetched more than `olderThanDays` ago (hash stays). Returns how many were blanked. */
  purgeDocumentText(olderThanDays: number, now: Date): Promise<number>;

  /** Users with `digest_enabled` and a confirmed email (auth.users), ordered by user id. */
  listDigestRecipients(): Promise<DigestRecipient[]>;
  /**
   * The user's watched projects (by id, with their latest risk level), those projects' deadlines that have a
   * date (by date, project id, kind), and their `project_changes` with `changed_at` after `since`, or within the
   * 24 hours before `now` when `since` is null (oldest first; insertion order breaks ties). `lastDigestAt` is `since`.
   */
  getDigestContext(userId: string, since: Date | null, now: Date): Promise<DigestContext>;
  /** Projects with `first_seen` at or after `now - sinceHours`, oldest first then by id, with their latest risk level. */
  listNewProjects(sinceHours: number, now: Date): Promise<DigestProject[]>;
  /** Digest log rows for this UTC date (`YYYY-MM-DD`), whoever they belong to. */
  countDigestsSent(refDate: string): Promise<number>;
  hasDigest(userId: string, refDate: string): Promise<boolean>;
  /** Logs a sent digest. Throws `DuplicateDigestError` when one is already logged for that user and date. */
  logDigest(userId: string, refDate: string, at: Date): Promise<void>;
}
