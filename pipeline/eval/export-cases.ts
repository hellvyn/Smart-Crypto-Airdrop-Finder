import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

/** Fixed output directory. It is git-ignored (`pipeline/eval/cases/`): third-party texts never go into the repo. */
const CASES_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "cases");
const DEFAULT_LIMIT = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ExportKind = "airdrops_io" | "telegram";

/** A `documents` row as far as the export needs it. */
export interface ExportRow {
  id: string;
  source_kind: ExportKind;
  url: string;
  text: string;
  published_at: string | null;
}

export interface ExportSource {
  /** Newest documents of `kind` that still have text, newest `fetched_at` first. */
  latest(kind: ExportKind, limit: number): Promise<ExportRow[]>;
}

/** Case id: `aio_` or `tg_` plus the first 8 hex digits of the document id. `run-eval` reads the source from this prefix. */
export function caseIdOf(row: ExportRow): string {
  if (!UUID.test(row.id)) throw new Error("export: unexpected document id format");
  return `${row.source_kind === "telegram" ? "tg" : "aio"}_${row.id.slice(0, 8).toLowerCase()}`;
}

/** Reads `--limit N` (a positive integer) from the arguments; defaults to 40. */
export function parseLimit(args: string[]): number {
  const at = args.indexOf("--limit");
  if (at === -1) return DEFAULT_LIMIT;
  const raw = args[at + 1];
  const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
  if (value < 1) throw new Error("--limit needs a positive whole number, e.g. --limit 40");
  return value;
}

/**
 * Writes `<id>.txt` (the text as stored) and `<id>.meta.json` (`source`, `published`) for each row with text, into
 * `dir` and nowhere else: file names come only from `caseIdOf`. Rows whose text was purged are skipped.
 * Returns the written case ids.
 */
export function writeCases(rows: ExportRow[], dir: string): string[] {
  const ids: string[] = [];
  mkdirSync(dir, { recursive: true });
  for (const row of rows) {
    const id = caseIdOf(row);
    if (row.text.trim() === "") continue;
    const published = row.published_at === null ? null : new Date(row.published_at).toISOString();
    writeFileSync(join(dir, `${id}.txt`), row.text);
    writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify({ source: row.url, published }, null, 2) + "\n");
    ids.push(id);
  }
  return ids;
}

/** Exports about `limit` newest documents, half from each source (rounded up) so one source cannot crowd out the other. */
export async function exportCases(source: ExportSource, dir: string, limit: number): Promise<string[]> {
  const perSource = Math.ceil(limit / 2);
  const rows = [...(await source.latest("airdrops_io", perSource)), ...(await source.latest("telegram", perSource))];
  return writeCases(rows, dir);
}

function supabaseSource(url: string, serviceKey: string): ExportSource {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async latest(kind, limit) {
      const { data, error } = await db
        .from("documents")
        .select("id, source_kind, url, text, published_at")
        .eq("source_kind", kind)
        .neq("text", "")
        .order("fetched_at", { ascending: false })
        .limit(limit)
        .overrideTypes<ExportRow[], { merge: false }>();
      if (error) throw new Error(`export: reading documents failed (${error.code ?? "no code"})`);
      return data;
    },
  };
}

async function main(args: string[]): Promise<number> {
  const limit = parseLimit(args);
  const url = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) {
    console.error("export-cases needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    return 2;
  }
  const ids = await exportCases(supabaseSource(url, serviceKey), CASES_DIR, limit);
  // Ids only: case texts, URLs and keys are never printed.
  console.log(`Wrote ${ids.length} cases to pipeline/eval/cases/:`);
  for (const id of ids) console.log(id);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
