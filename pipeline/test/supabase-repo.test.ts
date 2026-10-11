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
  upserts: { table: string; row: unknown; options: unknown }[];
} {
  const inserts: { table: string; row: unknown }[] = [];
  const upserts: { table: string; row: unknown; options: unknown }[] = [];
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
          in: (column: string, values: unknown[]) => {
            read.filters.push([column, values]);
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
      upsert: async (row: unknown, options: unknown) => {
        upserts.push({ table, row, options });
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
  return { client, inserts, deletes, updates, reads, upserts };
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

  it("deletes the signals of a source kept by kind except the kept kinds'", async () => {
    const { client, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);
    const at = new Date("2026-10-10T03:00:00Z");

    await repo.replaceSignals("p-1", [], at, ["defillama", { source: "alphadrops", kind: "reported_backer" }]);

    expect(deletes).toEqual([
      { table: "project_signals", filters: [["project_id", "p-1"], ["source", "not.in.(defillama,alphadrops)"]] },
      {
        table: "project_signals",
        filters: [["project_id", "p-1"], ["source", "alphadrops"], ["kind", "not.in.(reported_backer)"]],
      },
    ]);
  });

  it("keeps a signal of a source kept by both kind and investor when either keep matches it", async () => {
    const { client, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.replaceSignals("p-1", [], new Date("2026-10-10T03:00:00Z"), [
      { source: "alphadrops", kind: "reported_backer" },
      { source: "alphadrops", investor: "Paradigm" },
    ]);

    expect(deletes[1]).toEqual({
      table: "project_signals",
      filters: [
        ["project_id", "p-1"],
        ["source", "alphadrops"],
        ["or", 'value->>investor.is.null,value->>investor.not.in.("Paradigm")'],
        ["kind", "not.in.(reported_backer)"],
      ],
    });
  });
});

describe("SupabaseRepo AlphaDrops raises", () => {
  const seed = { round: "Seed", date: "2026-01-02", amountUsd: 5_000_000, lead: ["Paradigm"], others: ["Variant"], sourceUrl: "https://x.test/a" };

  it("upserts the raise page of one slug with its rounds in snake case", async () => {
    const { client, upserts } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.saveAlphaRaise("catalyst", { officialDomain: "catalyst.app", rounds: [seed] }, new Date("2026-10-10T03:00:00Z"));

    expect(upserts).toEqual([
      {
        table: "alphadrops_raises",
        row: {
          slug: "catalyst",
          official_domain: "catalyst.app",
          rounds: [{ round: "Seed", date: "2026-01-02", amount_usd: 5_000_000, lead: ["Paradigm"], others: ["Variant"], source_url: "https://x.test/a" }],
          fetched_at: "2026-10-10T03:00:00.000Z",
        },
        options: { onConflict: "slug" },
      },
    ]);
  });

  it("reads the cached raise page of one slug, or null", async () => {
    const stored = {
      official_domain: "catalyst.app",
      rounds: [{ round: "Seed", date: "2026-01-02", amount_usd: 5_000_000, lead: ["Paradigm"], others: ["Variant"], source_url: "https://x.test/a" }],
      fetched_at: "2026-10-10T03:00:00+00:00",
    };
    const { client, reads } = recordingClient({ alphadrops_raises: stored });

    expect(await new SupabaseRepo(client).listAlphaRaise("catalyst")).toEqual({
      officialDomain: "catalyst.app",
      rounds: [seed],
      fetchedAt: new Date("2026-10-10T03:00:00Z"),
    });
    expect(reads).toEqual([
      { table: "alphadrops_raises", columns: "official_domain, rounds, fetched_at", filters: [["slug", "catalyst"]], orders: [] },
    ]);
    expect(await new SupabaseRepo(recordingClient().client).listAlphaRaise("catalyst")).toBeNull();
  });
});

describe("SupabaseRepo link checks and claim pages", () => {
  const at = new Date("2026-10-10T03:00:00Z");

  it("upserts a link check by url", async () => {
    const { client, upserts } = recordingClient();

    await new SupabaseRepo(client).saveLinkCheck("https://claim.ink.xyz/", "official", at);

    expect(upserts).toEqual([
      {
        table: "link_checks",
        row: { url: "https://claim.ink.xyz/", status: "official", checked_at: "2026-10-10T03:00:00.000Z" },
        options: { onConflict: "url" },
      },
    ]);
  });

  it("reads the link checks of the asked urls, ordered by url", async () => {
    const stored = [{ url: "https://claim.ink.xyz/", status: "phishing", checked_at: "2026-10-10T03:00:00+00:00" }];
    const { client, reads } = recordingClient({ link_checks: stored });

    expect(await new SupabaseRepo(client).listLinkChecks(["https://claim.ink.xyz/", "https://x.io/"])).toEqual([
      { url: "https://claim.ink.xyz/", status: "phishing", checkedAt: at },
    ]);
    expect(reads).toEqual([
      { table: "link_checks", columns: "url, status, checked_at", filters: [["url", ["https://claim.ink.xyz/", "https://x.io/"]]], orders: ["url"] },
    ]);
  });

  it("reads many urls in chunks of 100 and reads nothing for no url", async () => {
    const { client, reads } = recordingClient();
    const urls = Array.from({ length: 150 }, (_, i) => `https://c${i}.io/`);

    await new SupabaseRepo(client).listLinkChecks(urls);
    await new SupabaseRepo(client).listClaimPages(urls);
    await new SupabaseRepo(client).listLinkChecks([]);

    expect(reads.map((r) => [r.table, (r.filters[0]?.[1] as string[]).length])).toEqual([
      ["link_checks", 100],
      ["link_checks", 50],
      ["claim_pages", 100],
      ["claim_pages", 50],
    ]);
  });

  it("upserts a claim page by url and reads it back", async () => {
    const stored = [{ url: "https://claim.ink.xyz/", text: "Claim your INK", fetched_at: "2026-10-10T03:00:00+00:00" }];
    const { client, upserts, reads } = recordingClient({ claim_pages: stored });
    const repo = new SupabaseRepo(client);

    await repo.saveClaimPage("https://claim.ink.xyz/", "Claim your INK", at);

    expect(upserts).toEqual([
      {
        table: "claim_pages",
        row: { url: "https://claim.ink.xyz/", text: "Claim your INK", fetched_at: "2026-10-10T03:00:00.000Z" },
        options: { onConflict: "url" },
      },
    ]);
    expect(await repo.listClaimPages(["https://claim.ink.xyz/"])).toEqual([
      { url: "https://claim.ink.xyz/", text: "Claim your INK", fetchedAt: at },
    ]);
    expect(reads).toEqual([
      { table: "claim_pages", columns: "url, text, fetched_at", filters: [["url", ["https://claim.ink.xyz/"]]], orders: ["url"] },
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
          project_signals: [],
        },
      ],
    });
    const repo = new SupabaseRepo(client);

    const [scored] = await repo.listProjectsForScoring(30, new Date("2026-10-10T03:00:00Z"));

    expect(scored?.sourceKinds).toEqual(["airdrops_io", "telegram"]);
    expect(scored?.sourceCount).toBe(2);
  });
});

describe("SupabaseRepo.listProjectsForScoring ended curated projects", () => {
  type Filter = [string, string, unknown];
  interface Read {
    table: string;
    columns: string;
    filters: Filter[];
    single: boolean;
  }

  /** A read answers `answer(read)` (rows, or one row for `.maybeSingle()`), whatever its ordering or range. */
  function filteringClient(answer: (read: Read) => unknown): { client: SupabaseClient; reads: Read[] } {
    const reads: Read[] = [];
    const client = {
      from: (table: string) => ({
        select: (columns = "*") => {
          const read: Read = { table, columns, filters: [], single: false };
          reads.push(read);
          const query: Record<string, unknown> = {
            then: (resolve: (value: unknown) => unknown) =>
              resolve({ data: answer(read), error: null, count: null, status: 200, statusText: "OK" }),
            maybeSingle: () => {
              read.single = true;
              return query;
            },
          };
          for (const op of ["eq", "neq", "gte", "in"]) {
            query[op] = (column: string, value: unknown) => {
              read.filters.push([op, column, value]);
              return query;
            };
          }
          for (const method of ["order", "limit", "range", "returns"]) query[method] = () => query;
          return query;
        },
      }),
    } as unknown as SupabaseClient;
    return { client, reads };
  }

  const projectRow = (id: string, status: string, lastSeen: string, signals: unknown[] = []) => ({
    id,
    slug: id,
    name: id,
    name_key: id,
    token_symbol: null,
    chains: [],
    official_domains: [],
    status,
    conflict: false,
    lookalike_of: null,
    first_seen: "2026-01-01T00:00:00Z",
    last_seen: lastSeen,
    tasks: [],
    deadlines: [],
    links: [],
    evidence: [],
    lookalike: null,
    project_signals: signals,
  });
  const has = (read: Read, op: string, column: string) => read.filters.find(([o, c]) => o === op && c === column);

  it("adds ended projects whose latest curation passed and ended at most 90 days ago, by ended_on", async () => {
    const latest: Record<string, { passed: boolean; ended_on: string | null }> = {
      "p-ended": { passed: true, ended_on: "2026-07-12" },
      "p-dropped": { passed: false, ended_on: "2026-09-01" },
      "p-moved-on": { passed: true, ended_on: "2026-07-11" },
    };
    const { client, reads } = filteringClient((read) => {
      if (read.table === "curations" && read.single) return latest[String(has(read, "eq", "project_id")?.[2])] ?? null;
      // Passing curations that ended in the window (the active project's too: it is not read twice).
      if (read.table === "curations") return ["p-active", "p-ended", "p-dropped", "p-ended", "p-moved-on"].map((project_id) => ({ project_id }));
      if (has(read, "gte", "last_seen")) return [projectRow("p-active", "live", "2026-10-09T00:00:00Z")];
      const ids = (has(read, "in", "id")?.[2] as string[] | undefined) ?? [];
      return ids.map((id) => projectRow(id, "ended", "2026-05-01T00:00:00Z"));
    });
    const repo = new SupabaseRepo(client);

    const scored = await repo.listProjectsForScoring(60, new Date("2026-10-10T03:00:00Z"));

    expect(scored.map((p) => p.id)).toEqual(["p-active", "p-ended"]);
    const candidates = reads.find((r) => r.table === "curations" && !r.single);
    expect(candidates?.filters).toEqual([
      ["eq", "passed", true],
      ["gte", "ended_on", "2026-07-12"],
    ]);
    const endedRead = reads.find((r) => r.table === "projects" && has(r, "in", "id"));
    expect(endedRead?.filters).toEqual([
      ["eq", "status", "ended"],
      ["in", "id", ["p-ended"]],
    ]);
    // The latest curation is read once per candidate outside the active window.
    expect(reads.filter((r) => r.single).map((r) => has(r, "eq", "project_id")?.[2])).toEqual(["p-ended", "p-dropped", "p-moved-on"]);
  });

  it("reads no extra projects when no ended curated project qualifies", async () => {
    const { client, reads } = filteringClient((read) =>
      read.table === "projects" ? [projectRow("p-active", "live", "2026-10-09T00:00:00Z")] : [],
    );

    const scored = await new SupabaseRepo(client).listProjectsForScoring(60, new Date("2026-10-10T03:00:00Z"));

    expect(scored.map((p) => p.id)).toEqual(["p-active"]);
    expect(reads.filter((r) => r.table === "projects")).toHaveLength(1);
  });

  it("maps the project's stored signals with when each was observed", async () => {
    const signal = {
      kind: "tvl",
      value: { tvl_usd: 3e7 },
      source: "defillama",
      verified: true,
      observed_at: "2026-10-01T00:00:00+00:00",
    };
    const { client, reads } = filteringClient((read) =>
      read.table === "projects" ? [projectRow("p-active", "live", "2026-10-09T00:00:00Z", [signal])] : [],
    );

    const [scored] = await new SupabaseRepo(client).listProjectsForScoring(60, new Date("2026-10-10T03:00:00Z"));

    expect(scored?.signals).toEqual([
      { kind: "tvl", value: { tvl_usd: 3e7 }, source: "defillama", verified: true, observedAt: new Date("2026-10-01T00:00:00Z") },
    ]);
    expect(reads[0]?.columns).toContain("project_signals(kind, value, source, verified, observed_at)");
  });
});
