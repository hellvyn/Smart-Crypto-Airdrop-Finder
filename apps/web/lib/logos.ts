// Project logos for the /airdrops cards (owner request 2026-10-11), as stored by the pipeline in `project_logos`.
import type { SupabaseClient } from "@supabase/supabase-js";

/** The raster types `project_logos.mime` allows (0016). Never SVG. */
export const LOGO_MIMES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

/**
 * The stored logo of a project: its mime and bytes. Null when there is none, or when the row is not one the web may
 * serve (a mime outside `LOGO_MIMES`, no bytes); the table's checks already refuse both. Throws on a database error.
 */
export async function getProjectLogo(
  db: SupabaseClient,
  projectId: string,
): Promise<{ mime: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  const { data, error } = await db.from("project_logos").select("mime, data_b64").eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(`Failed to load logo: ${error.message}`);
  const row = data as { mime?: unknown; data_b64?: unknown } | null;
  if (row === null || typeof row.mime !== "string" || !LOGO_MIMES.includes(row.mime) || typeof row.data_b64 !== "string") {
    return null;
  }
  const bytes = Uint8Array.from(Buffer.from(row.data_b64, "base64"));
  return bytes.length === 0 ? null : { mime: row.mime, bytes };
}
