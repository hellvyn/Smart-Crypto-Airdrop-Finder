import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

/**
 * A service-role client from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, or null when either is missing. The
 * report scripts read production and write only to git-ignored paths; neither value is ever printed.
 */
export function serviceClientFromEnv(): SupabaseClient | null {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface ProjectBrief {
  id: string;
  name: string;
  last_seen: string;
}

/** Every project's id, name and last_seen, by id. */
export async function readProjects(db: SupabaseClient): Promise<Map<string, ProjectBrief>> {
  const out = new Map<string, ProjectBrief>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("projects")
      .select("id, name, last_seen")
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
      .overrideTypes<ProjectBrief[], { merge: false }>();
    if (error) throw new Error(`reading projects failed (${error.code ?? "no code"})`);
    for (const p of data) out.set(p.id, p);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

/** The first row of each `project_id` in a list that is already ordered newest first. */
export function firstPerProject<T extends { project_id: string }>(rowsNewestFirst: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rowsNewestFirst) {
    if (seen.has(row.project_id)) continue;
    seen.add(row.project_id);
    out.push(row);
  }
  return out;
}

/**
 * The latest row per project of a history table that has `project_id` and the ordering columns `at` and `seq`
 * ("latest" = max `at`, ties broken by `seq`, like the app). Reads the whole history in pages.
 */
export async function latestPerProject<T extends { project_id: string }>(
  db: SupabaseClient,
  table: string,
  columns: string,
  at: string,
  equals: Record<string, string> = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .match(equals)
      .order(at, { ascending: false })
      .order("seq", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
      .overrideTypes<T[], { merge: false }>();
    if (error) throw new Error(`reading ${table} failed (${error.code ?? "no code"})`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return firstPerProject(rows);
}
