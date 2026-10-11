import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseRepo } from "../src/store/supabase-repo.js";

/**
 * Records every insert and every delete filter; answers like PostgREST does for an insert or delete without
 * `.select()`.
 */
function recordingClient(selectRows: Record<string, unknown> = {}): {
  client: SupabaseClient;
  inserts: { table: string; row: unknown }[];
  deletes: { table: string; filters: [string, unknown][] }[];
  updates: { table: string; row: unknown; filters: [string, unknown][] }[];
  reads: { table: string; columns: string; filters: [string, unknown][]; orders: string[] }[];
} {
  const inserts: { table: string; row: unknown }[] = [];
  const deletes: { table: string; filters: [string, unknown][] }[] = [];
  const updates: { table: string; row: unknown; filters: [string, unknown][] }[] = [];
  const reads: { table: string; columns: string; filters: [string, unknown][]; orders: string[] }[] = [];
  const ok = { data: null, error: null, count: null, status: 204, statusText: "No Content" };
  const client = {
    from: (table: string) => ({
      // A read answers `selectRows[table]` (or no row) whatever its filters, ordering or limit.
      select: (columns = "*") => {
        const result = { ...ok, data: selectRows[table] ?? null, status: 200, statusText: "OK" };
        const read = { table, columns, filters: [] as [string, unknown][], orders: [] as string[] };
        reads.push(read);
        const query: Record<string, unknown> = {
          then: (resolve: (value: typeof result) => unknown) => resolve(result),
          eq: (column: string, value: unknown) => {
            read.filters.push([column, value]);
            return query;
          },
          order: (column: string) => {
            read.orders.push(column);
            return query;
          },
        };
        for (const method of ["neq", "gte", "limit", "range", "returns", "maybeSingle", "single"]) {
          query[method] = () => query;
        }
        return query;
      },
      update: (row: unknown) => {
        const filters: [string, unknown][] = [];
        updates.push({ table, row, filters });
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          then: (resolve: (value: typeof ok) => unknown) => resolve(ok),
        };
        return query;
      },
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { ...ok, status: 201, statusText: "Created" };
      },
      delete: () => {
        const filters: [string, unknown][] = [];
        deletes.push({ table, filters });
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          not: (column: string, operator: string, value: unknown) => {
            filters.push([column, `not.${operator}.${String(value)}`]);
            return query;
          },
          or: (conditions: string) => {
            filters.push(["or", conditions]);
            return query;
          },
          then: (resolve: (value: typeof ok) => unknown) => resolve(ok),
        };
        return query;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts, deletes, updates, reads };
}

describe("SupabaseRepo.replaceTasks", () => {
  it("replaces one document's steps, storing each step's position and cadence", async () => {
    const { client, inserts, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.replaceTasks("p-1", "doc-1", [
      { text: "Check in", cadence: "daily" },
      { text: "Bridge", cadence: "once" },
    ]);

    expect(deletes).toEqual([{ table: "tasks", filters: [["project_id", "p-1"], ["document_id", "doc-1"]] }]);
    expect(inserts).toEqual([
      {
        table: "tasks",
        row: [
          { project_id: "p-1", document_id: "doc-1", description: "Check in", position: 0, cadence: "daily" },
          { project_id: "p-1", document_id: "doc-1", description: "Bridge", position: 1, cadence: "once" },
        ],
      },
    ]);
  });
});

describe("SupabaseRepo.saveStepTranslations", () => {
  it("writes each text to the project's task at the same place in step order", async () => {
    const { client, updates, reads } = recordingClient({ tasks: [{ id: "t-1" }, { id: "t-2" }] });
    const repo = new SupabaseRepo(client);

    await repo.saveStepTranslations("p-1", ["Bridge dulu", "Swap tiap hari"]);

    expect(reads).toEqual([{ table: "tasks", columns: "id", filters: [["project_id", "p-1"]], orders: ["document_id", "position"] }]);
    expect(updates).toEqual([
      { table: "tasks", row: { text_id: "Bridge dulu" }, filters: [["id", "t-1"], ["project_id", "p-1"]] },
      { table: "tasks", row: { text_id: "Swap tiap hari" }, filters: [["id", "t-2"], ["project_id", "p-1"]] },
    ]);
  });

  it("writes nothing when the number of texts differs from the project's tasks", async () => {
    const { client, updates } = recordingClient({ tasks: [{ id: "t-1" }, { id: "t-2" }] });
    const repo = new SupabaseRepo(client);

    await repo.saveStepTranslations("p-1", ["Bridge dulu"]);

    expect(updates).toEqual([]);
  });
});

describe("SupabaseRepo.saveExtraction", () => {
  it("stores served_model with each extraction attempt", async () => {
    const { client, inserts } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.saveExtraction(
      "doc-1",
      {
        model: "freellm:auto",
        servedModel: "gpt-oss:120b",
        httpStatus: 200,
        finishReason: "stop",
        latencyMs: 12.6,
        error: "json_parse",
        raw: "not json",
      },
      "2026-10-10.2",
    );
    await repo.saveExtraction(
      "doc-1",
      {
        model: "nvidia:z-ai/glm-5.3-flash",
        servedModel: null,
        httpStatus: 0,
        finishReason: null,
        latencyMs: 180_000,
        error: "http_0",
        raw: "",
      },
      "2026-10-10.2",
    );

    expect(inserts).toEqual([
      {
        table: "extractions",
        row: {
          document_id: "doc-1",
          model: "freellm:auto",
          served_model: "gpt-oss:120b",
          prompt_version: "2026-10-10.2",
          raw: "not json",
          http_status: 200,
          finish_reason: "stop",
          latency_ms: 13,
          error: "json_parse",
        },
      },
      {
        table: "extractions",
        row: {
          document_id: "doc-1",
          model: "nvidia:z-ai/glm-5.3-flash",
          served_model: null,
          prompt_version: "2026-10-10.2",
          raw: "",
          http_status: 0,
          finish_reason: null,
          latency_ms: 180000,
          error: "http_0",
        },
      },
    ]);
  });
});

describe("SupabaseRepo.replaceSignals", () => {
  it("deletes every signal of the project, then inserts the new ones observed at the run time", async () => {
    const { client, inserts, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);
    const at = new Date("2026-10-10T03:00:00Z");

    await repo.replaceSignals(
      "p-1",
      [
        { kind: "tvl", value: { tvl_usd: 25000000 }, source: "defillama", verified: true },
        { kind: "claimed_backer", value: { investor: "a16z", quote: "backed by a16z" }, source: "llm_text", verified: false },
      ],
      at,
    );
    await repo.replaceSignals("p-2", [], at);

    expect(deletes).toEqual([
      { table: "project_signals", filters: [["project_id", "p-1"]] },
      { table: "project_signals", filters: [["project_id", "p-2"]] },
    ]);
    expect(inserts).toEqual([
      {
        table: "project_signals",
        row: [
          {
            project_id: "p-1",
            kind: "tvl",
            value: { tvl_usd: 25000000 },
            source: "defillama",
            verified: true,
            observed_at: "2026-10-10T03:00:00.000Z",
          },
          {
            project_id: "p-1",
            kind: "claimed_backer",
            value: { investor: "a16z", quote: "backed by a16z" },
            source: "llm_text",
            verified: false,
            observed_at: "2026-10-10T03:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("does not delete the signals of the kept sources", async () => {
    const { client, inserts, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);
    const at = new Date("2026-10-10T03:00:00Z");

    await repo.replaceSignals("p-1", [], at, ["defillama", "vc_portfolio"]);

    expect(deletes).toEqual([
      { table: "project_signals", filters: [["project_id", "p-1"], ["source", "not.in.(defillama,vc_portfolio)"]] },
    ]);
    expect(inserts).toEqual([]);
  });

  it("deletes the signals of a source kept by investor except the kept investors', quoting their names", async () => {
    const { client, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);
    const at = new Date("2026-10-10T03:00:00Z");

    await repo.replaceSignals("p-1", [], at, [
      "defillama",
      { source: "vc_portfolio", investor: "a16z crypto" },
      { source: "vc_portfolio", investor: 'Odd "Name", (Fund)\\' },
    ]);

    expect(deletes).toEqual([
      { table: "project_signals", filters: [["project_id", "p-1"], ["source", "not.in.(defillama,vc_portfolio)"]] },
      {
        table: "project_signals",
        filters: [
          ["project_id", "p-1"],
          ["source", "vc_portfolio"],
          ["or", 'value->>investor.is.null,value->>investor.not.in.("a16z crypto","Odd \\"Name\\", (Fund)\\\\")'],
        ],
      },
    ]);
  });
});

describe("SupabaseRepo.saveCuration", () => {
  it("stores the first fail message as public_fail_reason and logs a passed flip as a curated change", async () => {
    const { client, inserts } = recordingClient({ curations: { passed: true, ended_on: null } });
    const repo = new SupabaseRepo(client);
    const at = new Date("2026-10-10T03:00:00Z");

    await repo.saveCuration(
      "p-1",
      {
        passed: false,
        worthLevel: null,
        tab: null,
        statusAt: "live",
        endedOn: null,
        reasons: [
          { code: "official_domain", message: "Domain resmi tercatat", kind: "pass" },
          { code: "insufficient_checks", message: "Cek kunci belum lengkap", kind: "fail" },
          { code: "risk_high", message: "Risiko tinggi", kind: "fail" },
        ],
        coverage: { defillama: false },
      },
      at,
    );

    expect(inserts).toEqual([
      {
        table: "curations",
        row: {
          project_id: "p-1",
          passed: false,
          worth_level: null,
          tab: null,
          status_at: "live",
          ended_on: null,
          reasons: [
            { code: "official_domain", message: "Domain resmi tercatat", kind: "pass" },
            { code: "insufficient_checks", message: "Cek kunci belum lengkap", kind: "fail" },
            { code: "risk_high", message: "Risiko tinggi", kind: "fail" },
          ],
          coverage: { defillama: false },
          public_fail_reason: "Cek kunci belum lengkap",
          computed_at: "2026-10-10T03:00:00.000Z",
        },
      },
      {
        table: "project_changes",
        row: {
          project_id: "p-1",
          field: "curated",
          old_value: "true",
          new_value: "false",
          changed_at: "2026-10-10T03:00:00.000Z",
        },
      },
    ]);
  });

  it("writes a null public_fail_reason and no change when a passing curation follows a passing one", async () => {
    const { client, inserts } = recordingClient({ curations: { passed: true, ended_on: null } });
    const repo = new SupabaseRepo(client);

    await repo.saveCuration(
      "p-1",
      {
        passed: true,
        worthLevel: "high",
        tab: "ended",
        statusAt: "ended",
        endedOn: "2026-10-05",
        reasons: [{ code: "ended_after_curation", message: "Berakhir setelah lolos kurasi", kind: "pass" }],
        coverage: {},
      },
      new Date("2026-10-10T03:00:00Z"),
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: "curations",
      row: { worth_level: "high", tab: "ended", status_at: "ended", ended_on: "2026-10-05", public_fail_reason: null },
    });
  });
});

describe("SupabaseRepo.listProjectSourceTexts", () => {
  it("maps the project's documents to url and text", async () => {
    const { client } = recordingClient({
      documents: [
        { url: "https://x.test/a", text: "Text A", evidence: [{ project_id: "p-1" }] },
        { url: "https://x.test/b", text: "Text B", evidence: [{ project_id: "p-1" }, { project_id: "p-1" }] },
      ],
    });
    const repo = new SupabaseRepo(client);

    expect(await repo.listProjectSourceTexts("p-1")).toEqual([
      { url: "https://x.test/a", text: "Text A" },
      { url: "https://x.test/b", text: "Text B" },
    ]);
  });
});

describe("SupabaseRepo VC portfolios and AI analyses", () => {
  it("replaces one VC's cached domains, each domain once", async () => {
    const { client, inserts, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.saveVcPortfolio("paradigm", ["blast.io", "zora.co", "blast.io"], new Date("2026-10-10T03:00:00Z"));

    expect(deletes).toEqual([{ table: "vc_portfolios", filters: [["vc_id", "paradigm"]] }]);
    expect(inserts).toEqual([
      {
        table: "vc_portfolios",
        row: [
          { vc_id: "paradigm", domain: "blast.io", fetched_at: "2026-10-10T03:00:00.000Z" },
          { vc_id: "paradigm", domain: "zora.co", fetched_at: "2026-10-10T03:00:00.000Z" },
        ],
      },
    ]);
  });

  it("stores an AI analysis with its model, served model, prompt version and creation time", async () => {
    const { client, inserts } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.saveAiAnalysis({
      projectId: "p-1",
      kind: "contradictions",
      inputHash: "abc",
      result: { items: [] },
      model: "router:auto",
      servedModel: "gpt-oss:120b",
      promptVersion: "contradictions-1",
      createdAt: new Date("2026-10-10T03:00:00Z"),
    });

    expect(inserts).toEqual([
      {
        table: "ai_analyses",
        row: {
          project_id: "p-1",
          kind: "contradictions",
          input_hash: "abc",
          result: { items: [] },
          model: "router:auto",
          served_model: "gpt-oss:120b",
          prompt_version: "contradictions-1",
          created_at: "2026-10-10T03:00:00.000Z",
        },
      },
    ]);
  });
});

describe("SupabaseRepo.listProjectsForScoring", () => {
  it("lists the distinct source kinds of the evidence documents, sorted", async () => {
    const evidence = (field: string, source_key: string, source_kind: string) => ({
      field,
      value: "live",
      quote: "q",
      documents: { source_key, source_kind },
    });
    const { client } = recordingClient({
      projects: [
        {
          id: "p-1",
          slug: "ink",
          name: "Ink",
          name_key: "ink",
          token_symbol: null,
          chains: [],
          official_domains: ["inkonchain.com"],
          status: "live",
          conflict: false,
          lookalike_of: null,
          first_seen: "2026-10-01T00:00:00Z",
          last_seen: "2026-10-10T00:00:00Z",
          tasks: [],
          deadlines: [],
          links: [],
          evidence: [
            evidence("status", "telegram:airdrops_io", "telegram"),
            evidence("status", "airdrops_io:latest", "airdrops_io"),
            evidence("dangerous_ask", "airdrops_io:latest", "airdrops_io"),
            { field: "status", value: "live", quote: "q", documents: null },
          ],
          lookalike: null,
        },
      ],
    });
    const repo = new SupabaseRepo(client);

    const [scored] = await repo.listProjectsForScoring(30, new Date("2026-10-10T03:00:00Z"));

    expect(scored?.sourceKinds).toEqual(["airdrops_io", "telegram"]);
    expect(scored?.sourceCount).toBe(2);
  });
});
