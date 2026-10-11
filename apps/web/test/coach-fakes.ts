// Shared fakes for the Coach tests: an in-memory PostgREST-like db with RPC recording, and candidate fixtures.
// Not a test file (the vitest include pattern wants *.test.ts), so it is only imported by them.
import type { Candidate, CoachProfile } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export type Result = { data: unknown; error: { message: string; code?: string } | null };

export interface FakeDbOptions {
  tables?: Record<string, Row[]>;
  /** RPC handlers by function name; an unlisted function returns `{ data: null, error: null }`. */
  rpc?: Record<string, (args: Record<string, unknown>) => Result | Promise<Result>>;
  /** Error for a whole table read, by table name. */
  tableErrors?: Record<string, { message: string; code?: string }>;
  upsertError?: { message: string; code?: string };
}

export interface FakeDb {
  db: SupabaseClient;
  /** Every RPC in call order. */
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  upserts: { table: string; values: unknown; options: unknown }[];
  reads: { table: string; filters: [string, ...unknown[]][] }[];
}

/** Rows of `table` matching the recorded `eq`/`in`/`gte` filters, ordered and limited like PostgREST would. */
function evaluate(rows: Row[], filters: [string, ...unknown[]][]): Row[] {
  let out = [...rows];
  for (const [method, ...args] of filters) {
    if (method === "eq") out = out.filter((r) => r[args[0] as string] === args[1]);
    else if (method === "in") out = out.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
    else if (method === "gte") out = out.filter((r) => String(r[args[0] as string]) >= String(args[1]));
    else if (method === "not") out = out.filter((r) => r[args[0] as string] != null);
  }
  for (const [method, ...args] of [...filters].reverse()) {
    if (method !== "order") continue;
    const column = args[0] as string;
    const ascending = (args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
    out.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
  }
  const limit = filters.find(([m]) => m === "limit");
  return limit ? out.slice(0, limit[1] as number) : out;
}

export function fakeCoachDb(opts: FakeDbOptions = {}): FakeDb {
  const rpcCalls: FakeDb["rpcCalls"] = [];
  const upserts: FakeDb["upserts"] = [];
  const reads: FakeDb["reads"] = [];
  const db = {
    from(table: string) {
      const filters: [string, ...unknown[]][] = [];
      const settle = (single: boolean): Result => {
        const error = opts.tableErrors?.[table];
        if (error) return { data: null, error };
        const rows = evaluate(opts.tables?.[table] ?? [], filters);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "order", "limit", "not"]) {
        b[m] = (...args: unknown[]) => {
          filters.push([m, ...args]);
          return b;
        };
      }
      b.upsert = (values: unknown, options: unknown) => {
        upserts.push({ table, values, options });
        return Promise.resolve({ data: null, error: opts.upsertError ?? null });
      };
      b.maybeSingle = () => {
        reads.push({ table, filters: [...filters] });
        return Promise.resolve(settle(true));
      };
      b.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => {
        reads.push({ table, filters: [...filters] });
        return Promise.resolve(settle(false)).then(res, rej);
      };
      return b;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const handler = opts.rpc?.[name];
      return handler ? handler(args) : { data: null, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls, upserts, reads };
}

export const PROFILE: CoachProfile = {
  level: "intermediate",
  capital_band: "up_to_100",
  has_wallet: true,
  wallet_count: 2,
  minutes_per_day: 60,
  goal: "long_term",
  chains: ["Base"],
};

export const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const P3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const OUTSIDER = "ffffffff-ffff-4fff-8fff-fffffffffff9";

export function candidate(id: string, name: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    risk: "low",
    worthLevel: "high",
    tab: "live_now",
    capital: "free",
    capitalMinUsd: null,
    chains: ["Base"],
    minutesPerDay: 15,
    nextDeadline: null,
    points: [{ text: `${name} punya program poin aktif`, quote: `${name} points program is live`, sourceUrl: "https://docs.example.org/points" }],
    steps: [{ text: `Bridge sedikit ETH ke Base lalu swap di ${name}`, cadence: "weekly" }],
    signalRank: 1,
    ...over,
  };
}

/** The `curated_list` / `ai_analyses` / `tasks` rows that `loadCandidates` turns into `candidate(id, name)`. */
export function candidateTables(entries: { id: string; name: string }[]): Record<string, Row[]> {
  const curated: Row[] = [];
  const analyses: Row[] = [];
  const tasks: Row[] = [];
  entries.forEach(({ id, name }, i) => {
    curated.push({
      id,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      chains: ["Base"],
      latest_risk_level: "low",
      worth_level: "high",
      tab: "live_now",
      capital: "free",
      capital_min_usd: null,
      next_deadline_date: null,
      signal_rank: i + 1,
    });
    analyses.push({
      project_id: id,
      kind: "analyst",
      created_at: "2026-10-11T00:00:00Z",
      seq: 1,
      result: {
        verdict: "garap",
        confidence: "tinggi",
        points: [{ text: `${name} punya program poin aktif`, quote: `${name} points program is live`, source_url: "https://docs.example.org/points" }],
        effort: { minutes_per_day: 15, capital_usd_min: null, note: "ringan" },
        steps_id: [],
      },
    });
    tasks.push({ project_id: id, document_id: "d1", position: 0, cadence: "weekly", text_id: `Bridge sedikit ETH ke Base lalu swap di ${name}`, description: "bridge and swap" });
  });
  return { curated_list: curated, ai_analyses: analyses, tasks };
}
