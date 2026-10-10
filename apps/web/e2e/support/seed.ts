// Test-harness only: seeds public pipeline data through the service role (the web app only ever reads it).
import { randomUUID } from "node:crypto";
import { adminClient } from "./admin";

export interface SeededProject {
  slug: string;
  name: string;
  sourceUrl: string;
  claimUrl: string;
}

export interface Seed {
  main: SeededProject;
  conflicted: SeededProject;
  runId: string;
}

const CHECK_IDS = [
  "dangerous_asks",
  "phishing_list",
  "domain_age",
  "lookalike",
  "token_security",
  "contract_verified",
  "hack_history",
  "corroboration",
];

let projectIds: string[] = [];
let documentIds: string[] = [];
let runIds: string[] = [];

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) {
    throw new Error(`seed ${what}: ${res.error?.message ?? "no data"}`);
  }
  return res.data as NonNullable<T>;
}

async function insertDocument(url: string): Promise<string> {
  const row = must(
    await adminClient()
      .from("documents")
      .insert({
        source_kind: "airdrops_io",
        source_key: "e2e",
        url,
        text: "e2e",
        content_hash: randomUUID(),
        fetched_at: new Date().toISOString(),
        extraction_status: "done",
      })
      .select("id")
      .single(),
    "document",
  );
  documentIds.push(row.id as string);
  return row.id as string;
}

async function insertProject(row: Record<string, unknown>): Promise<string> {
  const now = new Date().toISOString();
  const created = must(
    await adminClient()
      .from("projects")
      .insert({ first_seen: now, last_seen: now, ...row })
      .select("id")
      .single(),
    "project",
  );
  projectIds.push(created.id as string);
  return created.id as string;
}

export async function seedProjects(): Promise<Seed> {
  const db = adminClient();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  // Project 1: risk, deadline, evidence, links, tasks.
  const main: SeededProject = {
    slug: `e2e-main-${tag}`,
    name: `E2E Main ${tag}`,
    sourceUrl: `https://source.example/e2e-main-${tag}`,
    claimUrl: `https://checker.example/${tag}`,
  };
  const mainDoc = await insertDocument(main.sourceUrl);
  const mainId = await insertProject({
    slug: main.slug,
    name: main.name,
    name_key: main.name.toLowerCase(),
    token_symbol: "E2E",
    chains: ["ethereum", "base"],
    status: "live",
  });
  must(
    await db
      .from("risk_assessments")
      .insert([
        // An older, better assessment that must lose to the newer one below.
        { project_id: mainId, level: "low", points: 0, reasons: [], checks: [], computed_at: "2020-01-01T00:00:00Z" },
        {
          project_id: mainId,
          level: "high",
          points: 50,
          reasons: [
            { code: "young_claim_domain", severity: "high", message: "Claim domain is younger than 30 days", source: "rdap" },
          ],
          checks: CHECK_IDS.map((id, i) => ({ id, ran: i < 4 })),
          computed_at: new Date().toISOString(),
        },
      ])
      .select("id"),
    "risk",
  );
  must(
    await db
      .from("deadlines")
      .insert([
        // Past exact date and a quarter date must not become the next deadline.
        { project_id: mainId, document_id: mainDoc, kind: "claim", date: day(-5), precision: "exact", text: "past" },
        { project_id: mainId, document_id: mainDoc, kind: "tge", date: day(3), precision: "quarter", text: "Q4" },
        { project_id: mainId, document_id: mainDoc, kind: "snapshot", date: day(10), precision: "exact", text: "Snapshot on the 10th" },
      ])
      .select("id"),
    "deadlines",
  );
  must(
    await db
      .from("tasks")
      .insert([{ project_id: mainId, document_id: mainDoc, description: "Bridge to the main chain" }])
      .select("id"),
    "tasks",
  );
  must(
    await db
      .from("links")
      .insert([
        { project_id: mainId, url: main.claimUrl, kind: "claim" },
        { project_id: mainId, url: `https://docs.example/${tag}`, kind: "docs" },
        { project_id: mainId, url: "javascript:alert(1)", kind: "website" },
      ])
      .select("id"),
    "links",
  );
  must(
    await db
      .from("evidence")
      .insert([
        {
          project_id: mainId,
          document_id: mainDoc,
          field: "status",
          value: "live",
          quote: `Claims are open now ${tag}`,
          at: new Date().toISOString(),
        },
      ])
      .select("id"),
    "evidence",
  );

  // Project 2: conflicting status sources, no chains.
  const conflicted: SeededProject = {
    slug: `e2e-conflict-${tag}`,
    name: `E2E Conflict ${tag}`,
    sourceUrl: `https://source-a.example/e2e-${tag}`,
    claimUrl: "",
  };
  const docA = await insertDocument(conflicted.sourceUrl);
  const docB = await insertDocument(`https://source-b.example/e2e-${tag}`);
  const conflictId = await insertProject({
    slug: conflicted.slug,
    name: conflicted.name,
    name_key: conflicted.name.toLowerCase(),
    chains: [],
    status: "unknown",
    conflict: true,
  });
  must(
    await db
      .from("evidence")
      .insert([
        { project_id: conflictId, document_id: docA, field: "status", value: "live", quote: `Airdrop is live ${tag}`, at: new Date().toISOString() },
        { project_id: conflictId, document_id: docB, field: "status", value: "ended", quote: `Airdrop has ended ${tag}`, at: new Date().toISOString() },
      ])
      .select("id"),
    "conflict evidence",
  );

  // A fresh successful pipeline run, so no stale banner.
  const run = must(
    await db
      .from("pipeline_runs")
      .insert({ started_at: new Date().toISOString(), finished_at: new Date().toISOString(), stats: { e2e: true } })
      .select("id")
      .single(),
    "pipeline run",
  );
  runIds.push(run.id as string);

  return { main, conflicted, runId: run.id as string };
}

/** Removes everything seeded (projects cascade to their risk, deadlines, tasks, links and evidence). */
export async function cleanupSeed(): Promise<void> {
  const db = adminClient();
  if (projectIds.length) await db.from("projects").delete().in("id", projectIds);
  if (documentIds.length) await db.from("documents").delete().in("id", documentIds);
  if (runIds.length) await db.from("pipeline_runs").delete().in("id", runIds);
  projectIds = [];
  documentIds = [];
  runIds = [];
}
