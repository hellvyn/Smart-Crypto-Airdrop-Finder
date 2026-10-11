import { describe, expect, it } from "vitest";
import type { CurationRecord, NewSignal, RiskAssessment } from "@saf/core";
import type { CollectedDocument } from "../src/collectors/types.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { NewAiAnalysis, NewProject } from "../src/store/repo.js";

const T0 = new Date("2026-10-10T00:00:00Z");
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

function doc(overrides: Partial<CollectedDocument> = {}): CollectedDocument {
  return {
    sourceKind: "airdrops_io",
    sourceKey: "airdrops_io:latest",
    url: "https://airdrops.io/ink/",
    text: "Ink airdrop is live",
    publishedAt: null,
    pageUpdatedAt: null,
    fetchedAt: T0,
    ...overrides,
  };
}

function project(overrides: Partial<NewProject> = {}): NewProject {
  return {
    slug: "ink",
    name: "Ink",
    nameKey: "ink",
    tokenSymbol: "INK",
    chains: ["ethereum"],
    officialDomains: ["inkonchain.com"],
    status: "announced",
    conflict: false,
    lookalikeOf: null,
    ...overrides,
  };
}

function assessment(level: RiskAssessment["level"]): RiskAssessment {
  return { level, points: 0, reasons: [], checks: [] };
}

describe("MemoryRepo documents", () => {
  it("keeps status done when the same hash is upserted again", async () => {
    const repo = new MemoryRepo();
    const first = await repo.upsertDocument(doc(), "h1");
    expect(first.extractionStatus).toBe("pending");
    await repo.setExtractionStatus(first.id, "done");
    const again = await repo.upsertDocument(doc({ fetchedAt: new Date(T0.getTime() + 1000) }), "h1");
    expect(again.id).toBe(first.id);
    expect(again.extractionStatus).toBe("done");
  });

  it("resets status to pending when the hash changes", async () => {
    const repo = new MemoryRepo();
    const first = await repo.upsertDocument(doc(), "h1");
    await repo.setExtractionStatus(first.id, "done");
    const changed = await repo.upsertDocument(doc({ text: "Ink airdrop ended" }), "h2");
    expect(changed.id).toBe(first.id);
    expect(changed.extractionStatus).toBe("pending");
    expect(changed.text).toBe("Ink airdrop ended");
    expect(await repo.getDocumentHash(doc().url)).toBe("h2");
  });

  it("returns null hash for unknown urls and lists only pending documents up to the limit", async () => {
    const repo = new MemoryRepo();
    expect(await repo.getDocumentHash("https://x.test/")).toBeNull();
    const a = await repo.upsertDocument(doc({ url: "https://x.test/a" }), "a");
    await repo.upsertDocument(doc({ url: "https://x.test/b" }), "b");
    await repo.upsertDocument(doc({ url: "https://x.test/c" }), "c");
    await repo.setExtractionStatus(a.id, "not_airdrop");
    const pending = await repo.listPendingDocuments(1);
    expect(pending.map((d) => d.url)).toEqual(["https://x.test/b"]);
    expect(await repo.listPendingDocuments(10)).toHaveLength(2);
  });

  it("does not list pending documents whose text was purged", async () => {
    const repo = new MemoryRepo();
    await repo.upsertDocument(doc({ url: "https://x.test/empty", text: "", fetchedAt: daysBefore(T0, 100) }), "e");
    await repo.upsertDocument(doc({ url: "https://x.test/full" }), "f");
    expect((await repo.listPendingDocuments(1)).map((d) => d.url)).toEqual(["https://x.test/full"]);
    // A purge leaves a pending document pending, but it is no longer listed.
    await repo.upsertDocument(doc({ url: "https://x.test/old", fetchedAt: daysBefore(T0, 91) }), "o");
    await repo.purgeDocumentText(90, T0);
    expect((await repo.listPendingDocuments(10)).map((d) => d.url)).toEqual(["https://x.test/full"]);
  });

  it("does not list merge_failed documents until their hash changes", async () => {
    const repo = new MemoryRepo();
    const a = await repo.upsertDocument(doc(), "h1");
    await repo.setExtractionStatus(a.id, "merge_failed");
    expect(await repo.listPendingDocuments(10)).toEqual([]);
    expect((await repo.upsertDocument(doc(), "h1")).extractionStatus).toBe("merge_failed");
    expect((await repo.upsertDocument(doc({ text: "new" }), "h2")).extractionStatus).toBe("pending");
    expect(await repo.listPendingDocuments(10)).toHaveLength(1);
  });

  it("orders pending documents by fetched_at then url, and a re-upserted document moves back", async () => {
    const repo = new MemoryRepo();
    const at = (n: number) => new Date(T0.getTime() + n * 1000);
    await repo.upsertDocument(doc({ url: "https://x.test/a", fetchedAt: at(1) }), "a");
    await repo.upsertDocument(doc({ url: "https://x.test/c", fetchedAt: at(2) }), "c");
    await repo.upsertDocument(doc({ url: "https://x.test/b", fetchedAt: at(2) }), "b");
    expect((await repo.listPendingDocuments(10)).map((d) => d.url)).toEqual([
      "https://x.test/a",
      "https://x.test/b",
      "https://x.test/c",
    ]);
    // Equal fetched_at: url compares by byte order ("-" < "a"), as Postgres does for `url collate "C"`.
    await repo.upsertDocument(doc({ url: "https://x.test/a-z", fetchedAt: at(2) }), "az");
    await repo.upsertDocument(doc({ url: "https://x.test/aa", fetchedAt: at(2) }), "aa");
    expect((await repo.listPendingDocuments(10)).map((d) => d.url).slice(1, 5)).toEqual([
      "https://x.test/a-z",
      "https://x.test/aa",
      "https://x.test/b",
      "https://x.test/c",
    ]);
    await repo.setExtractionStatus((await repo.upsertDocument(doc({ url: "https://x.test/a-z", fetchedAt: at(2) }), "az")).id, "done");
    await repo.setExtractionStatus((await repo.upsertDocument(doc({ url: "https://x.test/aa", fetchedAt: at(2) }), "aa")).id, "done");
    // Re-fetching "a" with changed content (status stays pending) gives it a newer fetched_at.
    await repo.upsertDocument(doc({ url: "https://x.test/a", fetchedAt: at(3), text: "new" }), "a2");
    expect((await repo.listPendingDocuments(1)).map((d) => d.url)).toEqual(["https://x.test/b"]);
    expect((await repo.listPendingDocuments(10)).map((d) => d.url)).toEqual([
      "https://x.test/b",
      "https://x.test/c",
      "https://x.test/a",
    ]);
  });

  it("finds the highest telegram message id for a channel", async () => {
    const repo = new MemoryRepo();
    expect(await repo.lastTelegramMessageId("airdropchan")).toBeNull();
    const tg = (channel: string, id: number) =>
      doc({ sourceKind: "telegram", sourceKey: `telegram:${channel}`, url: `https://t.me/${channel}/${id}` });
    await repo.upsertDocument(tg("airdropchan", 9), "a");
    await repo.upsertDocument(tg("airdropchan", 120), "b");
    await repo.upsertDocument(tg("airdropchan", 15), "c");
    await repo.upsertDocument(tg("otherchan", 999), "d");
    await repo.upsertDocument(doc(), "e");
    expect(await repo.lastTelegramMessageId("airdropchan")).toBe(120);
    expect(await repo.lastTelegramMessageId("nochan")).toBeNull();
  });

  it("purges text older than the cutoff but keeps the hash", async () => {
    const repo = new MemoryRepo();
    await repo.upsertDocument(doc({ url: "https://x.test/old", fetchedAt: daysBefore(T0, 91) }), "old-hash");
    await repo.upsertDocument(doc({ url: "https://x.test/new", fetchedAt: daysBefore(T0, 89) }), "new-hash");
    expect(await repo.purgeDocumentText(90, T0)).toBe(1);
    const all = repo.allDocuments();
    const old = all.find((d) => d.url === "https://x.test/old");
    const fresh = all.find((d) => d.url === "https://x.test/new");
    expect(old?.text).toBe("");
    expect(old?.contentHash).toBe("old-hash");
    expect(fresh?.text).not.toBe("");
    expect(await repo.getDocumentHash("https://x.test/old")).toBe("old-hash");
    // Already-blank documents are not counted twice.
    expect(await repo.purgeDocumentText(90, T0)).toBe(0);
  });

  it("stores extraction attempts", async () => {
    const repo = new MemoryRepo();
    const d = await repo.upsertDocument(doc(), "h");
    await repo.saveExtraction(
      d.id,
      { model: "freellm:auto", servedModel: "gpt-oss:120b", httpStatus: 200, finishReason: "stop", latencyMs: 12, error: null, raw: "{}" },
      "v1",
    );
    expect(repo.extractions).toHaveLength(1);
    expect(repo.extractions[0]).toMatchObject({
      documentId: d.id,
      promptVersion: "v1",
      model: "freellm:auto",
      servedModel: "gpt-oss:120b",
    });
  });
});

describe("MemoryRepo projects", () => {
  it("creates projects and finds all projects sharing a name key", async () => {
    const repo = new MemoryRepo();
    const a = await repo.createProject(project(), T0);
    const b = await repo.createProject(project({ slug: "ink-2", lookalikeOf: a.id }), T0);
    expect(a.firstSeen).toEqual(T0);
    expect(a.lastSeen).toEqual(T0);
    const found = await repo.findProjectsByNameKey("ink");
    expect(found.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(await repo.findProjectsByNameKey("nothing")).toEqual([]);
  });

  it("checks slugs across all name keys", async () => {
    const repo = new MemoryRepo();
    await repo.createProject(project({ slug: "pump-2", name: "Pump 2", nameKey: "pump2" }), T0);
    expect(await repo.slugExists("pump-2")).toBe(true);
    expect(await repo.slugExists("pump")).toBe(false);
  });

  it("writes one project_changes row when status changes, none otherwise", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project({ status: "announced" }), T0);
    const t1 = new Date(T0.getTime() + 1000);
    await repo.updateProject(p.id, { status: "live" }, t1);
    expect(repo.projectChanges).toEqual([
      { projectId: p.id, field: "status", oldValue: "announced", newValue: "live", changedAt: t1 },
    ]);
    const t2 = new Date(T0.getTime() + 2000);
    await repo.updateProject(p.id, { status: "live", name: "Ink Chain" }, t2);
    expect(repo.projectChanges).toHaveLength(1);
    const [row] = await repo.findProjectsByNameKey("ink");
    expect(row?.name).toBe("Ink Chain");
    expect(row?.status).toBe("live");
    expect(row?.lastSeen).toEqual(t2);
    expect(row?.firstSeen).toEqual(T0);
  });

  it("tracks status evidence and deduplicates identical evidence", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d = await repo.upsertDocument(doc(), "h");
    const e = { projectId: p.id, documentId: d.id, field: "status", value: "live", quote: "is live", at: T0 };
    await repo.addEvidence(e);
    await repo.addEvidence(e);
    await repo.addEvidence({ ...e, field: "token_symbol", value: "INK" });
    expect(await repo.listStatusEvidence(p.id)).toEqual([{ status: "live", at: T0 }]);
  });

  it("copies the document url into the evidence source url", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    const d2 = await repo.upsertDocument(doc({ url: "https://x.test/2" }), "2");
    await repo.addEvidence({ projectId: p.id, documentId: d1.id, field: "status", value: "live", quote: "q", at: T0 });
    await repo.addEvidence({ projectId: p.id, documentId: d2.id, field: "status", value: "live", quote: "q", at: T0 });
    expect(repo["evidence"].map((e) => e.sourceUrl)).toEqual(["https://x.test/1", "https://x.test/2"]);
    await expect(
      repo.addEvidence({ projectId: p.id, documentId: "missing", field: "status", value: "live", quote: "q", at: T0 }),
    ).rejects.toThrow();
  });

  it("deletes the evidence of one field for one project and document", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const q = await repo.createProject(project({ slug: "other", nameKey: "other" }), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    const d2 = await repo.upsertDocument(doc({ url: "https://x.test/2" }), "2");
    const ev = (projectId: string, documentId: string, field: string, value: string) =>
      repo.addEvidence({ projectId, documentId, field, value, quote: "q", at: T0 });
    await ev(p.id, d1.id, "status", "live");
    await ev(p.id, d1.id, "status", "announced");
    await ev(p.id, d1.id, "dangerous_ask", "asks_secret");
    await ev(p.id, d2.id, "status", "ended");
    await ev(q.id, d1.id, "status", "live");
    await repo.deleteEvidence(p.id, d1.id, "status");
    expect(await repo.listStatusEvidence(p.id)).toEqual([{ status: "ended", at: T0 }]);
    expect(await repo.listStatusEvidence(q.id)).toEqual([{ status: "live", at: T0 }]);
    expect(repo["evidence"].filter((e) => e.field === "dangerous_ask")).toHaveLength(1);
  });

  it("orders name-key matches by first_seen then slug", async () => {
    const repo = new MemoryRepo();
    const later = await repo.createProject(project({ slug: "a-late" }), new Date(T0.getTime() + 1000));
    const z = await repo.createProject(project({ slug: "z-early" }), T0);
    const b = await repo.createProject(project({ slug: "b-early" }), T0);
    expect((await repo.findProjectsByNameKey("ink")).map((p) => p.id)).toEqual([b.id, z.id, later.id]);
  });

  it("lists status evidence by time, with insertion order breaking ties", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d = await repo.upsertDocument(doc(), "h");
    const ev = (value: string, at: Date) => ({ projectId: p.id, documentId: d.id, field: "status", value, quote: "q", at });
    const later = new Date(T0.getTime() + 5000);
    await repo.addEvidence(ev("ended", later));
    await repo.addEvidence(ev("announced", T0));
    await repo.addEvidence(ev("live", T0));
    expect(await repo.listStatusEvidence(p.id)).toEqual([
      { status: "announced", at: T0 },
      { status: "live", at: T0 },
      { status: "ended", at: later },
    ]);
  });

  it("replaces deadlines, tasks and upserts links per project", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    const d2 = await repo.upsertDocument(doc({ url: "https://x.test/2" }), "2");
    await repo.replaceTasks(p.id, d1.id, [
      { text: "Bridge", cadence: "once" },
      { text: "Swap", cadence: "daily" },
    ]);
    await repo.replaceTasks(p.id, d2.id, [{ text: "Stake", cadence: "weekly" }]);
    await repo.replaceTasks(p.id, d1.id, [{ text: "Bridge only", cadence: "once" }]);
    await repo.upsertLinks(p.id, [{ url: "https://ink.test/", kind: "website", referralStripped: false }]);
    await repo.upsertLinks(p.id, [{ url: "https://ink.test/", kind: "claim", referralStripped: true }]);
    await repo.replaceDeadlines(p.id, d1.id, [
      { kind: "claim", date: "2026-11-01", precision: "exact", text: "Nov 1" },
    ]);
    await repo.replaceDeadlines(p.id, d1.id, []);
    expect(repo.deadlines).toHaveLength(0);
    const [scored] = await repo.listProjectsForScoring(30, T0);
    expect(scored?.tasks.sort()).toEqual(["Bridge only", "Stake"]);
    expect(scored?.steps).toHaveLength(2);
    expect(scored?.steps).toEqual(
      expect.arrayContaining([
        { text: "Bridge only", cadence: "once" },
        { text: "Stake", cadence: "weekly" },
      ]),
    );
    expect(scored?.links).toEqual([{ url: "https://ink.test/", kind: "claim" }]);
  });

  it("lists a document's steps in position order with their cadence", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    await repo.replaceTasks(p.id, d1.id, [
      { text: "Check in", cadence: "daily" },
      { text: "Bridge", cadence: "once" },
      { text: "Vote", cadence: "weekly" },
    ]);
    const [scored] = await repo.listProjectsForScoring(30, T0);
    expect(scored?.steps).toEqual([
      { text: "Check in", cadence: "daily" },
      { text: "Bridge", cadence: "once" },
      { text: "Vote", cadence: "weekly" },
    ]);
    expect(scored?.tasks).toEqual(["Check in", "Bridge", "Vote"]);
  });

  it("stores Indonesian step texts on the project's tasks in step order when the counts match", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const other = await repo.createProject(project({ slug: "blast", name: "Blast", nameKey: "blast" }), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    const d2 = await repo.upsertDocument(doc({ url: "https://x.test/2" }), "2");
    // Step order is (document id, position), whatever the order the documents were stored in.
    const [first, second] = [d1, d2].sort((a, b) => (a.id < b.id ? -1 : 1));
    await repo.replaceTasks(p.id, second!.id, [{ text: "Stake", cadence: "weekly" }]);
    await repo.replaceTasks(p.id, first!.id, [
      { text: "Bridge", cadence: "once" },
      { text: "Swap", cadence: "daily" },
    ]);
    await repo.replaceTasks(other.id, first!.id, [{ text: "Deposit", cadence: "once" }]);
    expect(repo.stepTextIds(p.id)).toEqual([null, null, null]);

    await repo.saveStepTranslations(p.id, ["Bridge dulu", "Swap tiap hari", "Stake tiap minggu"]);

    expect(repo.stepTextIds(p.id)).toEqual(["Bridge dulu", "Swap tiap hari", "Stake tiap minggu"]);
    expect(repo.stepTextIds(other.id)).toEqual([null]);
  });

  it("leaves step texts alone when the number of translations differs from the project's tasks", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    await repo.replaceTasks(p.id, d1.id, [
      { text: "Bridge", cadence: "once" },
      { text: "Swap", cadence: "daily" },
    ]);
    await repo.saveStepTranslations(p.id, ["Bridge dulu", "Swap tiap hari"]);

    await repo.saveStepTranslations(p.id, ["Bridge dulu"]);
    await repo.saveStepTranslations(p.id, ["Bridge", "Swap", "Stake"]);

    expect(repo.stepTextIds(p.id)).toEqual(["Bridge dulu", "Swap tiap hari"]);
  });

  it("drops the step texts of a document whose steps are replaced", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    await repo.replaceTasks(p.id, d1.id, [{ text: "Bridge", cadence: "once" }]);
    await repo.saveStepTranslations(p.id, ["Bridge dulu"]);

    await repo.replaceTasks(p.id, d1.id, [{ text: "Bridge", cadence: "once" }]);

    expect(repo.stepTextIds(p.id)).toEqual([null]);
  });

  it("returns v3 fact evidence as facts in insertion order, without status or ask evidence", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    const add = (field: string, value: string, quote: string) =>
      repo.addEvidence({ projectId: p.id, documentId: d1.id, field, value, quote, at: T0 });
    await add("status", "live", "Ink airdrop is live");
    await add("claimed_backer", "Paradigm", "Backed by Paradigm.");
    await add("dangerous_ask", "asks_secret", "Enter your seed phrase.");
    await add("key_parameter:allocation", "5%", "5% of supply.");
    await add("source_rating:cost", "$0", "Cost to earn: $0");
    await add("latest_update", "", "New quests added.");
    await add("capital_required", "low", "");
    await add("capital_min_usd", "50", "");
    await add("defillama_listing", "speculative", "TVL");
    const [scored] = await repo.listProjectsForScoring(30, T0);
    expect(scored?.facts).toEqual([
      { field: "claimed_backer", value: "Paradigm", quote: "Backed by Paradigm." },
      { field: "key_parameter:allocation", value: "5%", quote: "5% of supply." },
      { field: "source_rating:cost", value: "$0", quote: "Cost to earn: $0" },
      { field: "latest_update", value: "", quote: "New quests added." },
      { field: "capital_required", value: "low", quote: "" },
      { field: "capital_min_usd", value: "50", quote: "" },
    ]);
  });

  it("scores only recently seen projects and counts distinct evidence source keys", async () => {
    const repo = new MemoryRepo();
    const fresh = await repo.createProject(project(), T0);
    await repo.createProject(project({ slug: "old", nameKey: "old", name: "Old" }), daysBefore(T0, 40));
    const a1 = await repo.upsertDocument(doc({ url: "https://x.test/a1", sourceKey: "airdrops_io:latest" }), "a1");
    const a2 = await repo.upsertDocument(doc({ url: "https://x.test/a2", sourceKey: "airdrops_io:latest" }), "a2");
    const t1 = await repo.upsertDocument(
      doc({ sourceKind: "telegram", sourceKey: "telegram:chan", url: "https://t.me/chan/1" }),
      "t1",
    );
    for (const d of [a1, a2, t1]) {
      await repo.addEvidence({ projectId: fresh.id, documentId: d.id, field: "status", value: "live", quote: "q", at: T0 });
    }
    const scored = await repo.listProjectsForScoring(30, T0);
    expect(scored.map((p) => p.slug)).toEqual(["ink"]);
    expect(scored[0]?.sourceCount).toBe(2);
  });
});

describe("MemoryRepo scoring extras", () => {
  it("resolves the lookalike project's name and domains", async () => {
    const repo = new MemoryRepo();
    const real = await repo.createProject(project({ name: "DeepBook", nameKey: "deepbook", slug: "deepbook", officialDomains: ["deepbook.tech"] }), T0);
    const fake = await repo.createProject(
      project({ name: "DeepBook", nameKey: "deepbook", slug: "deepbook-2", officialDomains: ["deepbook-claim.xyz"], lookalikeOf: real.id }),
      T0,
    );
    const scored = await repo.listProjectsForScoring(30, T0);
    const byId = new Map(scored.map((p) => [p.id, p]));
    expect(byId.get(fake.id)).toMatchObject({ lookalikeOf: real.id, lookalikeOfName: "DeepBook", lookalikeOfDomains: ["deepbook.tech"] });
    expect(byId.get(real.id)).toMatchObject({ lookalikeOf: null, lookalikeOfName: null, lookalikeOfDomains: [] });
  });

  it("returns dangerous_ask evidence as source asks in insertion order", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const d1 = await repo.upsertDocument(doc({ url: "https://x.test/1" }), "1");
    const d2 = await repo.upsertDocument(doc({ url: "https://x.test/2" }), "2");
    const ask = (documentId: string, value: string, quote: string) =>
      repo.addEvidence({ projectId: p.id, documentId, field: "dangerous_ask", value, quote, at: T0 });
    await ask(d2.id, "asks_payment", "Send 0.1 ETH to claim your tokens.");
    await ask(d1.id, "asks_secret", "Enter your seed phrase.");
    await repo.addEvidence({ projectId: p.id, documentId: d1.id, field: "status", value: "live", quote: "q", at: T0 });
    const [scored] = await repo.listProjectsForScoring(30, T0);
    expect(scored?.sourceAsks).toEqual([
      { code: "asks_payment", quote: "Send 0.1 ETH to claim your tokens." },
      { code: "asks_secret", quote: "Enter your seed phrase." },
    ]);
  });
});

describe("MemoryRepo source kinds", () => {
  it("lists the distinct source kinds of the project's evidence documents, sorted", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const other = await repo.createProject(project({ slug: "other", nameKey: "other", name: "Other" }), T0);
    const tg = await repo.upsertDocument(
      doc({ sourceKind: "telegram", sourceKey: "telegram:chan", url: "https://t.me/chan/1" }),
      "t1",
    );
    const a1 = await repo.upsertDocument(doc({ url: "https://airdrops.io/a1/" }), "a1");
    const a2 = await repo.upsertDocument(doc({ url: "https://airdrops.io/a2/" }), "a2");
    const alpha = await repo.upsertDocument(
      doc({ sourceKind: "alphadrops", sourceKey: "alphadrops", url: "https://alphadrops.net/airdrops/x" }),
      "x",
    );
    for (const d of [tg, a1, a2]) {
      await repo.addEvidence({ projectId: p.id, documentId: d.id, field: "status", value: "live", quote: "q", at: T0 });
    }
    // Another project's document is not this project's source.
    await repo.addEvidence({ projectId: other.id, documentId: alpha.id, field: "status", value: "live", quote: "q", at: T0 });
    const byId = new Map((await repo.listProjectsForScoring(30, T0)).map((s) => [s.id, s]));
    expect(byId.get(p.id)?.sourceKinds).toEqual(["airdrops_io", "telegram"]);
    expect(byId.get(other.id)?.sourceKinds).toEqual(["alphadrops"]);
  });

  it("is empty for a project without evidence", async () => {
    const repo = new MemoryRepo();
    await repo.createProject(project(), T0);
    const [scored] = await repo.listProjectsForScoring(30, T0);
    expect(scored?.sourceKinds).toEqual([]);
  });
});

describe("MemoryRepo project source texts", () => {
  it("lists each unpurged document that gave the project evidence once, by url", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const other = await repo.createProject(project({ slug: "ink-2" }), T0);
    const b = await repo.upsertDocument(doc({ url: "https://x.test/b", text: "Text B" }), "b");
    const a = await repo.upsertDocument(doc({ url: "https://x.test/a", text: "Text A" }), "a");
    const old = await repo.upsertDocument(doc({ url: "https://x.test/old", text: "Old", fetchedAt: daysBefore(T0, 100) }), "o");
    const elsewhere = await repo.upsertDocument(doc({ url: "https://x.test/elsewhere", text: "Other" }), "e");
    const evidence = (projectId: string, documentId: string, field: string) =>
      repo.addEvidence({ projectId, documentId, field, value: "v", quote: "q", at: T0 });
    await evidence(p.id, b.id, "status");
    await evidence(p.id, b.id, "claimed_backer");
    await evidence(p.id, a.id, "status");
    await evidence(p.id, old.id, "status");
    await evidence(other.id, elsewhere.id, "status");
    await repo.purgeDocumentText(90, T0);

    expect(await repo.listProjectSourceTexts(p.id)).toEqual([
      { url: "https://x.test/a", text: "Text A" },
      { url: "https://x.test/b", text: "Text B" },
    ]);
  });
});

describe("MemoryRepo risk and runs", () => {
  it("writes project_changes for the first assessment and for level changes only", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    expect(await repo.latestRiskLevel(p.id)).toBeNull();
    const t = (n: number) => new Date(T0.getTime() + n * 1000);
    await repo.saveRiskAssessment(p.id, assessment("low"), t(1));
    await repo.saveRiskAssessment(p.id, assessment("low"), t(2));
    await repo.saveRiskAssessment(p.id, assessment("high"), t(3));
    expect(await repo.latestRiskLevel(p.id)).toBe("high");
    expect(repo.projectChanges).toEqual([
      { projectId: p.id, field: "risk_level", oldValue: null, newValue: "low", changedAt: t(1) },
      { projectId: p.id, field: "risk_level", oldValue: "low", newValue: "high", changedAt: t(3) },
    ]);
    expect(repo.riskAssessments).toHaveLength(3);
  });

  it("uses the assessment with the greatest computed_at as latest", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveRiskAssessment(p.id, assessment("medium"), new Date(T0.getTime() + 5000));
    await repo.saveRiskAssessment(p.id, assessment("low"), new Date(T0.getTime() + 1000));
    expect(await repo.latestRiskLevel(p.id)).toBe("medium");
  });

  it("breaks equal computed_at ties by insertion order (latest insert wins)", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveRiskAssessment(p.id, assessment("high"), T0);
    await repo.saveRiskAssessment(p.id, assessment("medium"), T0);
    expect(await repo.latestRiskLevel(p.id)).toBe("medium");
  });

  it("records run start, finish and numeric stats", async () => {
    const repo = new MemoryRepo();
    const id = await repo.startRun(T0);
    const end = new Date(T0.getTime() + 60_000);
    await repo.finishRun(id, { documents: 12, sourceFailed: 1 }, end);
    expect(repo.runs).toEqual([{ id, startedAt: T0, finishedAt: end, stats: { documents: 12, sourceFailed: 1 } }]);
  });
});

function curation(overrides: Partial<CurationRecord> = {}): CurationRecord {
  return {
    passed: true,
    worthLevel: "medium",
    tab: "live_now",
    statusAt: "live",
    endedOn: null,
    reasons: [{ code: "official_domain", message: "Domain resmi tercatat", kind: "pass" }],
    coverage: { defillama: true },
    ...overrides,
  };
}

const failed = (overrides: Partial<CurationRecord> = {}): CurationRecord =>
  curation({ passed: false, worthLevel: null, tab: null, reasons: [], ...overrides });

describe("MemoryRepo curations", () => {
  const t = (n: number) => new Date(T0.getTime() + n * 1000);

  it("writes a curated change for the first passing curation and for passed flips only", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveCuration(p.id, curation(), t(1));
    await repo.saveCuration(p.id, curation(), t(2));
    await repo.saveCuration(p.id, failed(), t(3));
    await repo.saveCuration(p.id, failed(), t(4));
    expect(repo.projectChanges).toEqual([
      { projectId: p.id, field: "curated", oldValue: null, newValue: "true", changedAt: t(1) },
      { projectId: p.id, field: "curated", oldValue: "true", newValue: "false", changedAt: t(3) },
    ]);
    expect(repo.curations).toHaveLength(4);
  });

  it("writes no curated change when the first curation fails", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveCuration(p.id, failed(), t(1));
    expect(repo.projectChanges).toEqual([]);
    await repo.saveCuration(p.id, curation(), t(2));
    expect(repo.projectChanges).toEqual([
      { projectId: p.id, field: "curated", oldValue: "false", newValue: "true", changedAt: t(2) },
    ]);
  });

  it("stores the first fail message as the public fail reason, and null for a passing curation", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveCuration(
      p.id,
      failed({
        reasons: [
          { code: "official_domain", message: "Domain resmi tercatat", kind: "pass" },
          { code: "insufficient_checks", message: "Cek kunci belum lengkap", kind: "fail" },
          { code: "risk_high", message: "Risiko tinggi", kind: "fail" },
        ],
      }),
      t(1),
    );
    await repo.saveCuration(
      p.id,
      curation({ reasons: [{ code: "tvl_high", message: "TVL di atas $100 juta", kind: "worth" }] }),
      t(2),
    );
    expect(repo.curations.map((c) => c.publicFailReason)).toEqual(["Cek kunci belum lengkap", null]);
    expect(repo.curations[1]).toEqual({
      projectId: p.id,
      passed: true,
      worthLevel: "medium",
      tab: "live_now",
      statusAt: "live",
      endedOn: null,
      reasons: [{ code: "tvl_high", message: "TVL di atas $100 juta", kind: "worth" }],
      coverage: { defillama: true },
      publicFailReason: null,
      computedAt: t(2),
    });
  });

  it("never shows a public fail reason for a passing curation", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveCuration(
      p.id,
      curation({ reasons: [{ code: "tvl_low", message: "TVL kecil", kind: "fail" }] }),
      t(1),
    );
    expect(repo.curations.map((c) => c.publicFailReason)).toEqual([null]);
  });

  it("returns the latest curation by computed_at, with insertion order breaking ties", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    expect(await repo.latestCuration(p.id)).toBeNull();
    await repo.saveCuration(p.id, curation({ statusAt: "ended", tab: "ended", endedOn: "2026-10-05" }), t(5));
    await repo.saveCuration(p.id, failed(), t(1));
    expect(await repo.latestCuration(p.id)).toEqual({ passed: true, endedOn: "2026-10-05" });
    await repo.saveCuration(p.id, failed(), t(5));
    expect(await repo.latestCuration(p.id)).toEqual({ passed: false, endedOn: null });
  });

  it("passedBeforeEnd is true when the latest curation before the project ended passed", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveCuration(p.id, curation({ statusAt: "live" }), t(1));
    await repo.saveCuration(p.id, curation({ statusAt: "ended", tab: "ended", endedOn: "2026-10-05" }), t(2));
    expect(await repo.passedBeforeEnd(p.id)).toBe(true);
  });

  it("passedBeforeEnd is false with only ended curations, or none", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    expect(await repo.passedBeforeEnd(p.id)).toBe(false);
    await repo.saveCuration(p.id, curation({ statusAt: "ended", tab: "ended", endedOn: "2026-10-05" }), t(1));
    expect(await repo.passedBeforeEnd(p.id)).toBe(false);
  });

  it("passedBeforeEnd follows the latest curation before the end, not any earlier pass", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    await repo.saveCuration(p.id, curation({ statusAt: "live" }), t(1));
    await repo.saveCuration(p.id, failed({ statusAt: "live" }), t(2));
    await repo.saveCuration(p.id, failed({ statusAt: "ended", endedOn: "2026-10-05" }), t(3));
    expect(await repo.passedBeforeEnd(p.id)).toBe(false);
  });
});

describe("MemoryRepo signals", () => {
  const tvl: NewSignal = { kind: "tvl", value: { tvl_usd: 25_000_000 }, source: "defillama", verified: true };
  const paradigm: NewSignal = {
    kind: "vc_backer",
    value: { investor: "Paradigm", tier: 1 },
    source: "vc_portfolio",
    verified: true,
  };

  it("replaces every signal of the project and leaves other projects alone", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const other = await repo.createProject(project({ slug: "blast", name: "Blast", nameKey: "blast" }), T0);
    await repo.replaceSignals(p.id, [tvl, paradigm], T0);
    await repo.replaceSignals(other.id, [tvl], T0);
    const later = new Date(T0.getTime() + 86_400_000);
    const curated: NewSignal = {
      kind: "curated_source",
      value: { source_kind: "airdrops_io" },
      source: "airdrops_io",
      verified: true,
    };
    await repo.replaceSignals(p.id, [curated], later);
    expect(repo.signals).toEqual([
      { projectId: other.id, ...tvl, observedAt: T0 },
      { projectId: p.id, ...curated, observedAt: later },
    ]);
    await repo.replaceSignals(p.id, [], later);
    expect(repo.signals.map((s) => s.projectId)).toEqual([other.id]);
  });

  it("keeps the project's signals from the kept sources, with their own observation time", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const curated: NewSignal = { kind: "curated_source", value: {}, source: "airdrops_io", verified: false };
    await repo.replaceSignals(p.id, [tvl, paradigm, curated], T0);
    const later = new Date(T0.getTime() + 86_400_000);
    const telegram: NewSignal = { kind: "curated_source", value: {}, source: "telegram", verified: false };

    await repo.replaceSignals(p.id, [telegram], later, ["defillama"]);

    expect(repo.signals).toEqual([
      { projectId: p.id, ...tvl, observedAt: T0 },
      { projectId: p.id, ...telegram, observedAt: later },
    ]);
    // A new signal that repeats a kept one breaks the unique index.
    await expect(repo.replaceSignals(p.id, [tvl], later, ["defillama"])).rejects.toThrow("duplicate signal");
  });

  it("keeps only the kept investors' signals of a source kept by investor", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const variant: NewSignal = { ...paradigm, value: { investor: "Variant", tier: 2 } };
    const claim: NewSignal = { kind: "claimed_backer", value: { investor: "Variant", quote: "q" }, source: "llm_text", verified: false };
    const noInvestor: NewSignal = { ...paradigm, value: { tier: 1 } };
    await repo.replaceSignals(p.id, [tvl, paradigm, variant, claim, noInvestor], T0);
    const later = new Date(T0.getTime() + 86_400_000);

    await repo.replaceSignals(p.id, [], later, [{ source: "vc_portfolio", investor: "Variant" }]);

    // The kept investor counts for its source only: Variant's claimed backer (llm_text) is replaced like the rest,
    // and so is a signal of the source without an investor.
    expect(repo.signals).toEqual([{ projectId: p.id, ...variant, observedAt: T0 }]);
  });

  it("keeps only the kept kind's signals of a source kept by kind", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const reported: NewSignal = { kind: "reported_backer", value: { investor: "Paradigm" }, source: "alphadrops", verified: false };
    const curated: NewSignal = { kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: false };
    const claim: NewSignal = { kind: "claimed_backer", value: { investor: "Paradigm", quote: "q" }, source: "llm_text", verified: false };
    await repo.replaceSignals(p.id, [reported, curated, claim], T0);
    const later = new Date(T0.getTime() + 86_400_000);

    await repo.replaceSignals(p.id, [curated], later, [{ source: "alphadrops", kind: "reported_backer" }]);

    expect(repo.signals).toEqual([
      { projectId: p.id, ...reported, observedAt: T0 },
      { projectId: p.id, ...curated, observedAt: later },
    ]);
  });

  it("accepts one kind from two sources but rejects a duplicate (kind, source, investor), like the unique index", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const fromAirdrops: NewSignal = { kind: "curated_source", value: {}, source: "airdrops_io", verified: true };
    const fromAlphadrops: NewSignal = { kind: "curated_source", value: {}, source: "alphadrops", verified: true };
    await repo.replaceSignals(p.id, [fromAirdrops, fromAlphadrops], T0);
    expect(repo.signals).toHaveLength(2);
    await expect(
      repo.replaceSignals(p.id, [paradigm, { ...paradigm, value: { investor: "Paradigm", tier: 2 } }], T0),
    ).rejects.toThrow("duplicate signal");
    // Like SupabaseRepo (delete, then a refused insert), a refused replace leaves the project without signals.
    expect(repo.signals).toEqual([]);
  });

  it("rejects a verified claimed or reported backer, like the check constraint", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    for (const kind of ["claimed_backer", "reported_backer"] as const) {
      await expect(
        repo.replaceSignals(p.id, [{ kind, value: { investor: "a16z" }, source: "llm_text", verified: true }], T0),
      ).rejects.toThrow("verified backer claim");
    }
  });
});

describe("MemoryRepo VC portfolios and AI analyses", () => {
  it("replaces a VC's cached domains and reports when they were fetched", async () => {
    const repo = new MemoryRepo();
    expect(await repo.listVcPortfolio("paradigm")).toEqual({ domains: [], fetchedAt: null });
    await repo.saveVcPortfolio("paradigm", ["inkonchain.com", "blast.io"], T0);
    await repo.saveVcPortfolio("a16z", ["eigenlayer.xyz"], T0);
    const later = new Date(T0.getTime() + 7 * 86_400_000);
    await repo.saveVcPortfolio("paradigm", ["zora.co", "blast.io"], later);
    expect(await repo.listVcPortfolio("paradigm")).toEqual({ domains: ["blast.io", "zora.co"], fetchedAt: later });
    expect(await repo.listVcPortfolio("a16z")).toEqual({ domains: ["eigenlayer.xyz"], fetchedAt: T0 });
  });

  it("caches one AlphaDrops raise page per slug, a later save replacing it", async () => {
    const repo = new MemoryRepo();
    const seed = { round: "Seed", date: "2026-01-02", amountUsd: 5_000_000, lead: ["Paradigm"], others: ["Variant"], sourceUrl: null };
    expect(await repo.listAlphaRaise("catalyst")).toBeNull();
    await repo.saveAlphaRaise("catalyst", { officialDomain: "catalyst.app", rounds: [seed] }, T0);
    await repo.saveAlphaRaise("meanwhile", { officialDomain: null, rounds: [] }, T0);
    const later = new Date(T0.getTime() + 8 * 86_400_000);
    await repo.saveAlphaRaise("catalyst", { officialDomain: "catalyst.xyz", rounds: [seed, { ...seed, round: "Series A" }] }, later);

    expect(await repo.listAlphaRaise("catalyst")).toEqual({
      officialDomain: "catalyst.xyz",
      rounds: [seed, { ...seed, round: "Series A" }],
      fetchedAt: later,
    });
    expect(await repo.listAlphaRaise("meanwhile")).toEqual({ officialDomain: null, rounds: [], fetchedAt: T0 });
  });

  it("stores a domain listed twice on a portfolio page once (vc_id, domain is the primary key)", async () => {
    const repo = new MemoryRepo();
    await repo.saveVcPortfolio("paradigm", ["blast.io", "zora.co", "blast.io"], T0);
    expect((await repo.listVcPortfolio("paradigm")).domains).toEqual(["blast.io", "zora.co"]);
  });

  it("returns the latest analysis of one kind for one project", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(project(), T0);
    const analysis = (overrides: Partial<NewAiAnalysis>): NewAiAnalysis => ({
      projectId: p.id,
      kind: "analyst",
      inputHash: "h1",
      result: { verdict: "pantau" },
      model: "router:auto",
      servedModel: null,
      promptVersion: "analyst-1",
      createdAt: T0,
      ...overrides,
    });
    const at = (ms: number) => new Date(T0.getTime() + ms);
    expect(await repo.latestAiAnalysis(p.id, "analyst")).toBeNull();
    await repo.saveAiAnalysis(analysis({ inputHash: "h2", createdAt: at(2000) }));
    await repo.saveAiAnalysis(analysis({ inputHash: "h1", createdAt: at(1000) }));
    await repo.saveAiAnalysis(analysis({ kind: "scam", inputHash: "s1", createdAt: at(3000) }));
    expect(await repo.latestAiAnalysis(p.id, "analyst")).toEqual(analysis({ inputHash: "h2", createdAt: at(2000) }));
    expect((await repo.latestAiAnalysis(p.id, "scam"))?.inputHash).toBe("s1");
    expect(await repo.latestAiAnalysis(p.id, "contradictions")).toBeNull();
    // Equal created_at: the later insert wins.
    await repo.saveAiAnalysis(analysis({ inputHash: "h3", servedModel: "gpt-oss:120b", createdAt: at(2000) }));
    expect(await repo.latestAiAnalysis(p.id, "analyst")).toMatchObject({ inputHash: "h3", servedModel: "gpt-oss:120b" });
  });
});

describe("MemoryRepo link checks and claim pages", () => {
  it("keeps one link check per URL, a later save replacing it, and lists only the asked URLs", async () => {
    const repo = new MemoryRepo();
    const later = new Date(T0.getTime() + 86_400_000);
    await repo.saveLinkCheck("https://claim.ink.xyz/", "unchecked", T0);
    await repo.saveLinkCheck("https://ink-claim.io/", "different_domain", T0);
    await repo.saveLinkCheck("https://claim.ink.xyz/", "official", later);

    expect(await repo.listLinkChecks(["https://ink-claim.io/", "https://claim.ink.xyz/", "https://never.io/"])).toEqual([
      { url: "https://claim.ink.xyz/", status: "official", checkedAt: later },
      { url: "https://ink-claim.io/", status: "different_domain", checkedAt: T0 },
    ]);
    expect(await repo.listLinkChecks(["https://ink-claim.io/"])).toEqual([
      { url: "https://ink-claim.io/", status: "different_domain", checkedAt: T0 },
    ]);
    expect(await repo.listLinkChecks([])).toEqual([]);
  });

  it("caches one claim page text per URL, a later save replacing it", async () => {
    const repo = new MemoryRepo();
    const later = new Date(T0.getTime() + 8 * 86_400_000);
    await repo.saveClaimPage("https://claim.ink.xyz/", "Claim your INK", T0);
    await repo.saveClaimPage("https://app.ink.xyz/", "", T0);
    await repo.saveClaimPage("https://claim.ink.xyz/", "Claim closed", later);

    expect(await repo.listClaimPages(["https://claim.ink.xyz/", "https://app.ink.xyz/", "https://never.io/"])).toEqual([
      { url: "https://app.ink.xyz/", text: "", fetchedAt: T0 },
      { url: "https://claim.ink.xyz/", text: "Claim closed", fetchedAt: later },
    ]);
    expect(await repo.listClaimPages([])).toEqual([]);
  });
});
