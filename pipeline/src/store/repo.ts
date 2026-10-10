import type { ExtractedDeadline, RiskAssessment, RiskLevel, Status, StatusEvidence } from "@saf/core";
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
}

export interface PipelineRepo {
  getDocumentHash(url: string): Promise<string | null>;
  /** Insert or update by URL. A changed hash resets the extraction status to "pending"; the same hash keeps it. */
  upsertDocument(doc: CollectedDocument, contentHash: string): Promise<StoredDocument>;
  /** Highest message id stored for a channel (documents `https://t.me/<channel>/<id>`), or null. */
  lastTelegramMessageId(channel: string): Promise<number | null>;
  listPendingDocuments(limit: number): Promise<StoredDocument[]>;
  saveExtraction(documentId: string, attempt: ExtractionAttempt, promptVersion: string): Promise<void>;
  setExtractionStatus(documentId: string, status: ExtractionStatus): Promise<void>;
  findProjectsByNameKey(nameKey: string): Promise<ProjectRow[]>;
  /** True when any project (whatever its name key) already uses this slug. */
  slugExists(slug: string): Promise<boolean>;
  createProject(p: NewProject, at: Date): Promise<ProjectRow>;
  /** Always bumps `lastSeen` to `at`. A status change also writes a `project_changes` row. */
  updateProject(id: string, patch: Partial<ProjectRow>, at: Date): Promise<void>;
  addEvidence(e: {
    projectId: string;
    documentId: string;
    field: string;
    value: string;
    quote: string;
    at: Date;
  }): Promise<void>;
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
}
