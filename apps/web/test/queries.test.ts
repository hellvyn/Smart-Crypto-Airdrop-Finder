import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getChangeFeed,
  getChangesSeenAt,
  getLastSuccessfulRunAt,
  getProjectDetail,
  getRunSummary,
  getTrackRecord,
  listChains,
  listChangesSince,
  listCurated,
  listProjects,
} from "../lib/queries";
import { PAGE_SIZE } from "../lib/view";

type Call = [method: string, ...args: unknown[]];
interface Recorded {
  table: string;
  calls: Call[];
}
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

/** A fake PostgREST query builder: records every call, and resolves (as a thenable) to the queued result. */
function fakeDb(results: Result[] | ((rec: Recorded) => Result)) {
  const recs: Recorded[] = [];
  const queue = Array.isArray(results) ? [...results] : null;
  const db = {
    from(table: string) {
      const rec: Recorded = { table, calls: [] };
      recs.push(rec);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "in", "contains", "order", "range", "eq", "not", "is", "limit", "gte", "or", "gt", "lte"]) {
        builder[m] = (...args: unknown[]) => {
          rec.calls.push([m, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => {
        rec.calls.push(["maybeSingle"]);
        return Promise.resolve(typeof results === "function" ? results(rec) : (queue?.shift() as Result));
      };
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(typeof results === "function" ? results(rec) : (queue?.shift() as Result)).then(resolve, reject);
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, recs };
}

const viewRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  slug: "demo",
  name: "Demo",
  status: "live",
  chains: ["Ethereum"],
  last_seen: "2026-10-09T00:00:00Z",
  next_deadline_date: "2026-11-01",
  next_deadline_kind: "claim",
  next_deadline_precision: "exact",
  latest_risk_level: "high",
  ...over,
});

describe("listProjects", () => {
  it("queries the project_list view with count, SQL ordering and the first page range", async () => {
    const { db, recs } = fakeDb([{ data: [viewRow()], error: null, count: 120 }]);
    const page = await listProjects(db, {}, 1);
    const rec = recs[0]!;
    expect(rec.table).toBe("project_list");
    expect(rec.calls).toContainEqual(["select", expect.stringContaining("latest_risk_level"), { count: "exact" }]);
    expect(rec.calls).toContainEqual(["order", "next_deadline_date", { ascending: true, nullsFirst: false }]);
    expect(rec.calls).toContainEqual(["order", "last_seen", { ascending: false }]);
    expect(rec.calls).toContainEqual(["order", "id", { ascending: true }]);
    expect(rec.calls).toContainEqual(["range", 0, PAGE_SIZE - 1]);
    expect(page).toMatchObject({ total: 120, page: 1, pageSize: 50 });
    expect(page.items[0]).toEqual({
      slug: "demo",
      name: "Demo",
      status: "live",
      riskLevel: "high",
      chains: ["Ethereum"],
      nextDeadline: { date: "2026-11-01", kind: "claim", precision: "exact" },
      lastSeen: "2026-10-09T00:00:00Z",
    });
  });

  it("uses the right range for later pages", async () => {
    const { db, recs } = fakeDb([{ data: [], error: null, count: 55 }]);
    await listProjects(db, {}, 2);
    expect(recs[0]!.calls).toContainEqual(["range", 50, 99]);
  });

  it("pushes status, risk and a lowercased chain filter into SQL", async () => {
    const { db, recs } = fakeDb([{ data: [], error: null, count: 0 }]);
    await listProjects(db, { status: ["live", "unknown"], risk: ["high"], chain: " Base " }, 1);
    const calls = recs[0]!.calls;
    expect(calls).toContainEqual(["in", "status", ["live", "unknown"]]);
    expect(calls).toContainEqual(["in", "latest_risk_level", ["high"]]);
    expect(calls).toContainEqual(["contains", "chains_lower", '{"base"}']);
  });

  it("sends a quoted array literal, including for names with spaces", async () => {
    const { db, recs } = fakeDb([{ data: [], error: null, count: 0 }]);
    await listProjects(db, { chain: "bnb chain" }, 1);
    expect(recs[0]!.calls).toContainEqual(["contains", "chains_lower", '{"bnb chain"}']);
  });

  it("never sends a chain value that is not a plain chain name", async () => {
    for (const chain of ["a,b", "a}", 'x"y', "back\\slash", "NULL", "{a}", "", "-x", "a".repeat(60)]) {
      const { db, recs } = fakeDb([{ data: [], error: null, count: 0 }]);
      await listProjects(db, { chain }, 1);
      expect(recs[0]!.calls.map((c) => c[0]), `chain ${JSON.stringify(chain)}`).not.toContain("contains");
    }
  });

  it("adds no filter calls when no filters are set", async () => {
    const { db, recs } = fakeDb([{ data: [], error: null, count: 0 }]);
    await listProjects(db, { status: [], risk: [] }, 1);
    expect(recs[0]!.calls.map((c) => c[0])).not.toContain("in");
    expect(recs[0]!.calls.map((c) => c[0])).not.toContain("contains");
  });

  it("maps a missing risk and deadline to null", async () => {
    const { db } = fakeDb([
      { data: [viewRow({ latest_risk_level: null, next_deadline_date: null, status: "weird" })], error: null, count: 1 },
    ]);
    const { items } = await listProjects(db, {}, 1);
    expect(items[0]).toMatchObject({ riskLevel: null, nextDeadline: null, status: "unknown" });
  });

  it("keeps the database order (does not re-sort)", async () => {
    const { db } = fakeDb([
      { data: [viewRow({ slug: "b", next_deadline_date: null }), viewRow({ slug: "a", next_deadline_date: "2026-10-11" })], error: null, count: 2 },
    ]);
    const { items } = await listProjects(db, {}, 1);
    expect(items.map((i) => i.slug)).toEqual(["b", "a"]);
  });

  it("returns an empty page with the real total when the range is past the end", async () => {
    const { db, recs } = fakeDb((rec) =>
      rec.calls.some((c) => c[0] === "range")
        ? { data: null, error: { message: "Requested range not satisfiable", code: "PGRST103" } }
        : { data: null, error: null, count: 55 },
    );
    const page = await listProjects(db, {}, 9);
    expect(page).toMatchObject({ items: [], total: 55, page: 9 });
    expect(recs).toHaveLength(2);
    expect(recs[1]!.calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
  });

  it("throws on other errors", async () => {
    const { db } = fakeDb([{ data: null, error: { message: "boom" } }]);
    await expect(listProjects(db, {}, 1)).rejects.toThrow(/boom/);
  });
});

describe("listChains", () => {
  it("reads the project_chains view, ordered", async () => {
    const { db, recs } = fakeDb([{ data: [{ chain: "base" }, { chain: "ethereum" }], error: null }]);
    expect(await listChains(db)).toEqual(["base", "ethereum"]);
    expect(recs[0]!.table).toBe("project_chains");
    expect(recs[0]!.calls).toContainEqual(["order", "chain", { ascending: true }]);
  });

  it("lists only names the chain filter accepts as they are, so every option actually filters", async () => {
    const { db } = fakeDb([
      {
        data: [
          { chain: "arbitrum one" },
          { chain: "base" },
          { chain: "base " },
          { chain: "bnb chain (bsc)" },
          { chain: "x/y" },
          { chain: "null" },
          { chain: "" },
          { chain: "zksync-era" },
        ],
        error: null,
      },
    ]);
    expect(await listChains(db)).toEqual(["arbitrum one", "base", "zksync-era"]);
  });
});

describe("getLastSuccessfulRunAt", () => {
  it("filters finished runs without run_error in SQL and takes the newest", async () => {
    const { db, recs } = fakeDb([{ data: [{ finished_at: "2026-10-10T05:00:00Z", stats: {} }], error: null }]);
    expect((await getLastSuccessfulRunAt(db))?.toISOString()).toBe("2026-10-10T05:00:00.000Z");
    const calls = recs[0]!.calls;
    expect(recs[0]!.table).toBe("pipeline_runs");
    expect(calls).toContainEqual(["not", "finished_at", "is", null]);
    expect(calls).toContainEqual(["is", "stats->>run_error", null]);
    expect(calls).toContainEqual(["order", "finished_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 10]);
  });

  it("skips a row whose stats carry run_error, even with a null value, and takes the next one", async () => {
    const { db } = fakeDb([
      {
        data: [
          { finished_at: "2026-10-10T05:00:00Z", stats: { run_error: null } },
          { finished_at: "2026-10-09T05:00:00Z", stats: { docs: 1 } },
        ],
        error: null,
      },
    ]);
    expect((await getLastSuccessfulRunAt(db))?.toISOString()).toBe("2026-10-09T05:00:00.000Z");
  });

  it("returns null when there is no successful run", async () => {
    const { db } = fakeDb([{ data: [], error: null }]);
    expect(await getLastSuccessfulRunAt(db)).toBeNull();
  });
});

describe("getProjectDetail", () => {
  const NOW = new Date("2026-10-10T03:00:00Z");
  const PROJECT = { id: "p1", slug: "demo", name: "Demo", status: "live", chains: [], last_seen: "2026-10-09T00:00:00Z", token_symbol: null, conflict: false };
  const REASONS = [{ code: "hack_history", severity: "medium", message: "Project ini punya 1 catatan hack.", source: "defillama" }];
  const CHECKS = [
    { id: "dangerous_asks", ran: true, detail: { sources: 2 } },
    { id: "lookalike", ran: true },
    { id: "hack_history", ran: true, detail: { count: 1 } },
    { id: "corroboration", ran: true, detail: { sources: 2 } },
  ];
  const ANALYST = {
    verdict: "garap",
    confidence: "tinggi",
    points: [],
    effort: { minutes_per_day: 5, capital_usd_min: null, note: "Ringan." },
    steps_id: [{ text: "Bridge ke Base", cadence: "once" }],
  };
  const kindOf = (rec: { calls: Call[] }) => rec.calls.find((c) => c[0] === "eq" && c[1] === "kind")?.[2];
  const selected = (recs: Recorded[], table: string) =>
    recs.filter((r) => r.table === table).map((r) => String(r.calls.find((c) => c[0] === "select")?.[1]));

  /** Answers every table getProjectDetail reads; `over` replaces one table's (or one ai_analyses kind's) data. */
  function db(over: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = {
      projects: PROJECT,
      risk_assessments: [{ id: "r1", level: "medium", points: 10, reasons: REASONS, checks: CHECKS, computed_at: "2026-10-09T23:00:00Z", seq: 1 }],
      public_risk_checks: [
        {
          assessment_id: "r1",
          key_checks: [{ id: "dangerous_asks", ran: true, detail: { sources: 2 } }, { id: "lookalike", ran: true }],
          advanced_checks: [{ id: "hack_history", ran: true, flagged: true }, { id: "corroboration", ran: true, flagged: false }],
        },
      ],
      curations: [
        { passed: true, tab: "live_now", public_fail_reason: null, ended_on: null, computed_at: "2026-10-09T23:00:00Z", seq: 3, worth_level: "high", reasons: [{ code: "c", kind: "worth", message: "Didukung VC." }] },
      ],
      project_signals: [{ kind: "vc_backer", value: { investor: "Paradigm" }, verified: true, source: "vc_portfolio", observed_at: "2026-10-09T23:00:00Z" }],
      "ai_analyses:analyst": [{ result: ANALYST, created_at: "2026-10-09T23:00:00Z" }],
      "ai_analyses:scam": [{ result: { flags: [{ pattern: "urgency", quote: "Only 2 hours", explanation: "Buru-buru." }] }, created_at: "2026-10-09T23:00:00Z" }],
      "ai_analyses:contradictions": [{ result: { items: [{ topic: "t", quote_a: "a", url_a: "https://s.example/1", quote_b: "b", url_b: "https://s.example/2", explanation: "e" }] }, created_at: "2026-10-09T23:00:00Z" }],
      tasks: [
        { description: "Bridge to Base", text_id: "Bridge ke Base", cadence: "once", position: 0 },
        { description: "Swap daily", text_id: null, cadence: "daily", position: 1 },
      ],
      links: [{ url: "https://claim.demo.example/", kind: "claim" }],
      link_checks: [{ url: "https://claim.demo.example/", status: "official" }],
      deadlines: [{ kind: "claim", date: "2026-10-20", precision: "exact", text: "Claim" }],
      evidence: [
        { field: "status", value: "live", quote: "Live now", source_url: "https://s.example/1", at: "2026-10-09T00:00:00Z", seq: 2 },
        { field: "claimed_backer", value: "Jump", quote: "Backed by Jump", source_url: "https://s.example/2", at: "2026-10-09T00:00:00Z", seq: 1 },
        { field: "source_rating:difficulty", value: "Easy", quote: "Easy", source_url: "https://s.example/1", at: "2026-10-09T00:00:00Z", seq: 0 },
      ],
      ...over,
    };
    return fakeDb((rec) => {
      const key = rec.table === "ai_analyses" ? `ai_analyses:${String(kindOf(rec))}` : rec.table;
      const rows = data[key] ?? [];
      if (rec.table !== "evidence" || !Array.isArray(rows)) return { data: rows, error: null };
      // Each evidence query gets what its filter asks for: the status quotes, the facts, or every row's source URL.
      const status = rec.calls.some((c) => c[0] === "eq" && c[1] === "field" && c[2] === "status");
      const facts = rec.calls.some((c) => c[0] === "or");
      const isFactField = (f: string) => /^(key_parameter:|source_rating:)|^(latest_update|claimed_backer|capital_required)$/.test(f);
      const typed = rows as { field: string }[];
      return { data: status ? typed.filter((r) => r.field === "status") : facts ? typed.filter((r) => isFactField(r.field)) : typed, error: null };
    });
  }

  const evidenceQuery = (recs: Recorded[], match: (calls: Call[]) => boolean) =>
    recs.find((r) => r.table === "evidence" && match(r.calls))?.calls;

  it("never asks for member-only data for a visitor: no checks, no worth or reasons, no Analyst or scam result", async () => {
    const { db: client, recs } = db();
    const d = await getProjectDetail(client, "demo", { member: false, now: NOW });

    expect(recs.filter((r) => r.table === "ai_analyses").map(kindOf)).toEqual(["contradictions"]);
    expect(selected(recs, "risk_assessments").join()).not.toMatch(/checks/);
    const curation = selected(recs, "curations").join();
    expect(curation).toContain("public_fail_reason");
    expect(curation).not.toMatch(/worth|reasons|coverage/);
    expect(recs.find((r) => r.table === "public_risk_checks")?.calls).toContainEqual(["eq", "project_id", "p1"]);

    expect(d?.analyst).toBeNull();
    expect(d?.scamFlags).toBeNull();
    // The fake answers worth_level and reasons anyway: they must not be read for a visitor.
    expect(d?.curation).toMatchObject({ passed: true, tab: "live_now", worthLevel: null, reasons: null });
  });

  it("gives a visitor the key checks with their detail and the advanced checks as ran and flagged only", async () => {
    const { db: client } = db();
    const d = await getProjectDetail(client, "demo", { member: false, now: NOW });
    expect(d?.risk?.checks).toEqual([
      { id: "dangerous_asks", ran: true, detail: { sources: 2 }, flagged: false },
      { id: "lookalike", ran: true, detail: null, flagged: false },
      { id: "hack_history", ran: true, detail: null, flagged: true },
      { id: "corroboration", ran: true, detail: null, flagged: false },
    ]);
    expect(d?.risk?.reasons).toEqual(REASONS);
  });

  it("gives a member every check with its detail, flagged by the warnings of the assessment", async () => {
    const { db: client, recs } = db();
    const d = await getProjectDetail(client, "demo", { member: true, now: NOW });
    expect(selected(recs, "risk_assessments").join()).toContain("checks");
    expect(recs.some((r) => r.table === "public_risk_checks")).toBe(false);
    expect(d?.risk?.checks).toEqual([
      { id: "dangerous_asks", ran: true, detail: { sources: 2 }, flagged: false },
      { id: "lookalike", ran: true, detail: null, flagged: false },
      { id: "hack_history", ran: true, detail: { count: 1 }, flagged: true },
      { id: "corroboration", ran: true, detail: { sources: 2 }, flagged: false },
    ]);
  });

  it("gives a member the worth, the reasons, the Analyst result (points may be empty) and the scam flags", async () => {
    const { db: client } = db();
    const d = await getProjectDetail(client, "demo", { member: true, now: NOW });
    expect(d?.curation).toMatchObject({ worthLevel: "high", reasons: [{ code: "c", kind: "worth", message: "Didukung VC." }] });
    expect(d?.analyst).toEqual(ANALYST);
    expect(d?.scamFlags).toEqual([{ pattern: "urgency", quote: "Only 2 hours", explanation: "Buru-buru." }]);
  });

  it("treats an unreadable Analyst result as no analysis", async () => {
    const { db: client } = db({ "ai_analyses:analyst": [{ result: { verdict: "aman" }, created_at: "2026-10-09T23:00:00Z" }] });
    expect((await getProjectDetail(client, "demo", { member: true, now: NOW }))?.analyst).toBeNull();
  });

  it("reads the contradictions, the steps in position order (Indonesian first), links with their check and the claim badge", async () => {
    const { db: client, recs } = db();
    const d = await getProjectDetail(client, "demo", { member: false, now: NOW });
    expect(d?.contradictions).toHaveLength(1);
    expect(recs.find((r) => r.table === "tasks")?.calls).toContainEqual(["order", "position", { ascending: true }]);
    expect(d?.steps).toEqual([
      { text: "Bridge ke Base", cadence: "once" },
      { text: "Swap daily", cadence: "daily" },
    ]);
    expect(d?.links).toEqual([{ url: "https://claim.demo.example/", kind: "claim", status: "official" }]);
    expect(d?.claimOpenChecked).toBe(true);
    expect(recs.find((r) => r.table === "project_signals")?.calls).toContainEqual(["gte", "observed_at", "2026-09-26T03:00:00.000Z"]);
    expect(d?.signals.map((s) => s.kind)).toEqual(["vc_backer"]);
  });

  it("reads the status quotes, the facts and the source URLs with their own queries and limits", async () => {
    const { db: client, recs } = db();
    const d = await getProjectDetail(client, "demo", { member: false, now: NOW });
    const status = evidenceQuery(recs, (calls) => calls.some((c) => c[0] === "eq" && c[1] === "field" && c[2] === "status"));
    expect(status).toContainEqual(["order", "at", { ascending: false }]);
    expect(status).toContainEqual(["order", "seq", { ascending: false }]);
    expect(status).toContainEqual(["limit", 100]);
    // Facts never share a window with other evidence, so no number of status rows can push them out.
    const facts = evidenceQuery(recs, (calls) => calls.some((c) => c[0] === "or"));
    expect(facts).toContainEqual([
      "or",
      "field.in.(latest_update,claimed_backer,capital_required),field.like.key_parameter:*,field.like.source_rating:*",
    ]);
    expect(facts).toContainEqual(["limit", 200]);
    const urls = evidenceQuery(recs, (calls) => calls.some((c) => c[0] === "select" && c[1] === "source_url"));
    expect(urls).toContainEqual(["limit", 1000]);
    expect(d?.facts.map((f) => f.field)).toEqual(["claimed_backer", "source_rating:difficulty"]);
    expect(d?.evidence.map((e) => e.field)).toEqual(["status"]);
    expect(d?.sourceUrls).toEqual(["https://s.example/1", "https://s.example/2"]);
  });

  it("leaves a link whose URL PostgREST cannot quote out of the check lookup, so it reads as not checked", async () => {
    const odd = ['https://a.example/x"y', "https://b.example/a,b", "https://c.example/(c)"];
    const { db: client, recs } = db({
      links: [{ url: "https://claim.demo.example/", kind: "claim" }, ...odd.map((url) => ({ url, kind: "claim" }))],
      link_checks: [{ url: "https://claim.demo.example/", status: "official" }],
    });
    const d = await getProjectDetail(client, "demo", { member: false, now: NOW });
    expect(recs.find((r) => r.table === "link_checks")?.calls).toContainEqual(["in", "url", ["https://claim.demo.example/"]]);
    expect(d?.links.map((l) => l.status)).toEqual(["official", null, null, null]);
    expect(d?.claimOpenChecked).toBe(false);
  });

  it("returns null for an unknown slug", async () => {
    const { db: client } = fakeDb(() => ({ data: null, error: null }));
    expect(await getProjectDetail(client, "nope", { member: false })).toBeNull();
  });
});

const curatedRow = (over: Record<string, unknown> = {}) => ({
  ...viewRow(),
  tab: "live_now",
  ended_on: null,
  checked_at: "2026-10-10T23:00:00+00:00",
  signals: [
    { kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, verified: true, source: "vc_portfolio", observed_at: "2026-10-10T23:00:00+00:00" },
    { kind: "claimed_backer", value: { investor: "a16z" }, verified: false, source: "llm_text", observed_at: "2026-10-09T23:00:00+00:00" },
  ],
  claim_open_checked: true,
  capital: "deposit",
  capital_min_usd: 1000,
  key_checks_ran: 4,
  ...over,
});

/** A fake for listCurated: head-count queries answer from `counts` by their capital filter, the page query with `rows`. */
function curatedDb(rows: unknown[] | Result, counts = { all: 7, free: 3, deposit: 2 }) {
  return fakeDb((rec) => {
    const head = rec.calls.some((c) => c[0] === "select" && (c[2] as { head?: boolean } | undefined)?.head === true);
    if (!head) return Array.isArray(rows) ? { data: rows, error: null } : rows;
    const capital = rec.calls.find((c) => c[0] === "eq" && c[1] === "capital")?.[2] as "free" | "deposit" | undefined;
    return { data: null, error: null, count: counts[capital ?? "all"] };
  });
}

const pageQuery = (recs: Recorded[]) => recs.find((r) => !r.calls.some((c) => c[0] === "select" && (c[2] as { head?: boolean } | undefined)?.head))!;
const countQueries = (recs: Recorded[]) => recs.filter((r) => r !== pageQuery(recs));
const orders = (rec: Recorded) => rec.calls.filter((c) => c[0] === "order");

describe("listCurated", () => {
  it("gives visitors public_list in the tab, newest check first, without any worth column, filter or order", async () => {
    const { db, recs } = curatedDb([curatedRow()]);
    const page = await listCurated(db, "live_now", { worth: ["high"] }, 1, false);
    expect(recs.map((r) => r.table)).toEqual(Array(4).fill("public_list"));
    const q = pageQuery(recs);
    expect(q.calls).toContainEqual(["eq", "tab", "live_now"]);
    expect(orders(q)).toEqual([
      ["order", "checked_at", { ascending: false }],
      ["order", "name", { ascending: true }],
      ["order", "id", { ascending: true }],
    ]);
    expect(q.calls).toContainEqual(["range", 0, PAGE_SIZE - 1]);
    expect(JSON.stringify(recs.flatMap((r) => r.calls))).not.toMatch(/worth/);
    expect(page.items[0]!.worthLevel).toBeNull();
  });

  it("maps a row to a list item with tab, check time, signals, claim badge and capital", async () => {
    const { db } = curatedDb([curatedRow({ worth_level: "high" })]);
    const { items } = await listCurated(db, "live_now", {}, 1, false);
    expect(items[0]).toEqual({
      slug: "demo",
      name: "Demo",
      status: "live",
      riskLevel: "high",
      chains: ["Ethereum"],
      nextDeadline: { date: "2026-11-01", kind: "claim", precision: "exact" },
      lastSeen: "2026-10-09T00:00:00Z",
      tab: "live_now",
      endedOn: null,
      checkedAt: "2026-10-10T23:00:00+00:00",
      signals: [
        { kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, verified: true, source: "vc_portfolio", observedAt: "2026-10-10T23:00:00+00:00" },
        { kind: "claimed_backer", value: { investor: "a16z" }, verified: false, source: "llm_text", observedAt: "2026-10-09T23:00:00+00:00" },
      ],
      claimOpenChecked: true,
      capital: "deposit",
      capitalMinUsd: 1000,
      keyChecksRan: 4,
      // A visitor never gets a worth level, even if a row carried one.
      worthLevel: null,
    });
  });

  it("selects key_checks_ran and reads a missing or out-of-range count as a number from 0 to 4", async () => {
    const { db, recs } = curatedDb([
      curatedRow({ key_checks_ran: 3 }),
      curatedRow({ key_checks_ran: null }),
      curatedRow({ key_checks_ran: 9 }),
      curatedRow({ key_checks_ran: "2" }),
    ]);
    const { items } = await listCurated(db, "live_now", {}, 1, false);
    expect(String(pageQuery(recs).calls.find((c) => c[0] === "select")?.[1])).toMatch(/\bkey_checks_ran\b/);
    expect(items.map((i) => i.keyChecksRan)).toEqual([3, 0, 4, 2]);
  });

  it("drops malformed signals and reads odd capital values defensively", async () => {
    const { db } = curatedDb([
      curatedRow({
        signals: [
          null,
          { kind: "rumour", value: {}, verified: true, source: "x", observed_at: "2026-10-10T00:00:00Z" },
          { kind: "tvl", value: "45M", verified: true, source: "defillama", observed_at: "2026-10-10T00:00:00Z" },
          { kind: "tvl", value: { tvl_usd: 45e6 }, verified: "yes", source: "defillama", observed_at: "2026-10-10T00:00:00Z" },
        ],
        capital: "lots",
        capital_min_usd: "1500",
        claim_open_checked: null,
        tab: "weird",
        ended_on: "2026-09-28",
      }),
      curatedRow({ signals: null, capital_min_usd: null }),
    ]);
    const { items } = await listCurated(db, "live_now", {}, 1, false);
    expect(items[0]).toMatchObject({
      signals: [{ kind: "tvl", value: { tvl_usd: 45e6 }, verified: false, source: "defillama", observedAt: "2026-10-10T00:00:00Z" }],
      capital: "unknown",
      capitalMinUsd: 1500,
      claimOpenChecked: false,
      tab: "live_now",
      endedOn: "2026-09-28",
    });
    expect(items[1]).toMatchObject({ signals: [], capitalMinUsd: null });
  });

  it("gives members curated_list ordered by worth, strongest signal, nearest deadline, newest last_seen", async () => {
    const { db, recs } = curatedDb([curatedRow({ worth_level: "medium" }), curatedRow({ slug: "b", worth_level: "nope" })]);
    const page = await listCurated(db, "early_bets", { worth: ["high", "medium"] }, 2, true);
    expect(recs.map((r) => r.table)).toEqual(Array(4).fill("curated_list"));
    const q = pageQuery(recs);
    expect(q.calls).toContainEqual(["select", expect.stringContaining("worth_level")]);
    expect(q.calls).toContainEqual(["eq", "tab", "early_bets"]);
    expect(q.calls).toContainEqual(["in", "worth_level", ["high", "medium"]]);
    expect(orders(q)).toEqual([
      ["order", "worth_rank", { ascending: true, nullsFirst: false }],
      ["order", "signal_rank", { ascending: true, nullsFirst: false }],
      ["order", "next_deadline_date", { ascending: true, nullsFirst: false }],
      ["order", "last_seen", { ascending: false }],
      ["order", "id", { ascending: true }],
    ]);
    expect(q.calls).toContainEqual(["range", PAGE_SIZE, 2 * PAGE_SIZE - 1]);
    // The database order is kept, and an unknown worth level reads as none.
    expect(page.items.map((i) => [i.slug, i.worthLevel])).toEqual([["demo", "medium"], ["b", null]]);
  });

  it("orders the ended tab by ended date, newest first, then name, for members and visitors alike", async () => {
    for (const member of [true, false]) {
      const { db, recs } = curatedDb([]);
      await listCurated(db, "ended", {}, 1, member);
      const q = pageQuery(recs);
      expect(q.calls).toContainEqual(["eq", "tab", "ended"]);
      expect(orders(q), `member ${member}`).toEqual([
        ["order", "ended_on", { ascending: false, nullsFirst: false }],
        ["order", "name", { ascending: true }],
        ["order", "id", { ascending: true }],
      ]);
      // No age limit on ended projects (#40).
      expect(q.calls.map((c) => c[0])).not.toContain("gte");
    }
  });

  it("filters by capital and counts each capital option in the same tab after the other filters", async () => {
    const { db, recs } = curatedDb([curatedRow()]);
    const page = await listCurated(db, "live_now", { status: ["live"], risk: ["low"], chain: "Base", capital: "free" }, 1, false);
    expect(pageQuery(recs).calls).toContainEqual(["eq", "capital", "free"]);
    const counts = countQueries(recs);
    expect(counts).toHaveLength(3);
    for (const rec of counts) {
      expect(rec.calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
      expect(rec.calls).toContainEqual(["eq", "tab", "live_now"]);
      expect(rec.calls).toContainEqual(["in", "status", ["live"]]);
      expect(rec.calls).toContainEqual(["in", "latest_risk_level", ["low"]]);
      expect(rec.calls).toContainEqual(["contains", "chains_lower", '{"base"}']);
    }
    expect(counts.map((r) => r.calls.find((c) => c[0] === "eq" && c[1] === "capital")?.[2] ?? "all").sort()).toEqual([
      "all",
      "deposit",
      "free",
    ]);
    expect(page).toMatchObject({ capitalCounts: { all: 7, free: 3, deposit: 2 }, total: 3, page: 1, pageSize: PAGE_SIZE });
  });

  it("applies no capital filter for all, and the total is every project in the tab", async () => {
    const { db, recs } = curatedDb([curatedRow()]);
    const page = await listCurated(db, "live_now", { capital: "all" }, 1, false);
    expect(pageQuery(recs).calls.some((c) => c[0] === "eq" && c[1] === "capital")).toBe(false);
    expect(page.total).toBe(7);
  });

  it("counts members' worth filter in the capital counts too", async () => {
    const { db, recs } = curatedDb([]);
    await listCurated(db, "live_now", { worth: ["low"], capital: "deposit" }, 1, true);
    for (const rec of countQueries(recs)) expect(rec.calls).toContainEqual(["in", "worth_level", ["low"]]);
  });

  it("returns an empty page with the real total when the page is past the end", async () => {
    const { db } = curatedDb({ data: null, error: { message: "Requested range not satisfiable", code: "PGRST103" } });
    const page = await listCurated(db, "live_now", { capital: "deposit" }, 9, false);
    expect(page).toMatchObject({ items: [], total: 2, page: 9, capitalCounts: { all: 7, free: 3, deposit: 2 } });
  });

  it("throws on other errors, from the page or from a count", async () => {
    await expect(listCurated(curatedDb({ data: null, error: { message: "boom" } }).db, "live_now", {}, 1, false)).rejects.toThrow(/boom/);
    const { db } = fakeDb((rec) =>
      rec.calls.some((c) => c[0] === "select" && (c[2] as { head?: boolean } | undefined)?.head)
        ? { data: null, error: { message: "permission denied for view curated_list" } }
        : { data: [], error: null },
    );
    await expect(listCurated(db, "live_now", {}, 1, true)).rejects.toThrow(/permission denied/);
  });
});

describe("getTrackRecord", () => {
  const run = (stats: Record<string, unknown>) => fakeDb([{ data: [{ finished_at: "2026-10-10T23:30:00Z", stats }], error: null }]);
  const stats = (total: number) => ({
    track_record_total: total,
    track_record_listed: 5,
    track_record_no_token: 3,
    track_record_risk_raised: 4,
  });

  it("reads the numbers of the latest successful run", async () => {
    const { db, recs } = run(stats(12));
    expect(await getTrackRecord(db)).toEqual({ total: 12, listed: 5, noToken: 3, riskRaised: 4 });
    expect(recs[0]!.table).toBe("pipeline_runs");
    expect(recs[0]!.calls).toContainEqual(["is", "stats->>run_error", null]);
    expect(recs[0]!.calls).toContainEqual(["order", "finished_at", { ascending: false }]);
  });

  it("is shown from a population of 10", async () => {
    expect(await getTrackRecord(run(stats(10)).db)).toEqual({ total: 10, listed: 5, noToken: 3, riskRaised: 4 });
  });

  it("is null below a population of 10", async () => {
    expect(await getTrackRecord(run(stats(9)).db)).toBeNull();
  });

  it("takes the latest run without run_error", async () => {
    const { db } = fakeDb([
      {
        data: [
          { finished_at: "2026-10-11T23:30:00Z", stats: { ...stats(50), run_error: "boom" } },
          { finished_at: "2026-10-10T23:30:00Z", stats: stats(11) },
        ],
        error: null,
      },
    ]);
    expect((await getTrackRecord(db))?.total).toBe(11);
  });

  it("is null without a successful run or when the run has no track record numbers", async () => {
    expect(await getTrackRecord(fakeDb([{ data: [], error: null }]).db)).toBeNull();
    expect(await getTrackRecord(run({ docs: 3 }).db)).toBeNull();
    expect(await getTrackRecord(run({ ...stats(12), track_record_listed: "5" }).db)).toBeNull();
  });
});

describe("getRunSummary", () => {
  it("reads checked and passed of the latest successful run, with its finish time", async () => {
    const { db } = fakeDb([
      {
        data: [{ finished_at: "2026-10-10T23:30:00Z", stats: { curation_checked: 96, curation_passed: 12, curation_passed_live_now: 8 } }],
        error: null,
      },
    ]);
    expect(await getRunSummary(db)).toEqual({ checked: 96, passed: 12, at: new Date("2026-10-10T23:30:00Z") });
  });

  it("is null without a successful run or without curation numbers", async () => {
    expect(await getRunSummary(fakeDb([{ data: [], error: null }]).db)).toBeNull();
    expect(
      await getRunSummary(fakeDb([{ data: [{ finished_at: "2026-10-10T23:30:00Z", stats: { docs: 1 } }], error: null }]).db),
    ).toBeNull();
  });
});

describe("getChangesSeenAt", () => {
  it("reads the member's own changes_seen_at", async () => {
    const { db, recs } = fakeDb([{ data: { changes_seen_at: "2026-10-09T08:00:00+00:00" }, error: null }]);
    expect(await getChangesSeenAt(db, "u1")).toEqual(new Date("2026-10-09T08:00:00Z"));
    expect(recs[0]!.table).toBe("profiles");
    expect(recs[0]!.calls).toContainEqual(["select", "changes_seen_at"]);
    expect(recs[0]!.calls).toContainEqual(["eq", "user_id", "u1"]);
  });

  it("is null when the member never marked anything seen, or has no profile row", async () => {
    expect(await getChangesSeenAt(fakeDb([{ data: { changes_seen_at: null }, error: null }]).db, "u1")).toBeNull();
    expect(await getChangesSeenAt(fakeDb([{ data: null, error: null }]).db, "u1")).toBeNull();
  });

  it("throws on a database error", async () => {
    await expect(getChangesSeenAt(fakeDb([{ data: null, error: { message: "boom" } }]).db, "u1")).rejects.toThrow(
      "Failed to load changes seen: boom",
    );
  });
});

describe("listChangesSince", () => {
  // 19:00 WIB on 10 October 2026.
  const now = new Date("2026-10-10T12:00:00Z");
  const project = { slug: "one", name: "One" };
  const respond = (over: Partial<Record<string, Result>> = {}) => (rec: Recorded): Result =>
    over[rec.table] ??
    ({
      watchlist: {
        data: [
          { project_id: "p1", project: { status: "live" } },
          { project_id: "p2", project: { status: "ended" } },
        ],
        error: null,
      },
      project_changes: {
        data: [
          { project_id: "p1", field: "curated", old_value: "true", new_value: "false", changed_at: "2026-10-09T23:00:00+00:00", seq: 7, project },
          { project_id: "p2", field: "curated", old_value: "true", new_value: "false", changed_at: "2026-10-09T23:00:00+00:00", seq: 8, project: { slug: "two", name: "Two" } },
        ],
        error: null,
      },
      deadlines: {
        data: [{ project_id: "p1", kind: "claim", date: "2026-10-11", precision: "exact", project }],
        error: null,
      },
    } as Record<string, Result>)[rec.table]!;
  const rec = (recs: Recorded[], table: string) => recs.find((r) => r.table === table)!;

  it("reads only this member's watched projects, their changes recorded after `since` and their deadlines in the next 48 hours", async () => {
    const { db, recs } = fakeDb(respond());
    const feed = await listChangesSince(db, "u1", new Date("2026-10-09T08:00:00Z"), now);

    const watchlist = rec(recs, "watchlist").calls;
    expect(watchlist).toContainEqual(["select", "project_id, project:projects(status)"]);
    expect(watchlist).toContainEqual(["eq", "user_id", "u1"]);
    const changes = rec(recs, "project_changes").calls;
    expect(changes).toContainEqual(["select", expect.stringContaining("project:projects(slug, name)")]);
    expect(changes).toContainEqual(["in", "project_id", ["p1", "p2"]]);
    expect(changes).toContainEqual(["gt", "recorded_at", "2026-10-09T08:00:00.000Z"]);
    expect(changes).toContainEqual(["order", "changed_at", { ascending: false }]);
    expect(changes).toContainEqual(["order", "seq", { ascending: false }]);
    const deadlines = rec(recs, "deadlines").calls;
    expect(deadlines).toContainEqual(["in", "project_id", ["p1", "p2"]]);
    expect(deadlines).toContainEqual(["in", "kind", ["claim", "snapshot", "campaign_end"]]);
    expect(deadlines).toContainEqual(["in", "precision", ["exact", "approximate"]]);
    expect(deadlines).toContainEqual(["gte", "date", "2026-10-10"]);
    expect(deadlines).toContainEqual(["lte", "date", "2026-10-12"]);

    // p2 is ended now, so its curated flip is not "Keluar dari list". The deadline is shown whatever `since` is.
    expect(feed).toEqual({
      changes: [{ kind: "curated_out", project, at: "2026-10-09T23:00:00+00:00" }],
      deadlines: [{ project, deadlineKind: "claim", date: "2026-10-11", approximate: false }],
    });
  });

  it("without a `since`, reads the changes recorded in the last 7 days", async () => {
    const { db, recs } = fakeDb(respond());
    await listChangesSince(db, "u1", null, now);
    expect(rec(recs, "project_changes").calls).toContainEqual(["gt", "recorded_at", "2026-10-03T12:00:00.000Z"]);
  });

  it("with no watched project, reads nothing else and returns an empty feed", async () => {
    const { db, recs } = fakeDb(respond({ watchlist: { data: [], error: null } }));
    expect(await listChangesSince(db, "u1", null, now)).toEqual({ changes: [], deadlines: [] });
    expect(recs.map((r) => r.table)).toEqual(["watchlist"]);
  });

  it("skips a row whose project did not come back", async () => {
    const { db } = fakeDb(
      respond({
        project_changes: {
          data: [{ project_id: "p9", field: "curated", old_value: "true", new_value: "false", changed_at: "2026-10-09T23:00:00Z", seq: 1, project: null }],
          error: null,
        },
        deadlines: { data: [{ project_id: "p9", kind: "claim", date: "2026-10-11", precision: "exact", project: null }], error: null },
      }),
    );
    expect(await listChangesSince(db, "u1", null, now)).toEqual({ changes: [], deadlines: [] });
  });

  it.each(["watchlist", "project_changes", "deadlines"])("throws when reading %s fails", async (table) => {
    const { db } = fakeDb(respond({ [table]: { data: null, error: { message: "boom" } } }));
    await expect(listChangesSince(db, "u1", null, now)).rejects.toThrow("boom");
  });
});

describe("getChangeFeed", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("reads changes_seen_at, then the feed since then", async () => {
    const { db, recs } = fakeDb((r) =>
      r.table === "profiles"
        ? { data: { changes_seen_at: "2026-10-09T08:00:00+00:00" }, error: null }
        : r.table === "watchlist"
          ? { data: [{ project_id: "p1", project: { status: "live" } }], error: null }
          : { data: [], error: null },
    );
    expect(await getChangeFeed(db, "u1", now)).toEqual({ changes: [], deadlines: [] });
    expect(recs.find((r) => r.table === "profiles")!.calls).toContainEqual(["eq", "user_id", "u1"]);
    expect(recs.find((r) => r.table === "project_changes")!.calls).toContainEqual([
      "gt",
      "recorded_at",
      "2026-10-09T08:00:00.000Z",
    ]);
  });

  it.each(["profiles", "watchlist", "project_changes"])(
    "degrades to an empty feed when reading %s fails, so the page still renders",
    async (table) => {
      const { db } = fakeDb((r) =>
        r.table === table
          ? { data: null, error: { message: "boom" } }
          : r.table === "profiles"
            ? { data: { changes_seen_at: null }, error: null }
            : r.table === "watchlist"
              ? { data: [{ project_id: "p1", project: { status: "live" } }], error: null }
              : { data: [], error: null },
      );
      expect(await getChangeFeed(db, "u1", now)).toEqual({ changes: [], deadlines: [] });
    },
  );
});
