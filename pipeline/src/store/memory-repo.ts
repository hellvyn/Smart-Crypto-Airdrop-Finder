import { randomUUID } from "node:crypto";
import type {
  AiKind,
  CurationRecord,
  ExtractedDeadline,
  LinkCheckStatus,
  NewSignal,
  RiskAssessment,
  RiskLevel,
  Status,
  StatusEvidence,
} from "@saf/core";
import type { CollectedDocument, SourceKind } from "../collectors/types.js";
import type { RaisePage } from "../enrich/alphadrops-raises.js";
import type { ExtractionAttempt } from "../llm/extract.js";
import { FACT_FIELDS, curatedChange, endedScoringSince, publicFailReason } from "./repo.js";
import type {
  ClaimPage,
  ExtractionStatus,
  LinkCheck,
  NewAiAnalysis,
  NewEvidence,
  NewProject,
  PipelineRepo,
  ProjectForScoring,
  ProjectRow,
  RunStats,
  SignalKeep,
  Step,
  StoredAiAnalysis,
  StoredDocument,
} from "./repo.js";

const DAY_MS = 86_400_000;

export interface ProjectChange {
  projectId: string;
  field: "status" | "risk_level" | "curated";
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
  position: number;
  cadence: Step["cadence"];
  textId: string | null;
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

interface SignalRow extends NewSignal {
  projectId: string;
  observedAt: Date;
}

interface CurationRow extends CurationRecord {
  projectId: string;
  publicFailReason: string | null;
  computedAt: Date;
}

interface VcPortfolioRow {
  vcId: string;
  domain: string;
  fetchedAt: Date;
}

/** In-memory `PipelineRepo` with the same semantics as `SupabaseRepo`. Used as the fake in orchestrator tests. */
export class MemoryRepo implements PipelineRepo {
  readonly projectChanges: ProjectChange[] = [];
  readonly extractions: ExtractionRow[] = [];
  readonly deadlines: DeadlineRow[] = [];
  readonly riskAssessments: RiskRow[] = [];
  readonly runs: RunRow[] = [];
  readonly signals: SignalRow[] = [];
  readonly curations: CurationRow[] = [];
  readonly aiAnalyses: StoredAiAnalysis[] = [];

  private readonly documents = new Map<string, StoredDocument>();
  private readonly projects = new Map<string, ProjectRow>();
  private readonly evidence: EvidenceRow[] = [];
  private readonly tasks: TaskRow[] = [];
  private readonly links: LinkRow[] = [];
  private readonly vcPortfolios: VcPortfolioRow[] = [];
  private readonly alphaRaises = new Map<string, RaisePage & { fetchedAt: Date }>();
  readonly linkChecks = new Map<string, LinkCheck>();
  readonly claimPages = new Map<string, ClaimPage>();

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

  async replaceTasks(projectId: string, documentId: string, steps: Step[]): Promise<void> {
    removeWhere(this.tasks, (t) => t.projectId === projectId && t.documentId === documentId);
    steps.forEach((step, position) =>
      this.tasks.push({ projectId, documentId, description: step.text, position, cadence: step.cadence, textId: null }),
    );
  }

  /** The project's tasks in step order (document id, position). */
  private projectTasks(projectId: string): TaskRow[] {
    return this.tasks
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => compareText(a.documentId, b.documentId) || a.position - b.position);
  }

  async saveStepTranslations(projectId: string, texts: string[]): Promise<void> {
    const tasks = this.projectTasks(projectId);
    if (tasks.length !== texts.length) return;
    tasks.forEach((t, i) => {
      t.textId = texts[i] ?? null;
    });
  }

  /** `text_id` of the project's tasks in step order (test helper). */
  stepTextIds(projectId: string): (string | null)[] {
    return this.projectTasks(projectId).map((t) => t.textId);
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
    const endedSince = endedScoringSince(now);
    const result: ProjectForScoring[] = [];
    for (const p of this.projects.values()) {
      if (p.lastSeen.getTime() < cutoff) {
        const latest = p.status === "ended" ? await this.latestCuration(p.id) : null;
        const endedOn = latest?.passed ? latest.endedOn : null;
        if (endedOn === null || endedOn < endedSince) continue;
      }
      const sourceKeys = new Set<string>();
      const sourceKinds = new Set<SourceKind>();
      for (const e of this.evidence) {
        if (e.projectId !== p.id) continue;
        const d = this.documents.get(e.documentId);
        if (d) {
          sourceKeys.add(d.sourceKey);
          sourceKinds.add(d.sourceKind);
        }
      }
      const other = p.lookalikeOf === null ? undefined : this.projects.get(p.lookalikeOf);
      // Order: document_id, position (same as SupabaseRepo).
      const steps = this.projectTasks(p.id).map((t) => ({ text: t.description, cadence: t.cadence }));
      result.push({
        ...cloneProject(p),
        tasks: steps.map((s) => s.text),
        steps,
        // Insertion order, same as SupabaseRepo's evidence.seq.
        facts: this.evidence
          .filter((e) => e.projectId === p.id && FACT_FIELDS.includes(e.field))
          .map((e) => ({ field: e.field, value: e.value, quote: e.quote })),
        deadlines: this.deadlines
          .filter((d) => d.projectId === p.id)
          .map((d) => ({ kind: d.kind, date: d.date, precision: d.precision })),
        links: this.links.filter((l) => l.projectId === p.id).map((l) => ({ url: l.url, kind: l.kind })),
        sourceCount: sourceKeys.size,
        sourceKinds: [...sourceKinds].sort(compareText),
        lookalikeOfName: other?.name ?? null,
        lookalikeOfDomains: other ? [...other.officialDomains] : [],
        // Insertion order, same as SupabaseRepo's evidence.seq.
        sourceAsks: this.evidence
          .filter((e) => e.projectId === p.id && e.field === "dangerous_ask")
          .map((e) => ({ code: e.value, quote: e.quote })),
        signals: this.signals
          .filter((s) => s.projectId === p.id)
          .map(({ kind, value, source, verified, observedAt }) => ({
            kind,
            value: structuredClone(value),
            source,
            verified,
            observedAt,
          })),
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

  async replaceSignals(
    projectId: string,
    signals: NewSignal[],
    at: Date,
    keep: readonly SignalKeep[] = [],
  ): Promise<void> {
    const kept = (s: SignalRow): boolean =>
      keep.some((k) => {
        if (typeof k === "string") return k === s.source;
        if (k.source !== s.source) return false;
        return "kind" in k ? s.kind === k.kind : s.value.investor === k.investor;
      });
    // Delete first, as SupabaseRepo does: a refused insert leaves the project with only the kept signals.
    removeWhere(this.signals, (s) => s.projectId === projectId && !kept(s));
    // Same rules as the project_signals check constraint and unique index.
    const keyOf = (s: NewSignal) => JSON.stringify([s.kind, s.source, investorKey(s.value)]);
    const keys = new Set(this.signals.filter((s) => s.projectId === projectId).map(keyOf));
    for (const s of signals) {
      if ((s.kind === "claimed_backer" || s.kind === "reported_backer") && s.verified) {
        throw new Error("verified backer claim");
      }
      const key = keyOf(s);
      if (keys.has(key)) throw new Error("duplicate signal");
      keys.add(key);
    }
    for (const s of signals) this.signals.push({ ...s, projectId, observedAt: at });
  }

  async listVcPortfolio(vcId: string): Promise<{ domains: string[]; fetchedAt: Date | null }> {
    const rows = this.vcPortfolios.filter((r) => r.vcId === vcId);
    return {
      domains: rows.map((r) => r.domain).sort(compareText),
      fetchedAt: rows.reduce<Date | null>((min, r) => (min === null || r.fetchedAt < min ? r.fetchedAt : min), null),
    };
  }

  async saveVcPortfolio(vcId: string, domains: string[], at: Date): Promise<void> {
    removeWhere(this.vcPortfolios, (r) => r.vcId === vcId);
    for (const domain of new Set(domains)) this.vcPortfolios.push({ vcId, domain, fetchedAt: at });
  }

  async listAlphaRaise(slug: string): Promise<(RaisePage & { fetchedAt: Date }) | null> {
    const row = this.alphaRaises.get(slug);
    // A deep copy, as a database read would give.
    return row === undefined ? null : structuredClone(row);
  }

  async saveAlphaRaise(slug: string, page: RaisePage, at: Date): Promise<void> {
    this.alphaRaises.set(slug, structuredClone({ officialDomain: page.officialDomain, rounds: page.rounds, fetchedAt: at }));
  }

  async listProjectSourceTexts(projectId: string): Promise<{ url: string; text: string }[]> {
    const documentIds = new Set(this.evidence.filter((e) => e.projectId === projectId).map((e) => e.documentId));
    return [...documentIds]
      .flatMap((id) => {
        const d = this.documents.get(id);
        return d && d.text !== "" ? [{ url: d.url, text: d.text }] : [];
      })
      .sort((a, b) => compareText(a.url, b.url));
  }

  async latestAiAnalysis(projectId: string, kind: AiKind): Promise<StoredAiAnalysis | null> {
    const latest = latestBy(
      this.aiAnalyses.filter((a) => a.projectId === projectId && a.kind === kind),
      (a) => a.createdAt,
    );
    return latest ? { ...latest } : null;
  }

  async saveAiAnalysis(a: NewAiAnalysis): Promise<void> {
    this.aiAnalyses.push({ ...a });
  }

  async latestCuration(projectId: string): Promise<{ passed: boolean; endedOn: string | null } | null> {
    const latest = latestBy(
      this.curations.filter((c) => c.projectId === projectId),
      (c) => c.computedAt,
    );
    return latest ? { passed: latest.passed, endedOn: latest.endedOn } : null;
  }

  async passedBeforeEnd(projectId: string): Promise<boolean> {
    const latest = latestBy(
      this.curations.filter((c) => c.projectId === projectId && c.statusAt !== "ended"),
      (c) => c.computedAt,
    );
    return latest?.passed ?? false;
  }

  async saveCuration(projectId: string, c: CurationRecord, at: Date): Promise<void> {
    const previous = await this.latestCuration(projectId);
    this.curations.push({
      projectId,
      passed: c.passed,
      worthLevel: c.worthLevel,
      worthPoints: c.worthPoints,
      tab: c.tab,
      statusAt: c.statusAt,
      endedOn: c.endedOn,
      reasons: c.reasons,
      coverage: c.coverage,
      publicFailReason: publicFailReason(c.passed, c.reasons),
      computedAt: at,
    });
    const change = curatedChange(previous?.passed ?? null, c.passed);
    if (change) this.projectChanges.push({ projectId, field: "curated", ...change, changedAt: at });
  }

  async saveLinkCheck(url: string, status: LinkCheckStatus, at: Date): Promise<void> {
    this.linkChecks.set(url, { url, status, checkedAt: at });
  }

  async listLinkChecks(urls: string[]): Promise<LinkCheck[]> {
    return rowsOf(this.linkChecks, urls);
  }

  async saveClaimPage(url: string, text: string, at: Date): Promise<void> {
    this.claimPages.set(url, { url, text, fetchedAt: at });
  }

  async listClaimPages(urls: string[]): Promise<ClaimPage[]> {
    return rowsOf(this.claimPages, urls);
  }
}

/** Copies of the rows stored under `urls` (missing ones left out), ordered by url. */
function rowsOf<T extends { url: string }>(rows: ReadonlyMap<string, T>, urls: string[]): T[] {
  return [...new Set(urls)]
    .flatMap((url) => {
      const row = rows.get(url);
      return row === undefined ? [] : [{ ...row }];
    })
    .sort((a, b) => compareText(a.url, b.url));
}

/** `coalesce(value->>'investor', '')`, the investor part of the project_signals unique index. */
function investorKey(value: Record<string, unknown>): string {
  const investor = value.investor;
  if (investor === undefined || investor === null) return "";
  return typeof investor === "string" ? investor : JSON.stringify(investor);
}

/** Row with the greatest date; a later row wins ties (insertion order, like the `seq` tie-break in Postgres). */
function latestBy<T>(rows: T[], date: (row: T) => Date): T | null {
  let latest: T | null = null;
  for (const row of rows) {
    if (latest === null || date(row).getTime() >= date(latest).getTime()) latest = row;
  }
  return latest;
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
