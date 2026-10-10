// Smoke test of SupabaseRepo against a local Supabase (`supabase start`).
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [SUPABASE_ANON_KEY=...] pnpm --filter pipeline exec tsx scripts/repo-smoke.ts
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../src/store/supabase-repo.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const repo = new SupabaseRepo(admin);

const T0 = new Date("2026-10-10T00:00:00Z");
const day = 86_400_000;
const suffix = Math.random().toString(36).slice(2, 8);
const nameKey = `smoke${suffix}`;
const base = `https://smoke.test/${suffix}`;

const doc = (path: string, extra: Partial<Parameters<SupabaseRepo["upsertDocument"]>[0]> = {}) => ({
  sourceKind: "airdrops_io" as const,
  sourceKey: `smoke:${suffix}`,
  url: `${base}/${path}`,
  text: "hello",
  publishedAt: null,
  pageUpdatedAt: null,
  fetchedAt: T0,
  ...extra,
});

async function main(): Promise<void> {
  // documents
  assert.equal(await repo.getDocumentHash(doc("a").url), null);
  const a = await repo.upsertDocument(doc("a"), "h1");
  assert.equal(a.extractionStatus, "pending");
  await repo.setExtractionStatus(a.id, "done");
  assert.equal((await repo.upsertDocument(doc("a"), "h1")).extractionStatus, "done");
  assert.equal((await repo.upsertDocument(doc("a", { text: "changed" }), "h2")).extractionStatus, "pending");
  assert.equal(await repo.getDocumentHash(doc("a").url), "h2");
  assert.ok((await repo.listPendingDocuments(1000)).some((d) => d.id === a.id));

  await repo.saveExtraction(
    a.id,
    { model: "m", httpStatus: 200, finishReason: "stop", latencyMs: 12.4, error: null, raw: "{}" },
    "v1",
  );

  // telegram
  const channel = `smoke_chan_${suffix}`;
  for (const id of [9, 120, 15]) {
    await repo.upsertDocument(
      doc(`tg${id}`, { sourceKind: "telegram", sourceKey: `telegram:${channel}`, url: `https://t.me/${channel}/${id}` }),
      `t${id}`,
    );
  }
  assert.equal(await repo.lastTelegramMessageId(channel), 120);
  assert.equal(await repo.lastTelegramMessageId(`nochan_${suffix}`), null);

  // projects, evidence and changes
  const p = await repo.createProject(
    { slug: `smoke-${suffix}`, name: "Smoke", nameKey, tokenSymbol: "SMK", chains: ["ethereum"], officialDomains: ["smoke.test"], status: "announced", conflict: false, lookalikeOf: null },
    T0,
  );
  const twin = await repo.createProject(
    { slug: `smoke-${suffix}-2`, name: "Smoke", nameKey, tokenSymbol: null, chains: [], officialDomains: [], status: "unknown", conflict: false, lookalikeOf: p.id },
    T0,
  );
  assert.equal((await repo.findProjectsByNameKey(nameKey)).length, 2);
  assert.equal(twin.lookalikeOf, p.id);
  const t1 = new Date(T0.getTime() + 1000);
  await repo.updateProject(p.id, { status: "live", conflict: true }, t1);
  await repo.updateProject(p.id, { status: "live" }, new Date(T0.getTime() + 2000));
  const ev = { projectId: p.id, documentId: a.id, field: "status", value: "live", quote: "is live", at: T0 };
  await repo.addEvidence(ev);
  await repo.addEvidence(ev);
  assert.deepEqual(await repo.listStatusEvidence(p.id), [{ status: "live", at: T0 }]);

  await repo.replaceTasks(p.id, a.id, ["Bridge", "Swap"]);
  await repo.replaceTasks(p.id, a.id, ["Bridge only"]);
  await repo.replaceDeadlines(p.id, a.id, [{ kind: "claim", date: "2026-11-01", precision: "exact", text: "Nov 1" }]);
  await repo.replaceDeadlines(p.id, a.id, [{ kind: "snapshot", date: null, precision: "approximate", text: "soon" }]);
  await repo.upsertLinks(p.id, [{ url: "https://smoke.test/", kind: "website", referralStripped: false }]);
  await repo.upsertLinks(p.id, [{ url: "https://smoke.test/", kind: "claim", referralStripped: true }]);

  const scored = (await repo.listProjectsForScoring(30, T0)).find((x) => x.id === p.id);
  assert.ok(scored);
  assert.deepEqual(scored.tasks, ["Bridge only"]);
  assert.deepEqual(scored.links, [{ url: "https://smoke.test/", kind: "claim" }]);
  assert.equal(scored.sourceCount, 1);
  assert.equal(scored.status, "live");
  assert.equal(scored.lastSeen.getTime(), T0.getTime() + 2000);
  assert.equal((await repo.listProjectsForScoring(30, new Date(T0.getTime() + 60 * day))).some((x) => x.id === p.id), false);

  // risk
  assert.equal(await repo.latestRiskLevel(p.id), null);
  const assessment = (level: "low" | "high") => ({ level, points: 1, reasons: [], checks: [] });
  await repo.saveRiskAssessment(p.id, assessment("low"), new Date(T0.getTime() + 1000));
  await repo.saveRiskAssessment(p.id, assessment("low"), new Date(T0.getTime() + 2000));
  await repo.saveRiskAssessment(p.id, assessment("high"), new Date(T0.getTime() + 3000));
  assert.equal(await repo.latestRiskLevel(p.id), "high");

  const changes = await admin
    .from("project_changes")
    .select("field, old_value, new_value")
    .eq("project_id", p.id)
    .order("changed_at");
  assert.deepEqual(changes.data, [
    { field: "status", old_value: "announced", new_value: "live" },
    { field: "risk_level", old_value: null, new_value: "low" },
    { field: "risk_level", old_value: "low", new_value: "high" },
  ]);

  // runs
  const runId = await repo.startRun(T0);
  await repo.finishRun(runId, { documents: 3, sourceFailed: 0 }, t1);
  const run = await admin.from("pipeline_runs").select("stats, finished_at").eq("id", runId).single();
  assert.deepEqual(run.data?.stats, { documents: 3, sourceFailed: 0 });

  // purge: the smoke documents are fetched at T0, so purge relative to a far-future "now"
  const purged = await repo.purgeDocumentText(90, new Date(T0.getTime() + 100 * day));
  assert.ok(purged >= 4);
  const after = await admin.from("documents").select("text, content_hash").eq("url", doc("a").url).single();
  assert.deepEqual(after.data, { text: "", content_hash: "h2" });
  assert.equal(await repo.purgeDocumentText(90, new Date(T0.getTime() + 100 * day)), 0);

  // RLS: anon reads display tables but not documents/extractions/project_changes
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (anonKey) {
    const anon = createClient(url as string, anonKey, { auth: { persistSession: false } });
    const proj = await anon.from("projects").select("id").eq("id", p.id);
    assert.equal(proj.data?.length, 1);
    for (const table of ["documents", "extractions", "project_changes"]) {
      const res = await anon.from(table).select("*").limit(1);
      assert.deepEqual(res.data ?? [], [], `${table} must not be readable by anon`);
    }
    const write = await anon.from("projects").update({ name: "hacked" }).eq("id", p.id).select();
    assert.deepEqual(write.data ?? [], [], "anon must not update projects");
    console.log("rls ok");
  }

  // cleanup
  await admin.from("projects").delete().in("id", [p.id, twin.id]);
  await admin.from("documents").delete().like("source_key", `%${suffix}%`);
  await admin.from("documents").delete().like("url", `https://t.me/${channel}/%`);
  await admin.from("pipeline_runs").delete().eq("id", runId);
  console.log("repo smoke ok");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
