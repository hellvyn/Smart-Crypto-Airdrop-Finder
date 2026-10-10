import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getLastSuccessfulRunAt, getProjectDetail, listChains, listProjects } from "../lib/queries";
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
