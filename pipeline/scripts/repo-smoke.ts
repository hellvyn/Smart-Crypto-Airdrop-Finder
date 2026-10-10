// Smoke test of SupabaseRepo against a local Supabase (`supabase start`). It writes and deletes rows and runs a
// text purge over all documents, so it refuses to run against anything but a local stack.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [SUPABASE_ANON_KEY=...] pnpm --filter pipeline exec tsx scripts/repo-smoke.ts
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { DuplicateDigestError } from "../src/store/repo.js";
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

  // notifications (as service_role: auth admin API, profiles, watchlist, notification_log)
  const createUser = async (label: string, confirmed: boolean): Promise<string> => {
    const res = await admin.auth.admin.createUser({
      email: `smoke-${label}-${suffix}@example.test`,
      password: `pw-${suffix}-${label}-Aa1!`,
      email_confirm: confirmed,
    });
    assert.equal(res.error, null, `createUser ${label}: ${res.error?.message ?? ""}`);
    return (res.data.user as { id: string }).id;
  };
  const reader = await createUser("reader", true);
  const unconfirmed = await createUser("unconfirmed", false);
  const optedOut = await createUser("optedout", true);
  const userIds = [reader, unconfirmed, optedOut];
  const profileUpdates = [
    await admin.from("profiles").update({ new_airdrops_opt_in: true }).eq("user_id", reader),
    await admin.from("profiles").update({ digest_enabled: false }).eq("user_id", optedOut),
    await admin.from("watchlist").insert([
      { user_id: reader, project_id: p.id },
      { user_id: optedOut, project_id: p.id },
    ]),
  ];
  for (const r of profileUpdates) assert.equal(r.error, null, `seed failed: ${r.error?.message ?? ""}`);
  const token = await admin.from("profiles").select("unsubscribe_token").eq("user_id", reader).single();
  assert.equal(token.error, null);

  const ours = async () => (await repo.listDigestRecipients()).filter((r) => userIds.includes(r.userId));
  // Only the confirmed, digest-enabled user; no digest logged yet.
  assert.deepEqual(await ours(), [
    {
      userId: reader,
      email: `smoke-reader-${suffix}@example.test`,
      newAirdropsOptIn: true,
      unsubscribeToken: token.data?.unsubscribe_token,
      lastDigestAt: null,
    },
  ]);

  // Dated deadlines only, by date; the undated one from document a is left out.
  await repo.replaceDeadlines(p.id, b.id, [
    { kind: "claim", date: "2026-10-12", precision: "exact", text: "Claim" },
    { kind: "snapshot", date: "2026-10-11", precision: "approximate", text: "Snapshot" },
  ]);
  const sinceT0 = new Date(T0.getTime() + 1500);
  const ctx = await repo.getDigestContext(reader, sinceT0, new Date(T0.getTime() + 3600_000));
  assert.deepEqual(ctx.lastDigestAt, sinceT0);
  assert.deepEqual(ctx.watched, [
    { id: p.id, slug: `smoke-${suffix}`, name: "Smoke", status: "live", riskLevel: "low", firstSeen: T0 },
  ]);
  assert.deepEqual(ctx.deadlines, [
    { projectId: p.id, kind: "snapshot", date: "2026-10-11", precision: "approximate", text: "Snapshot" },
    { projectId: p.id, kind: "claim", date: "2026-10-12", precision: "exact", text: "Claim" },
  ]);
  // Changes strictly after `since` (the status change at T0+1s is before it), oldest first.
  assert.deepEqual(
    ctx.changes.map((c) => [c.field, c.oldValue, c.newValue, c.changedAt.getTime() - T0.getTime()]),
    [
      ["risk_level", "low", "high", 3000],
      ["risk_level", "high", "low", 3000],
    ],
  );
  // since = null: the 24 hours before `now`.
  const ctxNull = await repo.getDigestContext(reader, null, new Date(T0.getTime() + 24 * 3600_000 + 2500));
  assert.deepEqual(ctxNull.lastDigestAt, null);
  assert.equal(ctxNull.changes.length, 2);
  assert.deepEqual((await repo.getDigestContext(unconfirmed, null, T0)).watched, []);

  // New projects: first_seen within [now - 24h, now], lookalikes left out, with latest risk.
  const fresh = (await repo.listNewProjects(24, new Date(T0.getTime() + 3600_000), 1000)).filter((x) => [p.id, twin.id].includes(x.id));
  assert.deepEqual(
    fresh.map((x) => [x.id, x.riskLevel]),
    [[p.id, "low"]],
  );
  assert.equal(
    (await repo.listNewProjects(24, new Date(T0.getTime() + 25 * 3600_000), 1000)).some((x) => x.id === p.id),
    false,
  );
  // Newest first, id breaks ties, capped. A random two-day slot in the 1900s keeps other rows out of the window.
  const slot = new Date(Date.UTC(1900, 0, 2) + Math.floor(Math.random() * 18_000) * 2 * day);
  const newOnes: { id: string; at: number }[] = [];
  for (let i = 0; i < 12; i += 1) {
    const at = slot.getTime() - (i === 4 ? 3 : i) * 60_000; // n3 and n4 share a first_seen
    const row = await repo.createProject(
      { slug: `smoke-${suffix}-n${i}`, name: `New ${i}`, nameKey: `smokenew${suffix}${i}`, tokenSymbol: null, chains: [], officialDomains: [], status: "announced", conflict: false, lookalikeOf: null },
      new Date(at),
    );
    newOnes.push({ id: row.id, at });
  }
  await repo.createProject(
    { slug: `smoke-${suffix}-nfake`, name: "New 0", nameKey: `smokenew${suffix}0`, tokenSymbol: null, chains: [], officialDomains: [], status: "announced", conflict: false, lookalikeOf: newOnes[0]!.id },
    slot,
  );
  await repo.saveRiskAssessment(newOnes[1]!.id, assessment("high"), slot);
  const expected = [...newOnes].sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).slice(0, 10);
  const listed = await repo.listNewProjects(24, slot, 10);
  assert.deepEqual(listed.map((x) => x.id), expected.map((x) => x.id));
  assert.deepEqual(listed.map((x) => x.riskLevel), expected.map((x) => (x.id === newOnes[1]!.id ? "high" : null)));
  assert.deepEqual((await repo.listNewProjects(24, slot, 2)).map((x) => x.id), expected.slice(0, 2).map((x) => x.id));

  // notification_log (service-role only table).
  const refDate = "2026-10-10";
  const before = await repo.countDigestsSent(refDate);
  assert.equal(await repo.hasDigest(reader, refDate), false);
  const sentAt = new Date(T0.getTime() + 60_000);
  await repo.logDigest(reader, refDate, sentAt);
  assert.equal(await repo.hasDigest(reader, refDate), true);
  assert.equal(await repo.hasDigest(reader, "2026-10-11"), false);
  assert.equal(await repo.countDigestsSent(refDate), before + 1);
  await assert.rejects(repo.logDigest(reader, refDate, sentAt), DuplicateDigestError);
  await repo.logDigest(reader, "2026-10-09", new Date(T0.getTime() - 3600_000));
  assert.deepEqual((await ours())[0]?.lastDigestAt, sentAt);
  console.log("notifications ok");

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
    for (const table of ["documents", "extractions", "project_changes", "notification_log"]) {
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
    console.log("rls ok");
  } else {
    console.log("rls checks skipped (SUPABASE_ANON_KEY not set)");
  }

  // cleanup (fail loudly so a broken cleanup is not silent)
  for (const id of userIds) {
    const res = await admin.auth.admin.deleteUser(id);
    assert.equal(res.error, null, `deleteUser failed: ${res.error?.message ?? ""}`);
  }
  const leftover = await admin.from("notification_log").select("id").in("user_id", userIds);
  assert.deepEqual(leftover.data, [], "notification_log rows must go with the user");
  const cleanup = [
    await admin.from("projects").delete().in("id", [p.id, twin.id]),
    await admin.from("documents").delete().like("source_key", `%${suffix}%`),
    await admin.from("documents").delete().like("url", `https://t.me/${channel}/%`),
    await admin.from("pipeline_runs").delete().eq("id", runId),
  ];
  for (const r of cleanup) assert.equal(r.error, null, `cleanup failed: ${r.error?.message ?? ""}`);
  console.log("repo smoke ok");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
