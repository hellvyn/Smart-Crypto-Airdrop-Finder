import { randomUUID } from "node:crypto";
import type { DigestProject, ExtractedDeadline, RiskAssessment, RiskLevel, Status, StatusEvidence } from "@saf/core";
import type { CollectedDocument } from "../collectors/types.js";
import type { ExtractionAttempt } from "../llm/extract.js";
import { DuplicateDigestError } from "./repo.js";
import type {
  DigestContext,
  DigestRecipient,
  ExtractionStatus,
  NewEvidence,
  NewProject,
  PipelineRepo,
  ProjectForScoring,
  ProjectRow,
  RunStats,
  StoredDocument,
} from "./repo.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface ProjectChange {
  projectId: string;
  field: "status" | "risk_level";
  oldValue: string | null;
  newValue: string;
  changedAt: Date;
}

interface EvidenceRow extends NewEvidence {
  /** `documents.url` of `documentId`, copied at insert (a trigger does this in Postgres). */
  sourceUrl: string;
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

/** An auth user plus their profile (the two are joined by user id in Postgres). */
interface UserRow {
  userId: string;
  email: string;
  emailConfirmed: boolean;
  digestEnabled: boolean;
  newAirdropsOptIn: boolean;
  unsubscribeToken: string;
}

export interface NotificationLogRow {
  userId: string;
  kind: "digest";
  refDate: string;
  sentAt: Date;
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
  readonly notificationLog: NotificationLogRow[] = [];

  private readonly documents = new Map<string, StoredDocument>();
  private readonly projects = new Map<string, ProjectRow>();
  private readonly evidence: EvidenceRow[] = [];
  private readonly tasks: TaskRow[] = [];
  private readonly links: LinkRow[] = [];
  private readonly users: UserRow[] = [];
  private readonly watchlist: { userId: string; projectId: string }[] = [];

  /**
   * Test-only: adds an auth user with a profile (in Postgres the signup trigger creates the profile). Defaults:
   * email confirmed, digest on, new airdrops off, random unsubscribe token. Returns the user id.
   */
  seedTestUser(u: {
    email: string;
    emailConfirmed?: boolean;
    digestEnabled?: boolean;
    newAirdropsOptIn?: boolean;
    unsubscribeToken?: string;
  }): string {
    const userId = randomUUID();
    this.users.push({
      userId,
      email: u.email,
      emailConfirmed: u.emailConfirmed ?? true,
      digestEnabled: u.digestEnabled ?? true,
      newAirdropsOptIn: u.newAirdropsOptIn ?? false,
      unsubscribeToken: u.unsubscribeToken ?? randomUUID(),
    });
    return userId;
  }

  /** Test-only: adds a project to a user's watchlist (ignored when already watched). */
  seedTestWatch(userId: string, projectId: string): void {
    if (!this.users.some((u) => u.userId === userId)) throw new Error("unknown user");
    if (!this.projects.has(projectId)) throw new Error("unknown project");
    if (this.watchlist.some((w) => w.userId === userId && w.projectId === projectId)) return;
    this.watchlist.push({ userId, projectId });
  }

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
    // Order: fetched_at asc, url asc (same as SupabaseRepo).
    return [...this.documents.values()]
      .filter((d) => d.extractionStatus === "pending" && d.text !== "")
      .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime() || compareText(a.url, b.url))
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
    // Order: first_seen asc, slug asc (same as SupabaseRepo).
    return [...this.projects.values()]
      .filter((p) => p.nameKey === nameKey)
      .sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime() || compareText(a.slug, b.slug))
      .map(cloneProject);
  }

  async slugExists(slug: string): Promise<boolean> {
    for (const p of this.projects.values()) if (p.slug === slug) return true;
    return false;
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

  async addEvidence(e: NewEvidence): Promise<void> {
    const document = this.documents.get(e.documentId);
    if (!document) throw new Error("unknown document");
    const duplicate = this.evidence.some(
      (x) =>
        x.projectId === e.projectId && x.documentId === e.documentId && x.field === e.field && x.value === e.value,
    );
    if (!duplicate) this.evidence.push({ ...e, sourceUrl: document.url });
  }

  async deleteEvidence(projectId: string, documentId: string, field: string): Promise<void> {
    removeWhere(this.evidence, (e) => e.projectId === projectId && e.documentId === documentId && e.field === field);
  }

  async listStatusEvidence(projectId: string): Promise<StatusEvidence[]> {
    // Order: at asc, insertion order breaks ties (Array.sort is stable). SupabaseRepo orders by at, seq.
    return this.evidence
      .filter((e) => e.projectId === projectId && e.field === "status")
      .sort((a, b) => a.at.getTime() - b.at.getTime())
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
      const other = p.lookalikeOf === null ? undefined : this.projects.get(p.lookalikeOf);
      result.push({
        ...cloneProject(p),
        tasks: this.tasks.filter((t) => t.projectId === p.id).map((t) => t.description),
        links: this.links.filter((l) => l.projectId === p.id).map((l) => ({ url: l.url, kind: l.kind })),
        sourceCount: sourceKeys.size,
        lookalikeOfName: other?.name ?? null,
        lookalikeOfDomains: other ? [...other.officialDomains] : [],
        // Insertion order, same as SupabaseRepo's evidence.seq.
        sourceAsks: this.evidence
          .filter((e) => e.projectId === p.id && e.field === "dangerous_ask")
          .map((e) => ({ code: e.value, quote: e.quote })),
      });
    }
    return result;
  }

  async latestRiskLevel(projectId: string): Promise<RiskLevel | null> {
    let latest: RiskRow | null = null;
    for (const r of this.riskAssessments) {
      if (r.projectId !== projectId) continue;
      if (latest === null || r.computedAt.getTime() >= latest.computedAt.getTime() /* ties: later insert wins */) latest = r;
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

  async listDigestRecipients(): Promise<DigestRecipient[]> {
    return this.users
      .filter((u) => u.emailConfirmed && u.digestEnabled)
      .sort((a, b) => compareText(a.userId, b.userId))
      .map((u) => {
        let lastDigestAt: Date | null = null;
        for (const l of this.notificationLog) {
          if (l.userId !== u.userId || l.kind !== "digest") continue;
          if (lastDigestAt === null || l.sentAt.getTime() > lastDigestAt.getTime()) lastDigestAt = l.sentAt;
        }
        return {
          userId: u.userId,
          email: u.email,
          newAirdropsOptIn: u.newAirdropsOptIn,
          unsubscribeToken: u.unsubscribeToken,
          lastDigestAt,
        };
      });
  }

  private async digestProject(p: ProjectRow): Promise<DigestProject> {
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      riskLevel: await this.latestRiskLevel(p.id),
      firstSeen: p.firstSeen,
    };
  }

  async getDigestContext(userId: string, since: Date | null, now: Date): Promise<DigestContext> {
    const ids = new Set(this.watchlist.filter((w) => w.userId === userId).map((w) => w.projectId));
    const projects = [...this.projects.values()]
      .filter((p) => ids.has(p.id))
      .sort((a, b) => compareText(a.id, b.id));
    const watched: DigestProject[] = [];
    for (const p of projects) watched.push(await this.digestProject(p));

    const deadlines: DigestContext["deadlines"] = [];
    for (const d of this.deadlines) {
      if (!ids.has(d.projectId) || d.date === null) continue;
      deadlines.push({ projectId: d.projectId, kind: d.kind, date: d.date, precision: d.precision, text: d.text });
    }
    deadlines.sort(
      (a, b) => compareText(a.date, b.date) || compareText(a.projectId, b.projectId) || compareText(a.kind, b.kind),
    );

    const cutoff = (since ?? new Date(now.getTime() - 24 * HOUR_MS)).getTime();
    // changed_at, then insertion order (stable sort), same as SupabaseRepo's changed_at, seq.
    const changes = this.projectChanges
      .filter((c) => ids.has(c.projectId) && c.changedAt.getTime() > cutoff)
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
      .map((c) => ({ ...c }));

    return { lastDigestAt: since, watched, deadlines, changes };
  }

  async listNewProjects(sinceHours: number, now: Date): Promise<DigestProject[]> {
    const cutoff = now.getTime() - sinceHours * HOUR_MS;
    const projects = [...this.projects.values()]
      .filter((p) => p.firstSeen.getTime() >= cutoff)
      .sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime() || compareText(a.id, b.id));
    const out: DigestProject[] = [];
    for (const p of projects) out.push(await this.digestProject(p));
    return out;
  }

  async countDigestsSent(refDate: string): Promise<number> {
    return this.notificationLog.filter((l) => l.kind === "digest" && l.refDate === refDate).length;
  }

  async hasDigest(userId: string, refDate: string): Promise<boolean> {
    return this.notificationLog.some((l) => l.userId === userId && l.kind === "digest" && l.refDate === refDate);
  }

  async logDigest(userId: string, refDate: string, at: Date): Promise<void> {
    if (await this.hasDigest(userId, refDate)) throw new DuplicateDigestError();
    this.notificationLog.push({ userId, kind: "digest", refDate, sentAt: at });
  }
}

function cloneProject(p: ProjectRow): ProjectRow {
  return { ...p, chains: [...p.chains], officialDomains: [...p.officialDomains] };
}

/** Code-unit comparison. Matches Postgres ordering of `documents.url` (declared `collate "C"`) and slugs for ASCII text. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function removeWhere<T>(arr: T[], pred: (x: T) => boolean): void {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i] as T)) arr.splice(i, 1);
  }
}
