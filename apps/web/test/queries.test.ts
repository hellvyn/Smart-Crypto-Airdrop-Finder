import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getLastSuccessfulRunAt,
  getProjectDetail,
  getRunSummary,
  getTrackRecord,
  listChains,
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
      for (const m of ["select", "in", "contains", "order", "range", "eq", "not", "is", "limit", "gte"]) {
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

describe("getProjectDetail evidence query", () => {
  it("orders by at then seq descending and caps at 100 rows", async () => {
    const { db, recs } = fakeDb((rec) => {
      if (rec.table === "projects")
        return { data: { id: "p1", slug: "demo", name: "Demo", status: "live", chains: [], last_seen: "2026-10-09T00:00:00Z", token_symbol: null, conflict: false }, error: null };
      return { data: [], error: null };
    });
    const detail = await getProjectDetail(db, "demo");
    expect(detail?.slug).toBe("demo");
    const ev = recs.find((r) => r.table === "evidence")!;
    expect(ev.calls).toContainEqual(["order", "at", { ascending: false }]);
    expect(ev.calls).toContainEqual(["order", "seq", { ascending: false }]);
    expect(ev.calls).toContainEqual(["limit", 100]);
  });

  it("leaves the unverified v3 fact fields out in the query, so they never take rows from the 100-row window", async () => {
    const { db, recs } = fakeDb((rec) => {
      if (rec.table === "projects")
        return { data: { id: "p1", slug: "demo", name: "Demo", status: "live", chains: [], last_seen: "2026-10-09T00:00:00Z", token_symbol: null, conflict: false }, error: null };
      return { data: [], error: null };
    });
    await getProjectDetail(db, "demo");
    const ev = recs.find((r) => r.table === "evidence")!;
    expect(ev.calls).toContainEqual(["not", "field", "in", "(claimed_backer,capital_required,capital_min_usd,latest_update)"]);
    expect(ev.calls).toContainEqual(["not", "field", "like", "key_parameter:*"]);
    expect(ev.calls).toContainEqual(["not", "field", "like", "source_rating:*"]);
  });

  it("returns null for an unknown slug", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    expect(await getProjectDetail(db, "nope")).toBeNull();
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
