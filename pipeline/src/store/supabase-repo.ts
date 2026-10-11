import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiKind,
  CurationRecord,
  ExtractedDeadline,
  NewSignal,
  RiskAssessment,
  RiskLevel,
  Status,
  StatusEvidence,
} from "@saf/core";
import type { CollectedDocument, SourceKind } from "../collectors/types.js";
import type { ExtractionAttempt } from "../llm/extract.js";
import { FACT_FIELDS, curatedChange, publicFailReason } from "./repo.js";
import type {
  ExtractionStatus,
  NewAiAnalysis,
  NewEvidence,
  NewProject,
  PipelineRepo,
  ProjectForScoring,
  ProjectRow,
  RunStats,
  Step,
  StoredAiAnalysis,
  StoredDocument,
} from "./repo.js";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 1000;

interface DocumentDb {
  id: string;
  source_kind: SourceKind;
  source_key: string;
  url: string;
  text: string;
  content_hash: string;
  published_at: string | null;
  page_updated_at: string | null;
  fetched_at: string;
  extraction_status: ExtractionStatus;
}

interface ProjectDb {
  id: string;
  slug: string;
  name: string;
  name_key: string;
  token_symbol: string | null;
  chains: string[];
  official_domains: string[];
  status: Status;
  conflict: boolean;
  lookalike_of: string | null;
  first_seen: string;
  last_seen: string;
}

const PROJECT_COLUMNS =
  "id, slug, name, name_key, token_symbol, chains, official_domains, status, conflict, lookalike_of, first_seen, last_seen";

const toDate = (value: string | null): Date | null => (value === null ? null : new Date(value));
const toIso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function toDocument(r: DocumentDb): StoredDocument {
  return {
    id: r.id,
    sourceKind: r.source_kind,
    sourceKey: r.source_key,
    url: r.url,
    text: r.text,
    contentHash: r.content_hash,
    publishedAt: toDate(r.published_at),
    pageUpdatedAt: toDate(r.page_updated_at),
    fetchedAt: new Date(r.fetched_at),
    extractionStatus: r.extraction_status,
  };
}

function toProject(r: ProjectDb): ProjectRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    nameKey: r.name_key,
    tokenSymbol: r.token_symbol,
    chains: r.chains,
    officialDomains: r.official_domains,
    status: r.status,
    conflict: r.conflict,
    lookalikeOf: r.lookalike_of,
    firstSeen: new Date(r.first_seen),
    lastSeen: new Date(r.last_seen),
  };
}

/** Throws a plain Error naming the operation; never includes row values beyond what Supabase reports. */
function check<T>(op: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`supabase ${op} failed: ${result.error.message}`);
  return result.data;
}

/** Like `check`, for queries that must return a row (`.single()`). */
function checkOne<T>(op: string, result: { data: T | null; error: { message: string } | null }): T {
  const data = check(op, result);
  if (data === null) throw new Error(`supabase ${op} returned no row`);
  return data;
}

/** `PipelineRepo` backed by Supabase. Must use the service-role key (writes bypass RLS). */
export class SupabaseRepo implements PipelineRepo {
  constructor(private readonly db: SupabaseClient) {}

  /** Reads every page of a query (PostgREST caps a single response at 1000 rows). */
  private async fetchAll<Row>(
    op: string,
    page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const data = check(op, await page(from, from + PAGE_SIZE - 1)) ?? [];
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  async getDocumentHash(url: string): Promise<string | null> {
    const row = check(
      "getDocumentHash",
      await this.db.from("documents").select("content_hash").eq("url", url).maybeSingle<{ content_hash: string }>(),
    );
    return row?.content_hash ?? null;
  }

  async upsertDocument(doc: CollectedDocument, contentHash: string): Promise<StoredDocument> {
    const existing = check(
      "upsertDocument.lookup",
      await this.db
        .from("documents")
        .select("content_hash")
        .eq("url", doc.url)
        .maybeSingle<{ content_hash: string }>(),
    );
    const payload: Record<string, unknown> = {
      source_kind: doc.sourceKind,
      source_key: doc.sourceKey,
      url: doc.url,
      text: doc.text,
      content_hash: contentHash,
      published_at: toIso(doc.publishedAt),
      page_updated_at: toIso(doc.pageUpdatedAt),
      fetched_at: doc.fetchedAt.toISOString(),
    };
    // Same hash keeps the stored status (column omitted); new or changed content goes back to pending.
    if (!existing || existing.content_hash !== contentHash) payload.extraction_status = "pending";
    const row = checkOne(
      "upsertDocument",
      await this.db.from("documents").upsert(payload, { onConflict: "url" }).select().single<DocumentDb>(),
    );
    return toDocument(row);
  }

  async lastTelegramMessageId(channel: string): Promise<number | null> {
    const prefix = `https://t.me/${channel}/`;
    const rows = await this.fetchAll<{ url: string }>("lastTelegramMessageId", (from, to) =>
      this.db
        .from("documents")
        .select("url")
        .eq("source_key", `telegram:${channel}`)
        .order("url")
        .range(from, to),
    );
    let max: number | null = null;
    for (const { url } of rows) {
      if (!url.startsWith(prefix)) continue;
      const rest = url.slice(prefix.length);
      if (!/^\d+$/.test(rest)) continue;
      const id = Number(rest);
      if (max === null || id > max) max = id;
    }
    return max;
  }

  async listPendingDocuments(limit: number): Promise<StoredDocument[]> {
    const rows = checkOne(
      "listPendingDocuments",
      await this.db
        .from("documents")
        .select()
        .eq("extraction_status", "pending")
        // Purged documents stay pending but have nothing to extract.
        .neq("text", "")
        .order("fetched_at")
        .order("url")
        .limit(limit)
        .returns<DocumentDb[]>(),
    );
    return rows.map(toDocument);
  }

  async saveExtraction(documentId: string, attempt: ExtractionAttempt, promptVersion: string): Promise<void> {
    check(
      "saveExtraction",
      await this.db.from("extractions").insert({
        document_id: documentId,
        model: attempt.model,
        served_model: attempt.servedModel,
        prompt_version: promptVersion,
        raw: attempt.raw,
        http_status: attempt.httpStatus,
        finish_reason: attempt.finishReason,
        latency_ms: Math.round(attempt.latencyMs),
        error: attempt.error,
      }),
    );
  }

  async setExtractionStatus(documentId: string, status: ExtractionStatus): Promise<void> {
    check(
      "setExtractionStatus",
      await this.db.from("documents").update({ extraction_status: status }).eq("id", documentId),
    );
  }

  async findProjectsByNameKey(nameKey: string): Promise<ProjectRow[]> {
    const rows = checkOne(
      "findProjectsByNameKey",
      await this.db
        .from("projects")
        .select(PROJECT_COLUMNS)
        .eq("name_key", nameKey)
        .order("first_seen")
        .order("slug")
        .returns<ProjectDb[]>(),
    );
    return rows.map(toProject);
  }

  async slugExists(slug: string): Promise<boolean> {
    const row = check(
      "slugExists",
      await this.db.from("projects").select("id").eq("slug", slug).limit(1).maybeSingle<{ id: string }>(),
    );
    return row !== null;
  }

  async createProject(p: NewProject, at: Date): Promise<ProjectRow> {
    const row = checkOne(
      "createProject",
      await this.db
        .from("projects")
        .insert({
          slug: p.slug,
          name: p.name,
          name_key: p.nameKey,
          token_symbol: p.tokenSymbol,
          chains: p.chains,
          official_domains: p.officialDomains,
          status: p.status,
          conflict: p.conflict,
          lookalike_of: p.lookalikeOf,
          first_seen: at.toISOString(),
          last_seen: at.toISOString(),
        })
        .select(PROJECT_COLUMNS)
        .single<ProjectDb>(),
    );
    return toProject(row);
  }

  async updateProject(id: string, patch: Partial<ProjectRow>, at: Date): Promise<void> {
    const update: Record<string, unknown> = { last_seen: at.toISOString() };
    if (patch.slug !== undefined) update.slug = patch.slug;
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.nameKey !== undefined) update.name_key = patch.nameKey;
    if (patch.tokenSymbol !== undefined) update.token_symbol = patch.tokenSymbol;
    if (patch.chains !== undefined) update.chains = patch.chains;
    if (patch.officialDomains !== undefined) update.official_domains = patch.officialDomains;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.conflict !== undefined) update.conflict = patch.conflict;
    if (patch.lookalikeOf !== undefined) update.lookalike_of = patch.lookalikeOf;

    let oldStatus: string | null = null;
    if (patch.status !== undefined) {
      const current = checkOne(
        "updateProject.lookup",
        await this.db.from("projects").select("status").eq("id", id).single<{ status: Status }>(),
      );
      oldStatus = current.status;
    }
    check("updateProject", await this.db.from("projects").update(update).eq("id", id));
    if (patch.status !== undefined && patch.status !== oldStatus) {
      check(
        "updateProject.change",
        await this.db.from("project_changes").insert({
          project_id: id,
          field: "status",
          old_value: oldStatus,
          new_value: patch.status,
          changed_at: at.toISOString(),
        }),
      );
    }
  }

  async addEvidence(e: NewEvidence): Promise<void> {
    check(
      "addEvidence",
      await this.db.from("evidence").upsert(
        {
          project_id: e.projectId,
          document_id: e.documentId,
          field: e.field,
          value: e.value,
          quote: e.quote,
          at: e.at.toISOString(),
          // source_url is filled from documents.url by the evidence_source_url trigger.
        },
        { onConflict: "project_id,document_id,field,value", ignoreDuplicates: true },
      ),
    );
  }

  async deleteEvidence(projectId: string, documentId: string, field: string): Promise<void> {
    check(
      "deleteEvidence",
      await this.db
        .from("evidence")
        .delete()
        .eq("project_id", projectId)
        .eq("document_id", documentId)
        .eq("field", field),
    );
  }

  async listStatusEvidence(projectId: string): Promise<StatusEvidence[]> {
    const rows = checkOne(
      "listStatusEvidence",
      await this.db
        .from("evidence")
        .select("value, at")
        .eq("project_id", projectId)
        .eq("field", "status")
        .order("at")
        .order("seq")
        .returns<{ value: Status; at: string }[]>(),
    );
    return rows.map((r) => ({ status: r.value, at: new Date(r.at) }));
  }

  async replaceDeadlines(projectId: string, documentId: string, ds: ExtractedDeadline[]): Promise<void> {
    check(
      "replaceDeadlines.delete",
      await this.db.from("deadlines").delete().eq("project_id", projectId).eq("document_id", documentId),
    );
    if (ds.length === 0) return;
    check(
      "replaceDeadlines.insert",
      await this.db.from("deadlines").insert(
        ds.map((d) => ({
          project_id: projectId,
          document_id: documentId,
          kind: d.kind,
          date: d.date,
          precision: d.precision,
          text: d.text,
        })),
      ),
    );
  }

  async replaceTasks(projectId: string, documentId: string, steps: Step[]): Promise<void> {
    check(
      "replaceTasks.delete",
      await this.db.from("tasks").delete().eq("project_id", projectId).eq("document_id", documentId),
    );
    if (steps.length === 0) return;
    check(
      "replaceTasks.insert",
      await this.db.from("tasks").insert(
        steps.map((step, position) => ({
          project_id: projectId,
          document_id: documentId,
          description: step.text,
          position,
          cadence: step.cadence,
        })),
      ),
    );
  }

  async upsertLinks(
    projectId: string,
    links: { url: string; kind: string; referralStripped: boolean }[],
  ): Promise<void> {
    if (links.length === 0) return;
    // Last entry wins when the same URL appears twice (a single upsert cannot touch a row twice).
    const byUrl = new Map(links.map((l) => [l.url, l]));
    check(
      "upsertLinks",
      await this.db.from("links").upsert(
        [...byUrl.values()].map((l) => ({
          project_id: projectId,
          url: l.url,
          kind: l.kind,
          referral_stripped: l.referralStripped,
        })),
        { onConflict: "project_id,url" },
      ),
    );
  }

  async listProjectsForScoring(activeSinceDays: number, now: Date): Promise<ProjectForScoring[]> {
    const cutoff = new Date(now.getTime() - activeSinceDays * DAY_MS).toISOString();
    type ScoringDb = ProjectDb & {
      tasks: { description: string; cadence: string }[];
      links: { url: string; kind: string }[];
      evidence: { field: string; value: string; quote: string; documents: { source_key: string } | null }[];
      lookalike: { name: string; official_domains: string[] } | null;
    };
    const rows = await this.fetchAll<ScoringDb>("listProjectsForScoring", (from, to) =>
      this.db
        .from("projects")
        .select(
          `${PROJECT_COLUMNS}, tasks(description, cadence), links(url, kind), ` +
            "evidence(field, value, quote, documents(source_key)), lookalike:lookalike_of(name, official_domains)",
        )
        .gte("last_seen", cutoff)
        .order("id")
        // Steps grouped by document, in step order; same as MemoryRepo.
        .order("document_id", { referencedTable: "tasks" })
        .order("position", { referencedTable: "tasks" })
        // Evidence in insertion order, so sourceAsks and facts match MemoryRepo.
        .order("seq", { referencedTable: "evidence" })
        .range(from, to)
        .returns<ScoringDb[]>(),
    );
    return rows.map((r) => ({
      ...toProject(r),
      tasks: r.tasks.map((t) => t.description),
      steps: r.tasks.map((t) => ({ text: t.description, cadence: t.cadence })),
      facts: r.evidence
        .filter((e) => FACT_FIELDS.includes(e.field))
        .map((e) => ({ field: e.field, value: e.value, quote: e.quote })),
      links: r.links.map((l) => ({ url: l.url, kind: l.kind })),
      sourceCount: new Set(r.evidence.flatMap((e) => (e.documents ? [e.documents.source_key] : []))).size,
      lookalikeOfName: r.lookalike?.name ?? null,
      lookalikeOfDomains: r.lookalike?.official_domains ?? [],
      sourceAsks: r.evidence.filter((e) => e.field === "dangerous_ask").map((e) => ({ code: e.value, quote: e.quote })),
    }));
  }

  async latestRiskLevel(projectId: string): Promise<RiskLevel | null> {
    const row = check(
      "latestRiskLevel",
      await this.db
        .from("risk_assessments")
        .select("level")
        .eq("project_id", projectId)
        .order("computed_at", { ascending: false })
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle<{ level: RiskLevel }>(),
    );
    return row?.level ?? null;
  }

  async saveRiskAssessment(projectId: string, a: RiskAssessment, at: Date): Promise<void> {
    const previous = await this.latestRiskLevel(projectId);
    check(
      "saveRiskAssessment",
      await this.db.from("risk_assessments").insert({
        project_id: projectId,
        level: a.level,
        points: a.points,
        reasons: a.reasons,
        checks: a.checks,
        computed_at: at.toISOString(),
      }),
    );
    if (previous !== a.level) {
      check(
        "saveRiskAssessment.change",
        await this.db.from("project_changes").insert({
          project_id: projectId,
          field: "risk_level",
          old_value: previous,
          new_value: a.level,
          changed_at: at.toISOString(),
        }),
      );
    }
  }

  async startRun(at: Date): Promise<string> {
    const row = checkOne(
      "startRun",
      await this.db.from("pipeline_runs").insert({ started_at: at.toISOString() }).select("id").single<{ id: string }>(),
    );
    return row.id;
  }

  async finishRun(runId: string, stats: RunStats, at: Date): Promise<void> {
    check(
      "finishRun",
      await this.db.from("pipeline_runs").update({ finished_at: at.toISOString(), stats }).eq("id", runId),
    );
  }

  async purgeDocumentText(olderThanDays: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS).toISOString();
    const rows = checkOne(
      "purgeDocumentText",
      await this.db
        .from("documents")
        .update({ text: "" })
        .lt("fetched_at", cutoff)
        .neq("text", "")
        .select("id")
        .returns<{ id: string }[]>(),
    );
    return rows.length;
  }

  async replaceSignals(projectId: string, signals: NewSignal[], at: Date): Promise<void> {
    check("replaceSignals.delete", await this.db.from("project_signals").delete().eq("project_id", projectId));
    if (signals.length === 0) return;
    check(
      "replaceSignals.insert",
      await this.db.from("project_signals").insert(
        signals.map((s) => ({
          project_id: projectId,
          kind: s.kind,
          value: s.value,
          source: s.source,
          verified: s.verified,
          observed_at: at.toISOString(),
        })),
      ),
    );
  }

  async listVcPortfolio(vcId: string): Promise<{ domains: string[]; fetchedAt: Date | null }> {
    const rows = await this.fetchAll<{ domain: string; fetched_at: string }>("listVcPortfolio", (from, to) =>
      this.db
        .from("vc_portfolios")
        .select("domain, fetched_at")
        .eq("vc_id", vcId)
        // Same order as MemoryRepo (vc_portfolios.domain is collate "C").
        .order("domain")
        .range(from, to),
    );
    const fetchedAt = rows.reduce<Date | null>((min, r) => {
      const d = new Date(r.fetched_at);
      return min === null || d < min ? d : min;
    }, null);
    return { domains: rows.map((r) => r.domain), fetchedAt };
  }

  async saveVcPortfolio(vcId: string, domains: string[], at: Date): Promise<void> {
    check("saveVcPortfolio.delete", await this.db.from("vc_portfolios").delete().eq("vc_id", vcId));
    if (domains.length === 0) return;
    check(
      "saveVcPortfolio.insert",
      await this.db
        .from("vc_portfolios")
        .insert([...new Set(domains)].map((domain) => ({ vc_id: vcId, domain, fetched_at: at.toISOString() }))),
    );
  }

  async latestAiAnalysis(projectId: string, kind: AiKind): Promise<StoredAiAnalysis | null> {
    type AiAnalysisDb = {
      input_hash: string;
      result: unknown;
      model: string;
      served_model: string | null;
      prompt_version: string;
      created_at: string;
    };
    const row = check(
      "latestAiAnalysis",
      await this.db
        .from("ai_analyses")
        .select("input_hash, result, model, served_model, prompt_version, created_at")
        .eq("project_id", projectId)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle<AiAnalysisDb>(),
    );
    if (row === null) return null;
    return {
      projectId,
      kind,
      inputHash: row.input_hash,
      result: row.result,
      model: row.model,
      servedModel: row.served_model,
      promptVersion: row.prompt_version,
      createdAt: new Date(row.created_at),
    };
  }

  async saveAiAnalysis(a: NewAiAnalysis): Promise<void> {
    check(
      "saveAiAnalysis",
      await this.db.from("ai_analyses").insert({
        project_id: a.projectId,
        kind: a.kind,
        input_hash: a.inputHash,
        result: a.result,
        model: a.model,
        served_model: a.servedModel,
        prompt_version: a.promptVersion,
        created_at: a.createdAt.toISOString(),
      }),
    );
  }

  async latestCuration(projectId: string): Promise<{ passed: boolean; endedOn: string | null } | null> {
    const row = check(
      "latestCuration",
      await this.db
        .from("curations")
        .select("passed, ended_on")
        .eq("project_id", projectId)
        .order("computed_at", { ascending: false })
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle<{ passed: boolean; ended_on: string | null }>(),
    );
    return row === null ? null : { passed: row.passed, endedOn: row.ended_on };
  }

  async passedBeforeEnd(projectId: string): Promise<boolean> {
    const row = check(
      "passedBeforeEnd",
      await this.db
        .from("curations")
        .select("passed")
        .eq("project_id", projectId)
        .neq("status_at", "ended")
        .order("computed_at", { ascending: false })
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle<{ passed: boolean }>(),
    );
    return row?.passed ?? false;
  }

  async saveCuration(projectId: string, c: CurationRecord, at: Date): Promise<void> {
    const previous = await this.latestCuration(projectId);
    check(
      "saveCuration",
      await this.db.from("curations").insert({
        project_id: projectId,
        passed: c.passed,
        worth_level: c.worthLevel,
        tab: c.tab,
        status_at: c.statusAt,
        ended_on: c.endedOn,
        reasons: c.reasons,
        coverage: c.coverage,
        public_fail_reason: publicFailReason(c.passed, c.reasons),
        computed_at: at.toISOString(),
      }),
    );
    const change = curatedChange(previous?.passed ?? null, c.passed);
    if (change) {
      check(
        "saveCuration.change",
        await this.db.from("project_changes").insert({
          project_id: projectId,
          field: "curated",
          old_value: change.oldValue,
          new_value: change.newValue,
          changed_at: at.toISOString(),
        }),
      );
    }
  }
}
