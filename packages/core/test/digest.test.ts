import { describe, expect, it } from "vitest";
import { buildDigest } from "../src/index.js";
import type { DigestInput, DigestProject } from "../src/index.js";

const now = new Date("2026-10-10T23:30:00Z");
const old = new Date("2026-09-01T00:00:00Z");
const proj = (id: string, extra: Partial<DigestProject> = {}): DigestProject => ({
  id,
  slug: id,
  name: id.toUpperCase(),
  status: "live",
  riskLevel: "low",
  firstSeen: old,
  ...extra,
});
const a = proj("a");
const b = proj("b");

const base = (over: Partial<DigestInput> = {}): DigestInput => ({
  now,
  lastDigestAt: new Date("2026-10-09T08:00:00Z"),
  watched: [a, b],
  deadlines: [],
  changes: [],
  newProjects: null,
  ...over,
});
const dl = (date: string, extra: Partial<DigestInput["deadlines"][number]> = {}) => ({
  projectId: "a",
  kind: "claim" as const,
  date,
  precision: "exact" as const,
  text: "t",
  ...extra,
});
const chg = (
  field: "status" | "risk_level",
  oldValue: string | null,
  newValue: string,
  at = "2026-10-10T01:00:00Z",
  projectId = "a",
) => ({ projectId, field, oldValue, newValue, changedAt: new Date(at) });

describe("buildDigest deadlines", () => {
  it("includes a deadline 2 days out", () => {
    const d = buildDigest(base({ deadlines: [dl("2026-10-12")] }));
    expect(d?.deadlinesSoon).toEqual([
      { project: a, kind: "claim", date: "2026-10-12", precision: "exact", isToday: false },
    ]);
  });
  it("excludes a deadline 3 days out", () => {
    expect(buildDigest(base({ deadlines: [dl("2026-10-13")] }))).toBeNull();
  });
  it("includes today with isToday true", () => {
    const d = buildDigest(base({ deadlines: [dl("2026-10-10")] }));
    expect(d?.deadlinesSoon[0]?.isToday).toBe(true);
  });
  it("excludes yesterday", () => {
    expect(buildDigest(base({ deadlines: [dl("2026-10-09")] }))).toBeNull();
  });
  it("excludes tge/other kinds and month/quarter precision", () => {
    expect(
      buildDigest(
        base({
          deadlines: [
            dl("2026-10-11", { kind: "tge" }),
            dl("2026-10-11", { kind: "other" }),
            dl("2026-10-11", { precision: "quarter" }),
            dl("2026-10-11", { precision: "month" }),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("includes all four allowed kinds and approximate precision", () => {
    const kinds = ["claim", "snapshot", "campaign_end", "withdraw_funds"] as const;
    const d = buildDigest(
      base({ deadlines: kinds.map((kind) => dl("2026-10-11", { kind, precision: "approximate" })) }),
    );
    expect(d?.deadlinesSoon.map((x) => x.kind)).toEqual([...kinds]);
  });
  it("excludes deadlines of unwatched projects", () => {
    expect(buildDigest(base({ deadlines: [dl("2026-10-11", { projectId: "zzz" })] }))).toBeNull();
  });
  it("rolls the window with UTC dates across a month boundary", () => {
    const d = buildDigest(
      base({
        now: new Date("2026-10-30T12:00:00Z"),
        deadlines: [dl("2026-11-01"), dl("2026-11-02")],
      }),
    );
    expect(d?.deadlinesSoon.map((x) => x.date)).toEqual(["2026-11-01"]);
  });
});

describe("buildDigest priority and emptiness", () => {
  it("deadline gives priority 0", () => {
    const d = buildDigest(
      base({ deadlines: [dl("2026-10-11")], changes: [chg("risk_level", "low", "high")] }),
    );
    expect(d?.priority).toBe(0);
  });
  it("risk_level change only gives priority 1", () => {
    expect(buildDigest(base({ changes: [chg("risk_level", "low", "high")] }))?.priority).toBe(1);
  });
  it("status change only gives priority 2", () => {
    expect(buildDigest(base({ changes: [chg("status", "live", "ended")] }))?.priority).toBe(2);
  });
  it("new projects only give priority 2", () => {
    const n = proj("n", { firstSeen: new Date("2026-10-10T05:00:00Z") });
    const d = buildDigest(base({ newProjects: [n] }));
    expect(d?.priority).toBe(2);
    expect(d?.newProjects).toEqual([n]);
  });
  it("returns null when everything is empty", () => {
    expect(buildDigest(base({ newProjects: [] }))).toBeNull();
  });
  it("newProjects null leaves the section empty", () => {
    const d = buildDigest(base({ changes: [chg("status", "live", "ended")], newProjects: null }));
    expect(d?.newProjects).toEqual([]);
  });
});

describe("buildDigest changes", () => {
  it("only includes watched projects, ordered by changedAt asc", () => {
    const d = buildDigest(
      base({
        changes: [
          chg("status", "live", "ended", "2026-10-10T05:00:00Z", "b"),
          chg("status", "live", "ended", "2026-10-10T03:00:00Z", "zzz"),
          chg("risk_level", "low", "high", "2026-10-10T02:00:00Z", "a"),
        ],
      }),
    );
    expect(d?.changes.map((c) => c.project.id)).toEqual(["a", "b"]);
  });
  it("collapses multiple changes of the same field, oldValue from earliest, newValue from latest", () => {
    const d = buildDigest(
      base({
        changes: [
          chg("status", "announced", "live", "2026-10-10T01:00:00Z"),
          chg("status", "live", "ended", "2026-10-10T04:00:00Z"),
        ],
      }),
    );
    expect(d?.changes).toEqual([{ project: a, field: "status", oldValue: "announced", newValue: "ended" }]);
  });
  it("collapses out of order input by changedAt", () => {
    const d = buildDigest(
      base({
        changes: [
          chg("status", "live", "ended", "2026-10-10T04:00:00Z"),
          chg("status", "announced", "live", "2026-10-10T01:00:00Z"),
        ],
      }),
    );
    expect(d?.changes[0]).toMatchObject({ oldValue: "announced", newValue: "ended" });
  });
  it("drops a change that returns to its old value (live -> ended -> live)", () => {
    expect(
      buildDigest(
        base({
          changes: [
            chg("status", "live", "ended", "2026-10-10T01:00:00Z"),
            chg("status", "ended", "live", "2026-10-10T04:00:00Z"),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("keeps different fields of the same project separate", () => {
    const d = buildDigest(
      base({
        changes: [chg("status", "live", "ended"), chg("risk_level", "low", "high", "2026-10-10T02:00:00Z")],
      }),
    );
    expect(d?.changes.map((c) => c.field)).toEqual(["status", "risk_level"]);
  });
});

describe("buildDigest first-seen rule", () => {
  const fresh = proj("a", { firstSeen: new Date("2026-10-10T05:00:00Z") });
  it("drops changes of projects first seen at/after lastDigestAt", () => {
    const d = buildDigest(
      base({
        watched: [fresh, b],
        lastDigestAt: new Date("2026-10-10T05:00:00Z"),
        changes: [chg("status", "live", "ended", "2026-10-10T06:00:00Z", "a")],
      }),
    );
    expect(d).toBeNull();
  });
  it("keeps changes of projects first seen before lastDigestAt", () => {
    const early = proj("a", { firstSeen: new Date("2026-10-10T04:59:59Z") });
    const d = buildDigest(
      base({
        watched: [early, b],
        lastDigestAt: new Date("2026-10-10T05:00:00Z"),
        changes: [chg("status", "live", "ended", "2026-10-10T06:00:00Z", "a")],
      }),
    );
    expect(d?.changes).toHaveLength(1);
  });
  it("with null lastDigestAt uses now - 24h as threshold", () => {
    const justInside = proj("a", { firstSeen: new Date("2026-10-09T23:30:00Z") }); // == now-24h -> new
    const justBefore = proj("b", { firstSeen: new Date("2026-10-09T23:29:59Z") }); // older -> changed
    const d = buildDigest(
      base({
        watched: [justInside, justBefore],
        lastDigestAt: null,
        changes: [
          chg("status", "live", "ended", "2026-10-10T06:00:00Z", "a"),
          chg("status", "live", "ended", "2026-10-10T07:00:00Z", "b"),
        ],
      }),
    );
    expect(d?.changes.map((c) => c.project.id)).toEqual(["b"]);
  });
  it("does not affect deadlines or newProjects", () => {
    const d = buildDigest(
      base({
        watched: [fresh],
        lastDigestAt: null,
        deadlines: [dl("2026-10-11")],
        newProjects: [fresh],
      }),
    );
    expect(d?.deadlinesSoon).toHaveLength(1);
    expect(d?.newProjects).toEqual([fresh]);
  });
});
