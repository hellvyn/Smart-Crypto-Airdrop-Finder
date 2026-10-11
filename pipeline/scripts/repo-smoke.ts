// Smoke test of SupabaseRepo against a local Supabase (`supabase start`). It writes and deletes rows and runs a
// text purge over all documents, so it refuses to run against anything but a local stack.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [SUPABASE_ANON_KEY=...] pnpm --filter pipeline exec tsx scripts/repo-smoke.ts
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../src/store/supabase-repo.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) throw new Error("refusing to run against a non-local Supabase");

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
  // merge_failed is not pending, survives a same-hash upsert, and re-pends on a hash change.
  const mf = await repo.upsertDocument(doc("mf"), "m1");
  await repo.setExtractionStatus(mf.id, "merge_failed");
  assert.ok(!(await repo.listPendingDocuments(1000)).some((d) => d.id === mf.id));
  assert.equal((await repo.upsertDocument(doc("mf"), "m1")).extractionStatus, "merge_failed");
  assert.equal((await repo.upsertDocument(doc("mf", { text: "changed" }), "m2")).extractionStatus, "pending");

  // Pending documents with purged (empty) text are not listed, even when they are the oldest.
  const empty = await repo.upsertDocument(doc("empty", { text: "", fetchedAt: new Date(Date.UTC(1999, 0, 1)) }), "e1");
  assert.equal(empty.extractionStatus, "pending");
  assert.ok(!(await repo.listPendingDocuments(1000)).some((d) => d.id === empty.id));

  // Deterministic pending order: fetched_at asc, url asc. Year-2000 dates sort before everything else.
  const old = (n: number) => new Date(Date.UTC(2000, 0, 1, 0, 0, n));
  // "t-b" sorts before "ta" in byte order (C collation) but after it in en_US, so this pins the collation.
  await repo.upsertDocument(doc("ta", { fetchedAt: old(0) }), "ta");
  await repo.upsertDocument(doc("t-b", { fetchedAt: old(0) }), "tb");
  await repo.upsertDocument(doc("o3", { fetchedAt: old(2) }), "o3");
  await repo.upsertDocument(doc("o1", { fetchedAt: old(1) }), "o1");
  await repo.upsertDocument(doc("o2", { fetchedAt: old(2) }), "o2");
  assert.deepEqual(
    (await repo.listPendingDocuments(5)).map((d) => d.url),
    [doc("t-b").url, doc("ta").url, doc("o1").url, doc("o2").url, doc("o3").url],
  );
  // A re-upsert with a newer fetched_at moves the document to the back.
  await repo.upsertDocument(doc("o1", { fetchedAt: old(3) }), "o1");
  assert.deepEqual(
    (await repo.listPendingDocuments(5)).map((d) => d.url),
    [doc("t-b").url, doc("ta").url, doc("o2").url, doc("o3").url, doc("o1").url],
  );

  await repo.saveExtraction(
    a.id,
    { model: "freellm:auto", servedModel: "gpt-oss:120b", httpStatus: 200, finishReason: "stop", latencyMs: 12.4, error: null, raw: "{}" },
    "v1",
  );
  const { data: savedExtractions, error: extractionReadError } = await admin
    .from("extractions")
    .select("model, served_model, latency_ms")
    .eq("document_id", a.id);
  assert.equal(extractionReadError, null);
  assert.deepEqual(savedExtractions, [{ model: "freellm:auto", served_model: "gpt-oss:120b", latency_ms: 12 }]);

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
  assert.equal(await repo.slugExists(`smoke-${suffix}-2`), true);
  assert.equal(await repo.slugExists(`smoke-${suffix}-3`), false);
  // Same first_seen, so slug breaks the tie: "smoke-<x>" before "smoke-<x>-2".
  assert.deepEqual((await repo.findProjectsByNameKey(nameKey)).map((x) => x.id), [p.id, twin.id]);
  assert.equal(twin.lookalikeOf, p.id);
  const t1 = new Date(T0.getTime() + 1000);
  await repo.updateProject(p.id, { status: "live", conflict: true }, t1);
  await repo.updateProject(p.id, { status: "live" }, new Date(T0.getTime() + 2000));
  const ev = { projectId: p.id, documentId: a.id, field: "status", value: "live", quote: "is live", at: T0 };
  await repo.addEvidence(ev);
  await repo.addEvidence(ev);
  assert.deepEqual(await repo.listStatusEvidence(p.id), [{ status: "live", at: T0 }]);
  // Equal `at`: insertion order decides (deriveStatus relies on a stable order).
  const b = await repo.upsertDocument(doc("b"), "b1");
  await repo.addEvidence({ ...ev, documentId: b.id, value: "ended", quote: "ended" });
  await repo.addEvidence({ ...ev, documentId: b.id, value: "announced", quote: "announced" });
  assert.deepEqual(
    (await repo.listStatusEvidence(p.id)).map((x) => x.status),
    ["live", "ended", "announced"],
  );
  // evidence.source_url is copied from documents.url at insert (trigger).
  const sourceUrls = await admin.from("evidence").select("document_id, source_url").eq("project_id", p.id).order("seq");
  assert.equal(sourceUrls.error, null);
  assert.deepEqual(
    (sourceUrls.data ?? []).map((r) => r.source_url),
    [a.url, b.url, b.url],
  );
  // deleteEvidence removes one field of one (project, document) pair only.
  await repo.addEvidence({ ...ev, documentId: b.id, field: "dangerous_ask", value: "asks_payment", quote: "Send 0.1 ETH to claim your tokens." });
  await repo.addEvidence({ ...ev, documentId: a.id, field: "dangerous_ask", value: "asks_secret", quote: "Enter your seed phrase." });
  await repo.deleteEvidence(p.id, b.id, "status");
  assert.deepEqual((await repo.listStatusEvidence(p.id)).map((x) => x.status), ["live"]);

  await repo.replaceTasks(p.id, a.id, [
    { text: "Bridge", cadence: "once" },
    { text: "Swap", cadence: "daily" },
  ]);
  await repo.replaceTasks(p.id, a.id, [{ text: "Bridge only", cadence: "once" }]);
  // Rows stored out of step order come back by position.
  const outOfOrder = await admin.from("tasks").insert([
    { project_id: p.id, document_id: b.id, description: "Vote", position: 1, cadence: "weekly" },
    { project_id: p.id, document_id: b.id, description: "Check in", position: 0, cadence: "daily" },
  ]);
  assert.equal(outOfOrder.error, null);
  // v3 facts are evidence rows; status and dangerous_ask evidence are not facts.
  await repo.addEvidence({ ...ev, field: "key_parameter:allocation", value: "5%", quote: "5% of supply." });
  await repo.addEvidence({ ...ev, field: "capital_min_usd", value: "1000", quote: "" });
  await repo.replaceDeadlines(p.id, a.id, [{ kind: "claim", date: "2026-11-01", precision: "exact", text: "Nov 1" }]);
  await repo.replaceDeadlines(p.id, a.id, [{ kind: "snapshot", date: null, precision: "approximate", text: "soon" }]);
  await repo.upsertLinks(p.id, [{ url: "https://smoke.test/", kind: "website", referralStripped: false }]);
  await repo.upsertLinks(p.id, [{ url: "https://smoke.test/", kind: "claim", referralStripped: true }]);

  const scored = (await repo.listProjectsForScoring(30, T0)).find((x) => x.id === p.id);
  assert.ok(scored);
  // Steps are grouped by document (document_id order), in position order within each document.
  const stepsA = [{ text: "Bridge only", cadence: "once" }];
  const stepsB = [
    { text: "Check in", cadence: "daily" },
    { text: "Vote", cadence: "weekly" },
  ];
  assert.deepEqual(scored.steps, a.id < b.id ? [...stepsA, ...stepsB] : [...stepsB, ...stepsA]);
  assert.deepEqual(scored.tasks, a.id < b.id ? ["Bridge only", "Check in", "Vote"] : ["Check in", "Vote", "Bridge only"]);
  assert.deepEqual(scored.facts, [
    { field: "key_parameter:allocation", value: "5%", quote: "5% of supply." },
    { field: "capital_min_usd", value: "1000", quote: "" },
  ]);
  assert.deepEqual(scored.links, [{ url: "https://smoke.test/", kind: "claim" }]);
  assert.equal(scored.sourceCount, 1);
  assert.deepEqual(scored.sourceKinds, ["airdrops_io"]);
  // dangerous_ask evidence comes back in insertion order; no lookalike for p, the twin names p.
  assert.deepEqual(scored.sourceAsks, [
    { code: "asks_payment", quote: "Send 0.1 ETH to claim your tokens." },
    { code: "asks_secret", quote: "Enter your seed phrase." },
  ]);
  assert.equal(scored.lookalikeOfName, null);
  assert.deepEqual(scored.lookalikeOfDomains, []);
  const scoredTwin = (await repo.listProjectsForScoring(30, T0)).find((x) => x.id === twin.id);
  assert.ok(scoredTwin);
  assert.equal(scoredTwin.lookalikeOf, p.id);
  assert.equal(scoredTwin.lookalikeOfName, "Smoke");
  assert.deepEqual(scoredTwin.lookalikeOfDomains, ["smoke.test"]);
  assert.deepEqual(scoredTwin.sourceAsks, []);
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
  // Equal computed_at: the later insert wins.
  await repo.saveRiskAssessment(p.id, assessment("low"), new Date(T0.getTime() + 3000));
  assert.equal(await repo.latestRiskLevel(p.id), "low");

  const changes = await admin
    .from("project_changes")
    .select("field, old_value, new_value")
    .eq("project_id", p.id)
    .order("changed_at");
  assert.equal(changes.error, null);
  assert.deepEqual(changes.data, [
    { field: "status", old_value: "announced", new_value: "live" },
    { field: "risk_level", old_value: null, new_value: "low" },
    { field: "risk_level", old_value: "low", new_value: "high" },
    { field: "risk_level", old_value: "high", new_value: "low" },
  ]);

  // signals: replaced as a whole; one kind from two sources is allowed; a duplicate or a verified claim is refused.
  await repo.replaceSignals(p.id, [
    { kind: "tvl", value: { tvl_usd: 25_000_000 }, source: "defillama", verified: true },
    { kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, source: "vc_portfolio", verified: true },
  ], T0);
  await repo.replaceSignals(p.id, [
    { kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: true },
    { kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: true },
  ], t1);
  const signals = await admin.from("project_signals").select("kind, source, observed_at").eq("project_id", p.id).order("source");
  assert.equal(signals.error, null);
  assert.deepEqual(
    (signals.data ?? []).map((s) => [s.kind, s.source, new Date(s.observed_at as string).getTime()]),
    [["curated_source", "airdrops_io", t1.getTime()], ["curated_source", "alphadrops", t1.getTime()]],
  );
  const paradigm = { kind: "vc_backer" as const, value: { investor: "Paradigm" }, source: "vc_portfolio" as const, verified: true };
  await assert.rejects(repo.replaceSignals(p.id, [paradigm, paradigm], t1));
  await assert.rejects(
    repo.replaceSignals(p.id, [{ kind: "claimed_backer", value: { investor: "a16z" }, source: "llm_text", verified: true }], t1),
  );
  // Not atomic (delete, then insert; like replaceTasks): a refused replace leaves no signals until the next run.
  const afterRefused = await admin.from("project_signals").select("id").eq("project_id", p.id);
  assert.deepEqual(afterRefused.data, []);
  // Kept sources (DefiLlama not checked this run) survive a replace with their own observed_at.
  await repo.replaceSignals(p.id, [
    { kind: "tvl", value: { tvl_usd: 25_000_000 }, source: "defillama", verified: true },
    { kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: false },
  ], T0);
  await repo.replaceSignals(p.id, [
    { kind: "curated_source", value: { source_kind: "telegram" }, source: "telegram", verified: false },
  ], t1, ["defillama"]);
  const kept = await admin.from("project_signals").select("kind, source, observed_at").eq("project_id", p.id).order("source");
  assert.equal(kept.error, null);
  assert.deepEqual(
    (kept.data ?? []).map((s) => [s.kind, s.source, new Date(s.observed_at as string).getTime()]),
    [["tvl", "defillama", T0.getTime()], ["curated_source", "telegram", t1.getTime()]],
  );
  // Kept investors (a VC whose portfolio was not checked this run) survive; the source's other signals do not.
  const backer = (investor: string) => ({ kind: "vc_backer" as const, value: { investor, tier: 2 }, source: "vc_portfolio" as const, verified: true });
  const noInvestor = { kind: "vc_backer" as const, value: { tier: 1 }, source: "vc_portfolio" as const, verified: true };
  await repo.replaceSignals(p.id, [backer("Paradigm"), backer('Odd "Name", (Fund)'), backer("Variant"), noInvestor], T0);
  await repo.replaceSignals(p.id, [], t1, [
    { source: "vc_portfolio", investor: 'Odd "Name", (Fund)' },
    { source: "vc_portfolio", investor: "Variant" },
  ]);
  const keptBackers = await admin.from("project_signals").select("value").eq("project_id", p.id);
  assert.equal(keptBackers.error, null);
  assert.deepEqual(
    (keptBackers.data ?? []).map((s) => (s.value as { investor: string }).investor).sort(),
    ['Odd "Name", (Fund)', "Variant"],
  );
  // A kept kind (AlphaDrops raises not checked this run) survives; the source's other kinds do not.
  const reported = (investor: string) => ({ kind: "reported_backer" as const, value: { investor, lead: true, amount_usd: 5_000_000 }, source: "alphadrops" as const, verified: false });
  await repo.replaceSignals(p.id, [
    reported("Paradigm"),
    reported("Variant"),
    { kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: false },
    { kind: "tvl", value: { tvl_usd: 1 }, source: "defillama", verified: true },
  ], T0);
  await repo.replaceSignals(p.id, [
    { kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: false },
  ], t1, [{ source: "alphadrops", kind: "reported_backer" }]);
  const keptReported = await admin.from("project_signals").select("kind, value, observed_at").eq("project_id", p.id);
  assert.equal(keptReported.error, null);
  assert.deepEqual(
    (keptReported.data ?? [])
      .map((s) => [s.kind, (s.value as { investor?: string }).investor ?? "", new Date(s.observed_at as string).getTime()])
      .sort(),
    [["curated_source", "", t1.getTime()], ["reported_backer", "Paradigm", T0.getTime()], ["reported_backer", "Variant", T0.getTime()]],
  );
  await assert.rejects(
    repo.replaceSignals(p.id, [{ ...reported("Paradigm"), verified: true }], t1),
    "a verified reported_backer must be refused",
  );
  await repo.replaceSignals(p.id, [
    { kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: true },
    { kind: "claimed_backer", value: { investor: "a16z", quote: "backed by a16z" }, source: "llm_text", verified: false },
  ], t1);

  // AlphaDrops raise cache: one row per slug, a later save replacing it.
  const raiseSlug = `smoke-raise-${suffix}`;
  const seed = { round: "Seed", date: "2026-01-02", amountUsd: 5_000_000, lead: ["Paradigm"], others: ["Variant"], sourceUrl: null };
  assert.equal(await repo.listAlphaRaise(raiseSlug), null);
  await repo.saveAlphaRaise(raiseSlug, { officialDomain: "catalyst.app", rounds: [seed] }, T0);
  await repo.saveAlphaRaise(raiseSlug, { officialDomain: null, rounds: [seed, { ...seed, round: "Series A", amountUsd: null }] }, t1);
  assert.deepEqual(await repo.listAlphaRaise(raiseSlug), {
    officialDomain: null,
    rounds: [seed, { ...seed, round: "Series A", amountUsd: null }],
    fetchedAt: t1,
  });

  // VC portfolio cache
  const vcId = `smoke-vc-${suffix}`;
  assert.deepEqual(await repo.listVcPortfolio(vcId), { domains: [], fetchedAt: null });
  await repo.saveVcPortfolio(vcId, ["zora.co", "blast.io", "zora.co"], T0);
  await repo.saveVcPortfolio(vcId, ["zora.co", "a-b.io", "ab.io"], t1);
  // "a-b.io" sorts before "ab.io" in byte order (C collation).
  assert.deepEqual(await repo.listVcPortfolio(vcId), { domains: ["a-b.io", "ab.io", "zora.co"], fetchedAt: t1 });

  // AI analyses: latest per kind, later insert wins a created_at tie.
  const analysis = { projectId: p.id, kind: "analyst" as const, inputHash: "h1", result: { verdict: "pantau" }, model: "router:auto", servedModel: null, promptVersion: "analyst-1", createdAt: t1 };
  assert.equal(await repo.latestAiAnalysis(p.id, "analyst"), null);
  await repo.saveAiAnalysis(analysis);
  await repo.saveAiAnalysis({ ...analysis, inputHash: "h2", servedModel: "gpt-oss:120b" });
  await repo.saveAiAnalysis({ ...analysis, kind: "contradictions", inputHash: "c1", result: { items: [] } });
  assert.deepEqual(await repo.latestAiAnalysis(p.id, "analyst"), { ...analysis, inputHash: "h2", servedModel: "gpt-oss:120b" });
  assert.equal(await repo.latestAiAnalysis(p.id, "scam"), null);

  // curations
  const passing = { passed: true, worthLevel: "medium" as const, tab: "live_now" as const, statusAt: "live" as const, endedOn: null, reasons: [], coverage: { defillama: true } };
  const failing = { ...passing, passed: false, worthLevel: null, tab: null, reasons: [
    { code: "official_domain", message: "Domain resmi tercatat", kind: "pass" as const },
    { code: "insufficient_checks", message: "Cek kunci belum lengkap", kind: "fail" as const },
  ] };
  assert.equal(await repo.latestCuration(p.id), null);
  assert.equal(await repo.passedBeforeEnd(p.id), false);
  await repo.saveCuration(p.id, passing, new Date(T0.getTime() + 10_000));
  await repo.saveCuration(p.id, { ...passing, statusAt: "ended", tab: "ended", endedOn: "2026-10-05" }, new Date(T0.getTime() + 11_000));
  assert.equal(await repo.passedBeforeEnd(p.id), true);
  assert.deepEqual(await repo.latestCuration(p.id), { passed: true, endedOn: "2026-10-05" });
  await repo.saveCuration(p.id, failing, new Date(T0.getTime() + 11_000));
  assert.deepEqual(await repo.latestCuration(p.id), { passed: false, endedOn: null });
  assert.equal(await repo.passedBeforeEnd(p.id), false);
  const curated = await admin.from("project_changes").select("old_value, new_value").eq("project_id", p.id).eq("field", "curated").order("seq");
  assert.equal(curated.error, null);
  assert.deepEqual(curated.data, [{ old_value: null, new_value: "true" }, { old_value: "true", new_value: "false" }]);
  const failReasons = await admin.from("curations").select("public_fail_reason").eq("project_id", p.id).order("seq");
  assert.equal(failReasons.error, null);
  assert.deepEqual((failReasons.data ?? []).map((r) => r.public_fail_reason), [null, null, "Cek kunci belum lengkap"]);

  // runs
  const runId = await repo.startRun(T0);
  await repo.finishRun(runId, { documents: 3, sourceFailed: 0 }, t1);
  const run = await admin.from("pipeline_runs").select("stats, finished_at").eq("id", runId).single();
  assert.equal(run.error, null);
  assert.deepEqual(run.data?.stats, { documents: 3, sourceFailed: 0 });

  // purge: the smoke documents are fetched at T0, so purge relative to a far-future "now"
  const purged = await repo.purgeDocumentText(90, new Date(T0.getTime() + 100 * day));
  assert.ok(purged >= 9);
  const after = await admin.from("documents").select("text, content_hash").eq("url", doc("a").url).single();
  assert.equal(after.error, null);
  assert.deepEqual(after.data, { text: "", content_hash: "h2" });
  assert.equal(await repo.purgeDocumentText(90, new Date(T0.getTime() + 100 * day)), 0);

  // RLS and privileges: anon reads display tables but not documents/extractions/project_changes, and cannot write.
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (anonKey) {
    const anon = createClient(url as string, anonKey, { auth: { persistSession: false } });
    const proj = await anon.from("projects").select("id").eq("id", p.id);
    assert.equal(proj.error, null);
    assert.equal(proj.data?.length, 1);
    for (const table of ["documents", "extractions", "project_changes"]) {
      const res = await anon.from(table).select("*").limit(1);
      assert.deepEqual(res.data ?? [], [], `${table} must not be readable by anon`);
    }
    const update = await anon.from("projects").update({ name: "hacked" }).eq("id", p.id).select();
    assert.ok(update.error !== null || (update.data ?? []).length === 0, "anon must not update projects");
    const insert = await anon.from("projects").insert({
      slug: `anon-${suffix}`, name: "x", name_key: nameKey, first_seen: T0.toISOString(), last_seen: T0.toISOString(),
    });
    assert.ok(insert.error !== null, "anon must not insert projects");
    const del = await anon.from("projects").delete().eq("id", p.id).select();
    assert.ok(del.error !== null || (del.data ?? []).length === 0, "anon must not delete projects");
    const stillThere = await admin.from("projects").select("id, name").eq("id", p.id).single();
    assert.equal(stillThere.error, null);
    assert.equal(stillThere.data?.name, "Smoke");
    const noAnonRow = await admin.from("projects").select("id").eq("slug", `anon-${suffix}`);
    assert.equal(noAnonRow.data?.length, 0);
    // Curation data over REST (#45, #54, #55): public columns yes, worth and member-only analyses no.
    const publicCuration = await anon.from("curations").select("passed, tab, public_fail_reason").eq("project_id", p.id);
    assert.equal(publicCuration.error, null);
    assert.equal(publicCuration.data?.length, 3);
    for (const column of ["worth_level", "reasons", "coverage", "*"]) {
      const res = await anon.from("curations").select(column).eq("project_id", p.id);
      assert.ok(res.error !== null && (res.data ?? []).length === 0, `anon must not read curations.${column}`);
    }
    const anonAnalyses = await anon.from("ai_analyses").select("kind").eq("project_id", p.id);
    assert.equal(anonAnalyses.error, null);
    assert.deepEqual(anonAnalyses.data, [{ kind: "contradictions" }]);
    const anonSignals = await anon.from("project_signals").select("kind").eq("project_id", p.id);
    assert.equal(anonSignals.error, null);
    assert.equal(anonSignals.data?.length, 2);
    const anonVc = await anon.from("vc_portfolios").select("domain").eq("vc_id", vcId);
    assert.deepEqual(anonVc.data ?? [], [], "vc_portfolios must not be readable by anon");
    const anonRaise = await anon.from("alphadrops_raises").select("slug").eq("slug", raiseSlug);
    assert.deepEqual(anonRaise.data ?? [], [], "alphadrops_raises must not be readable by anon");
    console.log("rls ok");
  } else {
    console.log("rls checks skipped (SUPABASE_ANON_KEY not set)");
  }

  // cleanup (fail loudly so a broken cleanup is not silent)
  const cleanup = [
    await admin.from("projects").delete().in("id", [p.id, twin.id]),
    await admin.from("documents").delete().like("source_key", `%${suffix}%`),
    await admin.from("documents").delete().like("url", `https://t.me/${channel}/%`),
    await admin.from("pipeline_runs").delete().eq("id", runId),
    await admin.from("vc_portfolios").delete().eq("vc_id", vcId),
    await admin.from("alphadrops_raises").delete().eq("slug", raiseSlug),
  ];
  for (const r of cleanup) assert.equal(r.error, null, `cleanup failed: ${r.error?.message ?? ""}`);
  console.log("repo smoke ok");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
