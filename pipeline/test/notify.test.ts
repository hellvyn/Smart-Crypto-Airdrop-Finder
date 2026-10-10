import { describe, expect, it } from "vitest";
import type { RiskAssessment } from "@saf/core";
import type { PipelineConfig } from "../src/config.js";
import type { EmailMessage, EmailSender } from "../src/notify/email-sender.js";
import { notifyStep } from "../src/steps/notify.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import { DuplicateDigestError } from "../src/store/repo.js";
import type { NewProject, ProjectRow } from "../src/store/repo.js";

const NOW = new Date("2026-10-10T23:30:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const OLD = new Date(NOW.getTime() - 30 * DAY);
const SITE = "https://saf.test";

const EMAIL: PipelineConfig["email"] = { enabled: true, dailyLimit: 300, reserveRatio: 0.2, siteUrl: SITE };

function np(slug: string, overrides: Partial<NewProject> = {}): NewProject {
  return {
    slug,
    name: slug.toUpperCase(),
    nameKey: slug,
    tokenSymbol: null,
    chains: [],
    officialDomains: [],
    status: "announced",
    conflict: false,
    lookalikeOf: null,
    ...overrides,
  };
}

const assessment = (level: RiskAssessment["level"]): RiskAssessment => ({ level, points: 0, reasons: [], checks: [] });

interface FakeSender extends EmailSender {
  sent: EmailMessage[];
  maxInFlight: number;
}

/** Records every message; `fail` decides per recipient whether the send fails (`"throw"` throws). */
function fakeSender(fail: (to: string) => false | "status" | "throw" = () => false): FakeSender {
  let inFlight = 0;
  const sender: FakeSender = {
    sent: [],
    maxInFlight: 0,
    async send(m) {
      inFlight++;
      sender.maxInFlight = Math.max(sender.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      const mode = fail(m.to);
      if (mode === "throw") throw new Error(`smtp refused ${m.to}`);
      if (mode === "status") return { ok: false, status: 400 };
      sender.sent.push(m);
      return { ok: true, status: 201 };
    },
  };
  return sender;
}

/** A project seen a month ago (so its changes count as changes, not as "new"). */
async function oldProject(repo: MemoryRepo, slug: string): Promise<ProjectRow> {
  return repo.createProject(np(slug), OLD);
}

/** Watches a project with a claim deadline tomorrow (UTC). */
async function withDeadline(repo: MemoryRepo, userId: string, slug: string, date = "2026-10-11"): Promise<ProjectRow> {
  const p = await oldProject(repo, slug);
  await repo.replaceDeadlines(p.id, "doc-1", [{ kind: "claim", date, precision: "exact", text: "Claim ends" }]);
  repo.seedTestWatch(userId, p.id);
  return p;
}

/** Watches a project whose status changed an hour ago. */
async function withStatusChange(repo: MemoryRepo, userId: string, slug: string): Promise<ProjectRow> {
  const p = await oldProject(repo, slug);
  await repo.updateProject(p.id, { status: "live" }, new Date(NOW.getTime() - HOUR));
  repo.seedTestWatch(userId, p.id);
  return p;
}

/** Watches a project whose risk level changed an hour ago. */
async function withRiskChange(repo: MemoryRepo, userId: string, slug: string): Promise<ProjectRow> {
  const p = await oldProject(repo, slug);
  await repo.saveRiskAssessment(p.id, assessment("low"), OLD);
  await repo.saveRiskAssessment(p.id, assessment("high"), new Date(NOW.getTime() - HOUR));
  repo.seedTestWatch(userId, p.id);
  return p;
}

function deps(repo: MemoryRepo, sender: EmailSender, now: Date = NOW) {
  return { repo, sender, runStart: now, now: () => now };
}

/** Three recipients: alice (deadline), bob (status change), carol (watches a quiet project). */
async function threeUsers(repo: MemoryRepo) {
  const alice = repo.seedTestUser({ email: "alice@example.test" });
  const bob = repo.seedTestUser({ email: "bob@example.test" });
  const carol = repo.seedTestUser({ email: "carol@example.test" });
  await withDeadline(repo, alice, "alpha");
  await withStatusChange(repo, bob, "beta");
  repo.seedTestWatch(carol, (await oldProject(repo, "quiet")).id);
  return { alice, bob, carol };
}

describe("notifyStep", () => {
  it("sends one digest per user with content and counts the empty ones", async () => {
    const repo = new MemoryRepo();
    const { alice, bob } = await threeUsers(repo);
    const sender = fakeSender();
    const stats = await notifyStep(deps(repo, sender), EMAIL);

    expect(stats).toEqual({
      digests_sent: 2,
      digests_empty: 1,
      digests_skipped_quota: 0,
      digests_failed: 0,
      digests_already_sent: 0,
      digests_duplicate: 0,
    });
    expect(sender.sent.map((m) => m.to).sort()).toEqual(["alice@example.test", "bob@example.test"]);
    expect(repo.notificationLog.map((l) => [l.userId, l.kind, l.refDate]).sort()).toEqual(
      [
        [alice, "digest", "2026-10-10"],
        [bob, "digest", "2026-10-10"],
      ].sort(),
    );
  });

  it("renders the digest with the site links and the user's unsubscribe link", async () => {
    const repo = new MemoryRepo();
    const alice = repo.seedTestUser({ email: "alice@example.test", unsubscribeToken: "tok-alice" });
    await withDeadline(repo, alice, "alpha");
    const sender = fakeSender();
    await notifyStep(deps(repo, sender), EMAIL);

    const m = sender.sent[0] as EmailMessage;
    expect(m.subject).toBe("Airdrop digest: 1 deadline in the next 48h");
    expect(m.text).toContain("ALPHA: Claim, 2026-10-11");
    expect(m.text).toContain(`${SITE}/projects/alpha`);
    expect(m.text).toContain(`${SITE}/unsubscribe?token=tok-alice`);
    expect(m.html).toContain(`${SITE}/unsubscribe?token=tok-alice`);
    expect(m.listUnsubscribe).toBe(`${SITE}/unsubscribe?token=tok-alice`);
  });

  it("dates and windows everything by the run start, not by the clock at send time", async () => {
    const repo = new MemoryRepo();
    const alice = repo.seedTestUser({ email: "alice@example.test", newAirdropsOptIn: true });
    // A deadline "today" at run start (2026-10-10) is yesterday by the time the clock passes midnight.
    await withDeadline(repo, alice, "alpha", "2026-10-10");
    await repo.createProject(np("fresh", { name: "Fresh" }), new Date(NOW.getTime() - 23 * HOUR));
    const sentAt = new Date("2026-10-11T00:15:00Z");
    const sender = fakeSender();
    const stats = await notifyStep({ repo, sender, runStart: NOW, now: () => sentAt }, EMAIL);

    expect(stats.digests_sent).toBe(1);
    expect(sender.sent[0]?.text).toContain("ALPHA: Claim, today (2026-10-10 UTC)");
    expect(sender.sent[0]?.text).toContain("Fresh (Announced");
    expect(repo.notificationLog).toEqual([{ userId: alice, kind: "digest", refDate: "2026-10-10", sentAt }]);
  });

  it("does not send twice on a second run the same day", async () => {
    const repo = new MemoryRepo();
    await threeUsers(repo);
    const sender = fakeSender();
    await notifyStep(deps(repo, sender), EMAIL);
    const second = await notifyStep(deps(repo, sender, new Date(NOW.getTime() + 10 * 60_000)), EMAIL);

    expect(sender.sent).toHaveLength(2);
    expect(second.digests_already_sent).toBe(2);
    expect(second.digests_sent).toBe(0);
    expect(second.digests_empty).toBe(1);
    expect(repo.notificationLog).toHaveLength(2);
  });

  it("counts a failed send, does not log it and keeps going; the user can get it on a later run", async () => {
    const repo = new MemoryRepo();
    const alice = repo.seedTestUser({ email: "alice@example.test" });
    const bob = repo.seedTestUser({ email: "bob@example.test" });
    await withDeadline(repo, alice, "alpha");
    await withDeadline(repo, bob, "beta", "2026-10-12");
    const failing = fakeSender((to) => (to === "bob@example.test" ? "status" : false));
    const stats = await notifyStep(deps(repo, failing), EMAIL);

    expect(stats.digests_failed).toBe(1);
    expect(stats.digests_sent).toBe(1);
    expect(failing.sent.map((m) => m.to)).toEqual(["alice@example.test"]);
    expect(await repo.hasDigest(bob, "2026-10-10")).toBe(false);
    expect(repo.notificationLog.map((l) => l.userId)).toEqual([alice]);

    // Tomorrow bob is still a recipient and gets the (still upcoming) deadline.
    const tomorrow = new Date(NOW.getTime() + DAY);
    const ok = fakeSender();
    const next = await notifyStep(deps(repo, ok, tomorrow), EMAIL);
    expect(ok.sent.map((m) => m.to)).toContain("bob@example.test");
    expect(next.digests_failed).toBe(0);
    expect(await repo.hasDigest(bob, "2026-10-11")).toBe(true);
  });

  it("counts a sender that throws as failed and never rethrows", async () => {
    const repo = new MemoryRepo();
    await threeUsers(repo);
    const stats = await notifyStep(deps(repo, fakeSender(() => "throw")), EMAIL);
    expect(stats.digests_failed).toBe(2);
    expect(stats.digests_sent).toBe(0);
    expect(repo.notificationLog).toHaveLength(0);
  });

  it("skips the lowest-priority digests when the quota runs out", async () => {
    const repo = new MemoryRepo();
    const a = repo.seedTestUser({ email: "a@example.test" });
    const b = repo.seedTestUser({ email: "b@example.test" });
    const c = repo.seedTestUser({ email: "c@example.test" });
    await withStatusChange(repo, a, "status-only"); // priority 2
    await withRiskChange(repo, b, "risky"); // priority 1
    await withDeadline(repo, c, "deadline"); // priority 0
    const sender = fakeSender();
    const stats = await notifyStep(deps(repo, sender), { ...EMAIL, dailyLimit: 2, reserveRatio: 0 });

    expect(stats.digests_skipped_quota).toBe(1);
    expect(stats.digests_sent).toBe(2);
    expect(sender.sent.map((m) => m.to).sort()).toEqual(["b@example.test", "c@example.test"]);
    expect(await repo.hasDigest(a, "2026-10-10")).toBe(false);
  });

  it("subtracts digests already sent today from the budget", async () => {
    const repo = new MemoryRepo();
    // Someone who already got today's digest and has since turned it off still uses up quota.
    const gone = repo.seedTestUser({ email: "gone@example.test", digestEnabled: false });
    await repo.logDigest(gone, "2026-10-10", new Date(NOW.getTime() - HOUR));
    const { alice, bob } = await threeUsers(repo);
    const sender = fakeSender();
    const stats = await notifyStep(deps(repo, sender), { ...EMAIL, dailyLimit: 2, reserveRatio: 0 });

    expect(stats.digests_sent).toBe(1);
    expect(stats.digests_skipped_quota).toBe(1);
    // The deadline digest (priority 0) wins over the status change.
    expect(sender.sent.map((m) => m.to)).toEqual(["alice@example.test"]);
    expect(await repo.hasDigest(bob, "2026-10-10")).toBe(false);
    expect(await repo.hasDigest(alice, "2026-10-10")).toBe(true);
  });

  it("sends at most 5 emails at a time", async () => {
    const repo = new MemoryRepo();
    for (let i = 0; i < 12; i++) {
      const u = repo.seedTestUser({ email: `u${i}@example.test` });
      await withDeadline(repo, u, `p${i}`);
    }
    const sender = fakeSender();
    const stats = await notifyStep(deps(repo, sender), EMAIL);
    expect(stats.digests_sent).toBe(12);
    expect(sender.maxInFlight).toBeLessThanOrEqual(5);
    expect(sender.maxInFlight).toBeGreaterThan(1);
  });

  it("counts a unique violation on the log after a successful send (a concurrent run logged it) as duplicate", async () => {
    const repo = new MemoryRepo();
    const alice = repo.seedTestUser({ email: "alice@example.test" });
    await withDeadline(repo, alice, "alpha");
    repo.logDigest = async () => {
      throw new DuplicateDigestError();
    };
    const stats = await notifyStep(deps(repo, fakeSender()), EMAIL);
    expect(stats.digests_failed).toBe(0);
    expect(stats.digests_sent).toBe(0);
    expect(stats.digests_already_sent).toBe(0);
    expect(stats.digests_duplicate).toBe(1);
  });

  it("counts a send whose log write fails as failed", async () => {
    const repo = new MemoryRepo();
    const alice = repo.seedTestUser({ email: "alice@example.test" });
    await withDeadline(repo, alice, "alpha");
    repo.logDigest = async () => {
      throw new Error("db down");
    };
    const stats = await notifyStep(deps(repo, fakeSender()), EMAIL);
    expect(stats.digests_failed).toBe(1);
    expect(stats.digests_sent).toBe(0);
  });

  it("counts one user's context failure as failed and still sends the others", async () => {
    const repo = new MemoryRepo();
    const { bob } = await threeUsers(repo);
    const original = repo.getDigestContext.bind(repo);
    repo.getDigestContext = async (userId, since, now) => {
      if (userId === bob) throw new Error("db timeout");
      return original(userId, since, now);
    };
    const sender = fakeSender();
    const stats = await notifyStep(deps(repo, sender), EMAIL);
    expect(stats.digests_failed).toBe(1);
    expect(stats.digests_sent).toBe(1);
    expect(stats.digests_empty).toBe(1);
  });

  it("adds today's new airdrops only for users who opted in", async () => {
    const repo = new MemoryRepo();
    const optIn = repo.seedTestUser({ email: "in@example.test", newAirdropsOptIn: true });
    repo.seedTestUser({ email: "out@example.test" });
    const fresh = await repo.createProject(np("fresh", { name: "Fresh Drop" }), new Date(NOW.getTime() - 2 * HOUR));
    await repo.saveRiskAssessment(fresh.id, assessment("medium"), NOW);
    const sender = fakeSender();
    const stats = await notifyStep(deps(repo, sender), EMAIL);

    expect(stats.digests_sent).toBe(1);
    expect(stats.digests_empty).toBe(1);
    expect(sender.sent[0]?.to).toBe("in@example.test");
    expect(sender.sent[0]?.text).toContain("Fresh Drop (Announced, risk Medium)");
    expect(await repo.hasDigest(optIn, "2026-10-10")).toBe(true);
  });

  it("puts only numbers in the stats: no email address, user id or token", async () => {
    const repo = new MemoryRepo();
    const { alice } = await threeUsers(repo);
    const stats = await notifyStep(deps(repo, fakeSender((to) => (to.startsWith("bob") ? "throw" : false))), EMAIL);
    const json = JSON.stringify(stats);
    expect(json).not.toContain("@");
    expect(json).not.toContain(alice);
    for (const v of Object.values(stats)) expect(typeof v).toBe("number");
  });
});

describe("MemoryRepo digest data", () => {
  it("lists only digest-enabled users with a confirmed email, with their last digest time", async () => {
    const repo = new MemoryRepo();
    const ok = repo.seedTestUser({ email: "ok@example.test", newAirdropsOptIn: true, unsubscribeToken: "t-ok" });
    repo.seedTestUser({ email: "unconfirmed@example.test", emailConfirmed: false });
    repo.seedTestUser({ email: "off@example.test", digestEnabled: false });
    const earlier = new Date(NOW.getTime() - 3 * DAY);
    const later = new Date(NOW.getTime() - DAY);
    await repo.logDigest(ok, "2026-10-07", earlier);
    await repo.logDigest(ok, "2026-10-09", later);

    expect(await repo.listDigestRecipients()).toEqual([
      { userId: ok, email: "ok@example.test", newAirdropsOptIn: true, unsubscribeToken: "t-ok", lastDigestAt: later },
    ]);
  });

  it("rejects a second digest log for the same user and date with DuplicateDigestError", async () => {
    const repo = new MemoryRepo();
    const u = repo.seedTestUser({ email: "u@example.test" });
    await repo.logDigest(u, "2026-10-10", NOW);
    await expect(repo.logDigest(u, "2026-10-10", NOW)).rejects.toBeInstanceOf(DuplicateDigestError);
    expect(await repo.countDigestsSent("2026-10-10")).toBe(1);
    expect(await repo.countDigestsSent("2026-10-09")).toBe(0);
    expect(await repo.hasDigest(u, "2026-10-10")).toBe(true);
    expect(await repo.hasDigest(u, "2026-10-09")).toBe(false);
  });

  it("returns the watched projects with latest risk, their dated deadlines and changes after `since`", async () => {
    const repo = new MemoryRepo();
    const u = repo.seedTestUser({ email: "u@example.test" });
    const other = repo.seedTestUser({ email: "other@example.test" });
    const p = await oldProject(repo, "watched");
    const q = await oldProject(repo, "unwatched");
    repo.seedTestWatch(u, p.id);
    repo.seedTestWatch(other, q.id);
    await repo.saveRiskAssessment(p.id, assessment("low"), new Date(NOW.getTime() - 5 * DAY));
    await repo.saveRiskAssessment(p.id, assessment("high"), new Date(NOW.getTime() - 2 * DAY));
    await repo.updateProject(p.id, { status: "live" }, new Date(NOW.getTime() - HOUR));
    await repo.updateProject(q.id, { status: "live" }, new Date(NOW.getTime() - HOUR));
    await repo.replaceDeadlines(p.id, "d", [
      { kind: "snapshot", date: "2026-10-12", precision: "exact", text: "Snapshot" },
      { kind: "claim", date: null, precision: "approximate", text: "Soon" },
      { kind: "claim", date: "2026-10-11", precision: "approximate", text: "Claim" },
    ]);

    const since = new Date(NOW.getTime() - 3 * DAY);
    const ctx = await repo.getDigestContext(u, since, NOW);
    expect(ctx.lastDigestAt).toEqual(since);
    expect(ctx.watched).toEqual([
      { id: p.id, slug: "watched", name: "WATCHED", status: "live", riskLevel: "high", firstSeen: OLD },
    ]);
    // Undated deadlines are left out; date order.
    expect(ctx.deadlines).toEqual([
      { projectId: p.id, kind: "claim", date: "2026-10-11", precision: "approximate", text: "Claim" },
      { projectId: p.id, kind: "snapshot", date: "2026-10-12", precision: "exact", text: "Snapshot" },
    ]);
    // Changes after `since` (5 days ago is too old), oldest first, only for watched projects.
    expect(ctx.changes.map((c) => [c.field, c.oldValue, c.newValue])).toEqual([
      ["risk_level", "low", "high"],
      ["status", "announced", "live"],
    ]);

    // Without a previous digest the window is the last 24 hours.
    const fresh = await repo.getDigestContext(u, null, NOW);
    expect(fresh.lastDigestAt).toBeNull();
    expect(fresh.changes.map((c) => c.field)).toEqual(["status"]);
  });

  it("keeps insertion order for changes with the same timestamp, so a digest collapses A -> B -> C to A -> C", async () => {
    const repo = new MemoryRepo();
    const u = repo.seedTestUser({ email: "u@example.test" });
    const p = await oldProject(repo, "twice");
    repo.seedTestWatch(u, p.id);
    const at = new Date(NOW.getTime() - HOUR);
    await repo.updateProject(p.id, { status: "live" }, at);
    await repo.updateProject(p.id, { status: "ended" }, at);
    const ctx = await repo.getDigestContext(u, null, NOW);
    expect(ctx.changes.map((c) => [c.oldValue, c.newValue])).toEqual([
      ["announced", "live"],
      ["live", "ended"],
    ]);
    const sender = fakeSender();
    await notifyStep(deps(repo, sender), EMAIL);
    expect(sender.sent[0]?.text).toContain("TWICE: status Announced → Ended");
  });

  it("lists non-lookalike projects first seen within the window, newest first, capped, with their latest risk", async () => {
    const repo = new MemoryRepo();
    await repo.createProject(np("old"), new Date(NOW.getTime() - 24 * HOUR - 1));
    await repo.createProject(np("future"), new Date(NOW.getTime() + 1));
    const b = await repo.createProject(np("b-new"), new Date(NOW.getTime() - 2 * HOUR));
    const a = await repo.createProject(np("a-new"), new Date(NOW.getTime() - 3 * HOUR));
    const c = await repo.createProject(np("c-new"), new Date(NOW.getTime() - 24 * HOUR));
    const d = await repo.createProject(np("d-new"), new Date(NOW.getTime() - 2 * HOUR));
    const e = await repo.createProject(np("e-now"), NOW);
    // A lookalike of a known project is never advertised as a new airdrop.
    await repo.createProject(np("fake", { lookalikeOf: a.id }), new Date(NOW.getTime() - HOUR));
    await repo.saveRiskAssessment(a.id, assessment("low"), new Date(NOW.getTime() - HOUR));
    await repo.saveRiskAssessment(a.id, assessment("critical"), NOW);
    const list = await repo.listNewProjects(24, NOW, 10);
    // Same first_seen: id order.
    const [first, second] = [b, d].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(list.map((p) => [p.slug, p.riskLevel])).toEqual([
      ["e-now", null],
      [first?.slug, null],
      [second?.slug, null],
      ["a-new", "critical"],
      ["c-new", null],
    ]);
    expect(list[4]).toEqual({ id: c.id, slug: "c-new", name: "C-NEW", status: "announced", riskLevel: null, firstSeen: c.firstSeen });
    expect((await repo.listNewProjects(24, NOW, 2)).map((p) => p.id)).toEqual([e.id, first?.id]);
  });

  it("puts at most 10 new airdrops, newest first, in a digest", async () => {
    const repo = new MemoryRepo();
    repo.seedTestUser({ email: "in@example.test", newAirdropsOptIn: true });
    for (let i = 0; i < 12; i++) {
      await repo.createProject(np(`n${String(i).padStart(2, "0")}`), new Date(NOW.getTime() - (i + 1) * 60_000));
    }
    const sender = fakeSender();
    await notifyStep(deps(repo, sender), EMAIL);
    const listed = (sender.sent[0]?.text ?? "").match(/^- N\d\d/gm) ?? [];
    expect(listed).toEqual(["- N00", "- N01", "- N02", "- N03", "- N04", "- N05", "- N06", "- N07", "- N08", "- N09"]);
  });
});
