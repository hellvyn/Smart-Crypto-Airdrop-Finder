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
  /** Also has a claim link checked as phishing (`phishingUrl`), which must never be an anchor (#42). */
  main: SeededProject & { phishingUrl: string };
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
let linkCheckUrls: string[] = [];

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

  // Project 1: risk, deadline, evidence, links, tasks (once, daily and weekly steps).
  const main: Seed["main"] = {
    slug: `e2e-main-${tag}`,
    name: `E2E Main ${tag}`,
    sourceUrl: `https://source.example/e2e-main-${tag}`,
    claimUrl: `https://checker.example/${tag}`,
    phishingUrl: `https://claim-phish-${tag}.example/claim`,
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
      .insert([
        // Source steps in step order: one main (once) task, two daily ones and a weekly one (farming tracker).
        { project_id: mainId, document_id: mainDoc, description: "Bridge to the main chain", cadence: "once", position: 0 },
        { project_id: mainId, document_id: mainDoc, description: "Swap once on the DEX", cadence: "daily", position: 1 },
        { project_id: mainId, document_id: mainDoc, description: "Check in on the points page", cadence: "daily", position: 2 },
        { project_id: mainId, document_id: mainDoc, description: "Join the weekly quest", cadence: "weekly", position: 3 },
      ])
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
        { project_id: mainId, url: main.phishingUrl, kind: "claim" },
      ])
      .select("id"),
    "links",
  );
  must(
    await db.from("link_checks").insert({ url: main.phishingUrl, status: "phishing", checked_at: new Date().toISOString() }).select("url"),
    "phishing link check",
  );
  linkCheckUrls.push(main.phishingUrl);
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
        // v3 extraction facts: each has its own place on the project page (Plan 6 Task 5).
        ...[
          { field: "claimed_backer", value: "Paradigm", quote: `Backed by Paradigm ${tag}` },
          { field: "key_parameter:allocation", value: "10% of supply", quote: `10% of supply ${tag}` },
          { field: "source_rating:difficulty", value: "Easy", quote: `Difficulty: Easy ${tag}` },
          { field: "latest_update", value: "2026-10-01", quote: `Season 2 announced ${tag}` },
          { field: "capital_required", value: "high", quote: "" },
          { field: "capital_min_usd", value: "500", quote: "" },
        ].map((f) => ({ project_id: mainId, document_id: mainDoc, ...f, at: new Date().toISOString() })),
      ])
      .select("id"),
    "evidence",
  );

  // Project 2: conflicting status sources, no chains, no steps.
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
  if (linkCheckUrls.length) await db.from("link_checks").delete().in("url", linkCheckUrls);
  projectIds = [];
  documentIds = [];
  runIds = [];
  linkCheckUrls = [];
}

/** Seeds `count` live projects on one unique chain, newest last_seen first by index. Returns the chain name. */
export async function seedManyProjects(count: number): Promise<{ chain: string; slugs: string[] }> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const chain = `pg${tag}`;
  const base = Date.now();
  const rows = Array.from({ length: count }, (_, i) => ({
    slug: `e2e-page-${tag}-${String(i).padStart(3, "0")}`,
    name: `E2E Page ${tag} ${String(i).padStart(3, "0")}`,
    name_key: `e2epage${tag}${i}`,
    chains: [chain.toUpperCase()], // stored mixed-case on purpose: the chain filter is case-insensitive
    status: "live",
    first_seen: new Date(base - 1000).toISOString(),
    // index 0 is the most recently seen, so it is first in the default order.
    last_seen: new Date(base - i * 60_000).toISOString(),
  }));
  const data = must(await adminClient().from("projects").insert(rows).select("id, slug"), "many projects");
  const ids = new Map((data as { id: string; slug: string }[]).map((r) => [r.slug, r.id]));
  projectIds.push(...ids.values());
  // Each one passed curation in the live tab; index 0 was checked last, so it is first in the visitor order too.
  must(
    await adminClient()
      .from("curations")
      .insert(
        rows.map((r, i) => ({
          project_id: ids.get(r.slug),
          passed: true,
          worth_level: "medium",
          tab: "live_now",
          status_at: "live",
          computed_at: new Date(base - i * 60_000).toISOString(),
        })),
      )
      .select("id"),
    "many curations",
  );
  return { chain, slugs: rows.map((r) => r.slug) };
}

export interface CuratedSeed {
  /** live_now, free, worth low, every key check ran, VC + AlphaDrops + curated source, open claim with an official link. */
  live: SeededProject;
  /** early_bets, capital unknown, worth medium, verified TVL and CoinGecko. */
  early: SeededProject;
  /** ended on 2025-01-15 (more than 90 days ago, so its last check is frozen), 2 of 4 key checks ran. */
  ended: SeededProject;
  /** Its latest curation failed: in no tab at all. */
  failed: SeededProject;
}

/**
 * The curated list (Plan 6 Task 4): one project per tab that passed curation and one that failed, plus a successful
 * run with "4 dicek, 3 lolos" and a track record of 12. Seed it after `seedProjects` so its run is the newest.
 */
export async function seedCuratedList(): Promise<CuratedSeed> {
  const db = adminClient();
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const project = (key: string, name: string): SeededProject => ({
    slug: `e2e-cl-${key}-${tag}`,
    name: `E2E CL ${name} ${tag}`,
    sourceUrl: `https://source.example/e2e-cl-${key}-${tag}`,
    claimUrl: `https://claim-${key}-${tag}.example/`,
  });
  const seed: CuratedSeed = {
    live: project("live", "Live"),
    early: project("early", "Early"),
    ended: project("ended", "Ended"),
    failed: project("failed", "Failed"),
  };
  const ids: Record<keyof CuratedSeed, string> = {
    live: await insertProject({ slug: seed.live.slug, name: seed.live.name, name_key: seed.live.slug, chains: ["base"], status: "live" }),
    early: await insertProject({ slug: seed.early.slug, name: seed.early.name, name_key: seed.early.slug, chains: ["ethereum"], status: "speculative" }),
    ended: await insertProject({ slug: seed.ended.slug, name: seed.ended.name, name_key: seed.ended.slug, chains: ["base"], status: "ended" }),
    failed: await insertProject({ slug: seed.failed.slug, name: seed.failed.name, name_key: seed.failed.slug, chains: ["base"], status: "live" }),
  };
  const liveDoc = await insertDocument(seed.live.sourceUrl);

  const KEY = ["dangerous_asks", "phishing_list", "domain_age", "lookalike"];
  const checks = (ran: number) => [...KEY.map((id, i) => ({ id, ran: i < ran })), { id: "hack_history", ran: true }];
  must(
    await db
      .from("risk_assessments")
      .insert([
        { project_id: ids.live, level: "low", points: 0, reasons: [], checks: checks(4), computed_at: at(3_600_000) },
        { project_id: ids.early, level: "low", points: 0, reasons: [], checks: checks(4), computed_at: at(3_600_000) },
        { project_id: ids.ended, level: "low", points: 0, reasons: [], checks: checks(2), computed_at: "2025-04-01T23:00:00Z" },
        { project_id: ids.failed, level: "high", points: 60, reasons: [], checks: checks(4), computed_at: at(3_600_000) },
      ])
      .select("id"),
    "curated risk",
  );
  must(
    await db
      .from("curations")
      .insert([
        { project_id: ids.live, passed: true, worth_level: "low", tab: "live_now", status_at: "live", computed_at: at(3_600_000) },
        { project_id: ids.early, passed: true, worth_level: "medium", tab: "early_bets", status_at: "speculative", computed_at: at(1_800_000) },
        {
          project_id: ids.ended,
          passed: true,
          worth_level: "medium",
          tab: "ended",
          status_at: "ended",
          ended_on: "2025-01-15",
          computed_at: "2025-04-01T23:00:00Z",
        },
        // Passed once, then failed: the latest curation decides.
        { project_id: ids.failed, passed: true, worth_level: "high", tab: "live_now", status_at: "live", computed_at: at(86_400_000) },
        { project_id: ids.failed, passed: false, status_at: "live", public_fail_reason: "Risiko tinggi", computed_at: at(3_600_000) },
      ])
      .select("id"),
    "curations",
  );
  must(
    await db
      .from("project_signals")
      .insert([
        { project_id: ids.live, kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, source: "vc_portfolio", verified: true, observed_at: at(0) },
        { project_id: ids.live, kind: "reported_backer", value: { investor: "a16z", lead: true }, source: "alphadrops", verified: false, observed_at: at(0) },
        { project_id: ids.live, kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: false, observed_at: at(0) },
        { project_id: ids.early, kind: "tvl", value: { tvl_usd: 45_000_000 }, source: "defillama", verified: true, observed_at: at(0) },
        { project_id: ids.early, kind: "coingecko_listed", value: { gecko_id: `e2e-${tag}` }, source: "defillama", verified: true, observed_at: at(0) },
        { project_id: ids.ended, kind: "curated_source", value: { source_kind: "telegram" }, source: "telegram", verified: false, observed_at: at(0) },
      ])
      .select("id"),
    "signals",
  );
  // Live: free (its source says no capital), an open claim whose only claim link is official.
  must(
    await db
      .from("evidence")
      .insert({ project_id: ids.live, document_id: liveDoc, field: "capital_required", value: "none", quote: "", at: at(0) })
      .select("id"),
    "capital",
  );
  must(
    await db
      .from("deadlines")
      .insert({ project_id: ids.live, document_id: liveDoc, kind: "claim", date: day(7), precision: "exact", text: "Claim" })
      .select("id"),
    "claim deadline",
  );
  must(await db.from("links").insert({ project_id: ids.live, url: seed.live.claimUrl, kind: "claim" }).select("id"), "claim link");
  must(
    await db.from("link_checks").insert({ url: seed.live.claimUrl, status: "official", checked_at: at(0) }).select("url"),
    "link check",
  );
  linkCheckUrls.push(seed.live.claimUrl);

  const run = must(
    await db
      .from("pipeline_runs")
      .insert({
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        stats: {
          curation_checked: 4,
          curation_passed: 3,
          track_record_total: 12,
          track_record_listed: 5,
          track_record_no_token: 4,
          track_record_risk_raised: 3,
        },
      })
      .select("id")
      .single(),
    "curated run",
  );
  runIds.push(run.id as string);
  return seed;
}

export interface ProjectPageSeed extends SeededProject {
  /** Text only a member may ever receive (#54): an Analyst point, its effort note, the curation's reason. */
  memberOnly: { point: string; effortNote: string; reason: string };
  /** The public contradiction's explanation and the Indonesian step text. */
  contradiction: string;
  step: string;
  update: string;
}

/**
 * The new project page (Plan 6 Task 5): a project that passed curation with every key check and three advanced checks
 * run (hack history: 0 cases), an AI verdict, a contradiction, steps with Indonesian text, an update, a verified VC
 * and a claimed backer, and an open claim whose only claim link is official.
 */
export async function seedProjectPage(): Promise<ProjectPageSeed> {
  const db = adminClient();
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
  const seed: ProjectPageSeed = {
    slug: `e2e-pp-${tag}`,
    name: `E2E PP ${tag}`,
    sourceUrl: `https://source.example/e2e-pp-${tag}`,
    claimUrl: `https://claim.e2e-pp-${tag}.example/`,
    memberOnly: {
      point: `Poin analisis khusus member ${tag}`,
      effortNote: `Catatan effort khusus member ${tag}`,
      reason: `Catatan penilaian khusus member ${tag}`,
    },
    contradiction: `Satu source bilang belum ada token ${tag}`,
    step: `Trade minimal sekali di app ${tag}`,
    update: `Season 2 points program udah mulai ${tag}`,
  };
  const otherSource = `https://t.me/e2e_pp_${tag}/1`;
  const id = await insertProject({ slug: seed.slug, name: seed.name, name_key: seed.slug, chains: ["base"], status: "live" });
  const docA = await insertDocument(seed.sourceUrl);
  const docB = await insertDocument(otherSource);

  must(
    await db
      .from("risk_assessments")
      .insert({
        project_id: id,
        level: "low",
        points: 0,
        reasons: [],
        checks: [
          { id: "dangerous_asks", ran: true, detail: { sources: 2 } },
          { id: "phishing_list", ran: true, detail: { checked: 2, hits: 0 } },
          { id: "domain_age", ran: true, detail: { domain: `e2e-pp-${tag}.example`, ageDays: 820 } },
          { id: "lookalike", ran: true, detail: { compared: 1240 } },
          { id: "token_security", ran: false },
          { id: "contract_verified", ran: false },
          { id: "hack_history", ran: true, detail: { count: 0 } },
          { id: "corroboration", ran: true, detail: { sources: 2 } },
          { id: "ai_review", ran: true },
        ],
        computed_at: at(3_600_000),
      })
      .select("id"),
    "page risk",
  );
  must(
    await db
      .from("curations")
      .insert({
        project_id: id,
        passed: true,
        worth_level: "high",
        tab: "live_now",
        status_at: "live",
        reasons: [{ code: "e2e", kind: "worth", message: seed.memberOnly.reason }],
        computed_at: at(3_600_000),
      })
      .select("id"),
    "page curation",
  );
  must(
    await db
      .from("project_signals")
      .insert({ project_id: id, kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, source: "vc_portfolio", verified: true, observed_at: at(0) })
      .select("id"),
    "page signal",
  );
  const fact = (document_id: string, field: string, value: string, quote: string) => ({ project_id: id, document_id, field, value, quote, at: at(0) });
  must(
    await db
      .from("evidence")
      .insert([
        fact(docA, "status", "live", `Live now ${tag}`),
        fact(docA, "latest_update", "2026-10-01", seed.update),
        fact(docA, "source_rating:difficulty", "Easy", "Difficulty: Easy"),
        fact(docA, "key_parameter:allocation", "10% of supply", "10% of supply"),
        fact(docB, "claimed_backer", "Jump", `Backed by Jump ${tag}`),
      ])
      .select("id"),
    "page evidence",
  );
  must(
    await db
      .from("tasks")
      .insert([
        { project_id: id, document_id: docA, description: "Trade once a day", text_id: seed.step, cadence: "daily", position: 0 },
        { project_id: id, document_id: docA, description: "Bridge to Base", text_id: null, cadence: "once", position: 1 },
      ])
      .select("id"),
    "page tasks",
  );
  must(
    await db.from("deadlines").insert({ project_id: id, document_id: docA, kind: "claim", date: day(7), precision: "exact", text: "Claim" }).select("id"),
    "page deadline",
  );
  must(await db.from("links").insert({ project_id: id, url: seed.claimUrl, kind: "claim" }).select("id"), "page link");
  must(await db.from("link_checks").insert({ url: seed.claimUrl, status: "official", checked_at: at(0) }).select("url"), "page link check");
  linkCheckUrls.push(seed.claimUrl);

  const analysis = (kind: string, result: unknown) => ({
    project_id: id,
    kind,
    input_hash: `e2e-${kind}`,
    result,
    model: "e2e",
    prompt_version: "e2e",
    created_at: at(3_600_000),
  });
  must(
    await db
      .from("ai_analyses")
      .insert([
        analysis("analyst", {
          verdict: "garap",
          confidence: "tinggi",
          points: [{ text: seed.memberOnly.point, quote: "10% of supply", source_url: seed.sourceUrl }],
          effort: { minutes_per_day: 10, capital_usd_min: 100, note: seed.memberOnly.effortNote },
          steps_id: [],
        }),
        analysis("scam", { flags: [] }),
        analysis("contradictions", {
          items: [
            {
              topic: "Token",
              quote_a: "No token has been announced yet",
              url_a: seed.sourceUrl,
              quote_b: "TGE expected in Q1",
              url_b: otherSource,
              explanation: seed.contradiction,
            },
          ],
        }),
      ])
      .select("id"),
    "page analyses",
  );
  return seed;
}
