import { describe, expect, it } from "vitest";
import type { RiskAssessment } from "@saf/core";
import type { CollectedDocument } from "../src/collectors/types.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { NewProject } from "../src/store/repo.js";

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
      { model: "m", httpStatus: 200, finishReason: "stop", latencyMs: 12, error: null, raw: "{}" },
      "v1",
    );
    expect(repo.extractions).toHaveLength(1);
    expect(repo.extractions[0]).toMatchObject({ documentId: d.id, promptVersion: "v1", model: "m" });
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
    await repo.replaceTasks(p.id, d1.id, ["Bridge", "Swap"]);
    await repo.replaceTasks(p.id, d2.id, ["Stake"]);
    await repo.replaceTasks(p.id, d1.id, ["Bridge only"]);
    await repo.upsertLinks(p.id, [{ url: "https://ink.test/", kind: "website", referralStripped: false }]);
    await repo.upsertLinks(p.id, [{ url: "https://ink.test/", kind: "claim", referralStripped: true }]);
    await repo.replaceDeadlines(p.id, d1.id, [
      { kind: "claim", date: "2026-11-01", precision: "exact", text: "Nov 1" },
    ]);
    await repo.replaceDeadlines(p.id, d1.id, []);
    expect(repo.deadlines).toHaveLength(0);
    const [scored] = await repo.listProjectsForScoring(30, T0);
    expect(scored?.tasks.sort()).toEqual(["Bridge only", "Stake"]);
    expect(scored?.links).toEqual([{ url: "https://ink.test/", kind: "claim" }]);
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
