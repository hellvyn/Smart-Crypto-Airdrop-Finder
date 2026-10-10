import { randomUUID } from "node:crypto";
import type { ExtractedDeadline, RiskAssessment, RiskLevel, Status, StatusEvidence } from "@saf/core";
import type { CollectedDocument } from "../collectors/types.js";
import type { ExtractionAttempt } from "../llm/extract.js";
import type {
  ExtractionStatus,
  NewProject,
  PipelineRepo,
  ProjectForScoring,
  ProjectRow,
  RunStats,
  StoredDocument,
} from "./repo.js";

const DAY_MS = 86_400_000;

export interface ProjectChange {
  projectId: string;
  field: "status" | "risk_level";
  oldValue: string | null;
  newValue: string;
  changedAt: Date;
}

interface EvidenceRow {
  projectId: string;
  documentId: string;
  field: string;
  value: string;
  quote: string;
  at: Date;
}

interface DeadlineRow extends ExtractedDeadline {
  projectId: string;
  documentId: string;
}

interface TaskRow {
  projectId: string;
  documentId: string;
  description: string;
}

interface LinkRow {
  projectId: string;
  url: string;
  kind: string;
  referralStripped: boolean;
}

interface RiskRow {
  projectId: string;
  level: RiskLevel;
  points: number;
  reasons: RiskAssessment["reasons"];
  checks: RiskAssessment["checks"];
  computedAt: Date;
}

interface RunRow {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  stats: RunStats;
}

interface ExtractionRow extends ExtractionAttempt {
  documentId: string;
  promptVersion: string;
}

/** In-memory `PipelineRepo` with the same semantics as `SupabaseRepo`. Used as the fake in orchestrator tests. */
export class MemoryRepo implements PipelineRepo {
  readonly projectChanges: ProjectChange[] = [];
  readonly extractions: ExtractionRow[] = [];
  readonly deadlines: DeadlineRow[] = [];
  readonly riskAssessments: RiskRow[] = [];
  readonly runs: RunRow[] = [];

  private readonly documents = new Map<string, StoredDocument>();
  private readonly projects = new Map<string, ProjectRow>();
  private readonly evidence: EvidenceRow[] = [];
  private readonly tasks: TaskRow[] = [];
  private readonly links: LinkRow[] = [];

  /** Snapshot of every stored document (test helper). */
  allDocuments(): StoredDocument[] {
    return [...this.documents.values()].map((d) => ({ ...d }));
  }

  private documentByUrl(url: string): StoredDocument | undefined {
    for (const d of this.documents.values()) if (d.url === url) return d;
    return undefined;
  }

  async getDocumentHash(url: string): Promise<string | null> {
    return this.documentByUrl(url)?.contentHash ?? null;
  }

  async upsertDocument(doc: CollectedDocument, contentHash: string): Promise<StoredDocument> {
    const existing = this.documentByUrl(doc.url);
    const stored: StoredDocument = {
      ...doc,
      id: existing?.id ?? randomUUID(),
      contentHash,
      extractionStatus: existing && existing.contentHash === contentHash ? existing.extractionStatus : "pending",
    };
    this.documents.set(stored.id, stored);
    return { ...stored };
  }

  async lastTelegramMessageId(channel: string): Promise<number | null> {
    const prefix = `https://t.me/${channel}/`;
    let max: number | null = null;
    for (const d of this.documents.values()) {
      if (d.sourceKey !== `telegram:${channel}` || !d.url.startsWith(prefix)) continue;
      const rest = d.url.slice(prefix.length);
      if (!/^\d+$/.test(rest)) continue;
      const id = Number(rest);
      if (max === null || id > max) max = id;
    }
    return max;
  }

  async listPendingDocuments(limit: number): Promise<StoredDocument[]> {
    return [...this.documents.values()]
      .filter((d) => d.extractionStatus === "pending")
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async saveExtraction(documentId: string, attempt: ExtractionAttempt, promptVersion: string): Promise<void> {
    this.extractions.push({ ...attempt, documentId, promptVersion });
  }

  async setExtractionStatus(documentId: string, status: ExtractionStatus): Promise<void> {
    const d = this.documents.get(documentId);
    if (d) d.extractionStatus = status;
  }

  async findProjectsByNameKey(nameKey: string): Promise<ProjectRow[]> {
    return [...this.projects.values()].filter((p) => p.nameKey === nameKey).map(cloneProject);
  }

  async createProject(p: NewProject, at: Date): Promise<ProjectRow> {
    for (const existing of this.projects.values()) {
      if (existing.slug === p.slug) throw new Error("duplicate slug");
    }
    const row: ProjectRow = {
      ...p,
      chains: [...p.chains],
      officialDomains: [...p.officialDomains],
      id: randomUUID(),
      firstSeen: at,
      lastSeen: at,
    };
    this.projects.set(row.id, row);
    return cloneProject(row);
  }

  async updateProject(id: string, patch: Partial<ProjectRow>, at: Date): Promise<void> {
    const row = this.projects.get(id);
    if (!row) throw new Error("unknown project");
    const { id: _id, firstSeen: _firstSeen, ...rest } = patch;
    const oldStatus = row.status;
    Object.assign(row, rest, { lastSeen: at });
    if (row.status !== oldStatus) {
      this.projectChanges.push({
        projectId: id,
        field: "status",
        oldValue: oldStatus,
        newValue: row.status,
        changedAt: at,
      });
    }
  }

  async addEvidence(e: EvidenceRow): Promise<void> {
    const duplicate = this.evidence.some(
      (x) =>
        x.projectId === e.projectId && x.documentId === e.documentId && x.field === e.field && x.value === e.value,
    );
    if (!duplicate) this.evidence.push({ ...e });
  }

  async listStatusEvidence(projectId: string): Promise<StatusEvidence[]> {
    return this.evidence
      .filter((e) => e.projectId === projectId && e.field === "status")
      .map((e) => ({ status: e.value as Status, at: e.at }));
  }

  async replaceDeadlines(projectId: string, documentId: string, ds: ExtractedDeadline[]): Promise<void> {
    removeWhere(this.deadlines, (d) => d.projectId === projectId && d.documentId === documentId);
    for (const d of ds) this.deadlines.push({ ...d, projectId, documentId });
  }

  async replaceTasks(projectId: string, documentId: string, tasks: string[]): Promise<void> {
    removeWhere(this.tasks, (t) => t.projectId === projectId && t.documentId === documentId);
    for (const description of tasks) this.tasks.push({ projectId, documentId, description });
  }

  async upsertLinks(
    projectId: string,
    links: { url: string; kind: string; referralStripped: boolean }[],
  ): Promise<void> {
    for (const l of links) {
      const existing = this.links.find((x) => x.projectId === projectId && x.url === l.url);
      if (existing) Object.assign(existing, l);
      else this.links.push({ ...l, projectId });
    }
  }

  async listProjectsForScoring(activeSinceDays: number, now: Date): Promise<ProjectForScoring[]> {
    const cutoff = now.getTime() - activeSinceDays * DAY_MS;
    const result: ProjectForScoring[] = [];
    for (const p of this.projects.values()) {
      if (p.lastSeen.getTime() < cutoff) continue;
      const sourceKeys = new Set<string>();
      for (const e of this.evidence) {
        if (e.projectId !== p.id) continue;
        const d = this.documents.get(e.documentId);
        if (d) sourceKeys.add(d.sourceKey);
      }
      result.push({
        ...cloneProject(p),
        tasks: this.tasks.filter((t) => t.projectId === p.id).map((t) => t.description),
        links: this.links.filter((l) => l.projectId === p.id).map((l) => ({ url: l.url, kind: l.kind })),
        sourceCount: sourceKeys.size,
      });
    }
    return result;
  }

  async latestRiskLevel(projectId: string): Promise<RiskLevel | null> {
    let latest: RiskRow | null = null;
    for (const r of this.riskAssessments) {
      if (r.projectId !== projectId) continue;
      if (latest === null || r.computedAt.getTime() >= latest.computedAt.getTime()) latest = r;
    }
    return latest?.level ?? null;
  }

  async saveRiskAssessment(projectId: string, a: RiskAssessment, at: Date): Promise<void> {
    const previous = await this.latestRiskLevel(projectId);
    this.riskAssessments.push({
      projectId,
      level: a.level,
      points: a.points,
      reasons: a.reasons,
      checks: a.checks,
      computedAt: at,
    });
    if (previous !== a.level) {
      this.projectChanges.push({
        projectId,
        field: "risk_level",
        oldValue: previous,
        newValue: a.level,
        changedAt: at,
      });
    }
  }

  async startRun(at: Date): Promise<string> {
    const id = randomUUID();
    this.runs.push({ id, startedAt: at, finishedAt: null, stats: {} });
    return id;
  }

  async finishRun(runId: string, stats: RunStats, at: Date): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new Error("unknown run");
    run.finishedAt = at;
    run.stats = { ...stats };
  }

  async purgeDocumentText(olderThanDays: number, now: Date): Promise<number> {
    const cutoff = now.getTime() - olderThanDays * DAY_MS;
    let purged = 0;
    for (const d of this.documents.values()) {
      if (d.fetchedAt.getTime() < cutoff && d.text !== "") {
        d.text = "";
        purged += 1;
      }
    }
    return purged;
  }
}

function cloneProject(p: ProjectRow): ProjectRow {
  return { ...p, chains: [...p.chains], officialDomains: [...p.officialDomains] };
}

function removeWhere<T>(arr: T[], pred: (x: T) => boolean): void {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i] as T)) arr.splice(i, 1);
  }
}
