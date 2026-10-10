// The signed-in user's watchlist. Every function here verifies the user itself with requireUser() (the (app) layout
// alone is not enough), filters by that user's id, and relies on RLS ("own watchlist ...") as the second barrier.
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./auth";
import { LIST_COLUMNS, toListItem } from "./queries";
import type { ProjectListItem } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

function throwIf(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Failed to ${what}: ${error.message}`);
}

/** Whether the signed-in user watches the project. */
export async function isWatching(db: SupabaseClient, projectId: string): Promise<boolean> {
  const user = await requireUser();
  const { data, error } = await db
    .from("watchlist")
    .select("project_id")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();
  throwIf(error, "read the watchlist");
  return data != null;
}

/**
 * Sets (`desired` given) or flips (`desired` omitted) whether the signed-in user watches a project.
 * Watching is an insert that ignores an existing row, so a double submit leaves exactly one row; an explicit
 * `desired` also makes a repeated submit idempotent instead of undoing itself.
 */
export async function setWatching(db: SupabaseClient, projectId: string, desired?: boolean): Promise<boolean> {
  const user = await requireUser();
  if (!isUuid(projectId)) throw new Error("Invalid project id");
  const watching = desired ?? !(await isWatching(db, projectId));
  if (watching) {
    const { error } = await db
      .from("watchlist")
      .upsert({ user_id: user.id, project_id: projectId }, { onConflict: "user_id,project_id", ignoreDuplicates: true });
    throwIf(error, "watch the project");
  } else {
    const { error } = await db.from("watchlist").delete().eq("user_id", user.id).eq("project_id", projectId);
    throwIf(error, "unwatch the project");
  }
  return watching;
}

/** The user's watched projects from the `project_list` view, ordered like the airdrop list. */
export async function getWatchlist(db: SupabaseClient): Promise<ProjectListItem[]> {
  const user = await requireUser();
  const watched = await db.from("watchlist").select("project_id").eq("user_id", user.id);
  throwIf(watched.error, "load the watchlist");
  const ids = ((watched.data ?? []) as { project_id: unknown }[]).map((r) => String(r.project_id));
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("project_list")
    .select(LIST_COLUMNS)
    .in("id", ids)
    .order("next_deadline_date", { ascending: true, nullsFirst: false })
    .order("last_seen", { ascending: false })
    .order("id", { ascending: true });
  throwIf(error, "load the watched projects");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toListItem);
}
