import { describe, expect, it } from "vitest";
import { buildChangeFeed, type ChangeRow, type DeadlineRow } from "../lib/changes";

// 19:00 WIB on 10 October 2026.
const now = new Date("2026-10-10T12:00:00Z");
const RUN = "2026-10-09T23:00:00+00:00";
const EARLIER_RUN = "2026-10-08T23:00:00+00:00";

const P1 = { slug: "one", name: "One" };
const P2 = { slug: "two", name: "Two" };

let seq = 0;
function change(over: Partial<ChangeRow> & Pick<ChangeRow, "field" | "newValue">): ChangeRow {
  seq += 1;
  return { projectId: "p1", project: P1, oldValue: null, changedAt: RUN, seq, ...over };
}

function deadline(over: Partial<DeadlineRow> = {}): DeadlineRow {
  return { projectId: "p1", project: P1, kind: "claim", date: "2026-10-11", precision: "exact", ...over };
}

/** The change items, for projects none of which is ended now unless `endedNow` says so. */
const changeItems = (rows: ChangeRow[], endedNow: string[] = []) => buildChangeFeed(rows, [], new Set(endedNow), now).changes;
const deadlineItems = (rows: DeadlineRow[]) => buildChangeFeed([], rows, new Set(), now).deadlines;

/** n distinct projects entering the list for the first time in the run `at`. */
function firstEntries(n: number, at = RUN): ChangeRow[] {
  return Array.from({ length: n }, (_, i) =>
    change({ projectId: `new${i}`, project: { slug: `new-${i}`, name: `New ${i}` }, field: "curated", newValue: "true", changedAt: at }),
  );
}

describe("buildChangeFeed: changes", () => {
  it("curated true -> false is 'Keluar dari list'", () => {
    expect(changeItems([change({ field: "curated", oldValue: "true", newValue: "false" })])).toEqual([
      { kind: "curated_out", project: P1, at: RUN },
    ]);
  });

  it("curated false -> true and a first passing curation (old null) are both 'Masuk list'", () => {
    const items = changeItems([
      change({ field: "curated", oldValue: "false", newValue: "true" }),
      change({ projectId: "p2", project: P2, field: "curated", oldValue: null, newValue: "true" }),
    ]);
    expect(items).toEqual([
      { kind: "curated_in", project: P2, at: RUN },
      { kind: "curated_in", project: P1, at: RUN },
    ]);
  });

  it("a status change to ended is 'Udah ended'", () => {
    expect(changeItems([change({ field: "status", oldValue: "live", newValue: "ended" })])).toEqual([
      { kind: "ended", project: P1, at: RUN },
    ]);
  });

  it("ended and curated true -> false in the same run is only 'Udah ended', never 'Keluar dari list' (#40)", () => {
    const items = changeItems([
      change({ field: "curated", oldValue: "true", newValue: "false" }),
      change({ field: "status", oldValue: "live", newValue: "ended" }),
    ]);
    expect(items).toEqual([{ kind: "ended", project: P1, at: RUN }]);
  });

  it("a project that is ended now never reads 'Keluar dari list', even when it left the list in a later run", () => {
    const items = changeItems(
      [
        change({ field: "status", oldValue: "live", newValue: "ended", changedAt: EARLIER_RUN }),
        change({ field: "curated", oldValue: "true", newValue: "false" }),
      ],
      ["p1"],
    );
    expect(items).toEqual([{ kind: "ended", project: P1, at: EARLIER_RUN }]);
  });

  it("a split run (the ending already marked seen, only the curated flip left) shows nothing for an ended project", () => {
    expect(changeItems([change({ field: "curated", oldValue: "true", newValue: "false" })], ["p1"])).toEqual([]);
  });

  it("a project no longer ended (it came back) can read 'Keluar dari list' again", () => {
    const items = changeItems([
      change({ field: "status", oldValue: "live", newValue: "ended", changedAt: EARLIER_RUN }),
      change({ field: "curated", oldValue: "true", newValue: "false" }),
    ]);
    expect(items).toEqual([
      { kind: "curated_out", project: P1, at: RUN },
      { kind: "ended", project: P1, at: EARLIER_RUN },
    ]);
  });

  it("another project ending, now or in the same run, does not hide this project leaving the list", () => {
    const items = changeItems(
      [
        change({ projectId: "p2", project: P2, field: "status", oldValue: "live", newValue: "ended" }),
        change({ field: "curated", oldValue: "true", newValue: "false" }),
      ],
      ["p2"],
    );
    expect(items).toContainEqual({ kind: "curated_out", project: P1, at: RUN });
    expect(items).toContainEqual({ kind: "ended", project: P2, at: RUN });
  });

  it("other status changes carry the old and new status", () => {
    expect(changeItems([change({ field: "status", oldValue: "announced", newValue: "live" })])).toEqual([
      { kind: "status", project: P1, from: "announced", to: "live", at: RUN },
    ]);
  });

  it("risk changes carry the old and new level; a first assessment has no old level", () => {
    const items = changeItems([
      change({ field: "risk_level", oldValue: "low", newValue: "high" }),
      change({ projectId: "p2", project: P2, field: "risk_level", oldValue: null, newValue: "medium", changedAt: EARLIER_RUN }),
    ]);
    expect(items).toEqual([
      { kind: "risk", project: P1, from: "low", to: "high", at: RUN },
      { kind: "risk", project: P2, from: null, to: "medium", at: EARLIER_RUN },
    ]);
  });

  it("several changes of one field in one run collapse to the first old and the last new value", () => {
    const items = changeItems([
      change({ field: "status", oldValue: "announced", newValue: "live" }),
      change({ field: "status", oldValue: "live", newValue: "ended" }),
    ]);
    expect(items).toEqual([{ kind: "ended", project: P1, at: RUN }]);
  });

  it("the same collapse orders by seq, not by the order rows arrive in", () => {
    const later = change({ field: "risk_level", oldValue: "medium", newValue: "high" });
    const earlier = { ...change({ field: "risk_level", oldValue: "low", newValue: "medium" }), seq: later.seq - 100 };
    expect(changeItems([later, earlier])).toEqual([{ kind: "risk", project: P1, from: "low", to: "high", at: RUN }]);
  });

  it("a change that comes back to where it started within one run is not shown", () => {
    const items = changeItems([
      change({ field: "risk_level", oldValue: "low", newValue: "high" }),
      change({ field: "risk_level", oldValue: "high", newValue: "low" }),
      change({ field: "curated", oldValue: "true", newValue: "false" }),
      change({ field: "curated", oldValue: "false", newValue: "true" }),
    ]);
    expect(items).toEqual([]);
  });

  it("a first curation that fails (null -> false) is not a change for the member", () => {
    expect(changeItems([change({ field: "curated", oldValue: null, newValue: "false" })])).toEqual([]);
  });

  it("rows of the same run in different timestamp spellings belong to one run", () => {
    const items = changeItems([
      change({ field: "curated", oldValue: "true", newValue: "false", changedAt: "2026-10-09T23:00:00Z" }),
      change({ field: "status", oldValue: "live", newValue: "ended", changedAt: "2026-10-09T23:00:00.000+00:00" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["ended"]);
  });

  it("an unknown field is left out; unknown status or risk values read as unknown / not assessed", () => {
    const items = changeItems([
      change({ field: "name", oldValue: "a", newValue: "b" }),
      change({ field: "status", oldValue: "paused", newValue: "live" }),
      change({ field: "risk_level", oldValue: "low", newValue: "extreme" }),
    ]);
    // Same run: the later row (greater seq) first.
    expect(items).toEqual([
      { kind: "risk", project: P1, from: "low", to: null, at: RUN },
      { kind: "status", project: P1, from: "unknown", to: "live", at: RUN },
    ]);
  });
});

describe("buildChangeFeed: the first-run flood (ruling 1)", () => {
  it("up to 3 first-time entries in one run are listed one by one", () => {
    expect(changeItems(firstEntries(3)).map((i) => i.kind)).toEqual(["curated_in", "curated_in", "curated_in"]);
  });

  it("4 or more first-time entries in one run become one '{n} project masuk list' item", () => {
    expect(changeItems(firstEntries(30))).toEqual([{ kind: "curated_in_many", count: 30, at: RUN }]);
  });

  it("only first-time entries are counted; a re-entry and the other changes of that run stay as they are", () => {
    const items = changeItems([
      ...firstEntries(4),
      change({ projectId: "p2", project: P2, field: "curated", oldValue: "false", newValue: "true" }),
      change({ field: "risk_level", oldValue: "low", newValue: "high" }),
    ]);
    expect(items).toHaveLength(3);
    expect(items).toContainEqual({ kind: "curated_in_many", count: 4, at: RUN });
    expect(items).toContainEqual({ kind: "curated_in", project: P2, at: RUN });
    expect(items).toContainEqual({ kind: "risk", project: P1, from: "low", to: "high", at: RUN });
  });

  it("first-time entries are counted per run", () => {
    expect(changeItems([...firstEntries(4), ...firstEntries(2, EARLIER_RUN)]).map((i) => i.kind)).toEqual([
      "curated_in_many",
      "curated_in",
      "curated_in",
    ]);
  });
});

describe("buildChangeFeed: deadlines within 48 hours", () => {
  it("lists claim, snapshot and campaign_end deadlines with an exact or approximate date in the next 48 hours, nearest first", () => {
    const items = deadlineItems([
      deadline({ projectId: "p2", project: P2, kind: "campaign_end", date: "2026-10-12" }),
      deadline({ kind: "snapshot", date: "2026-10-11", precision: "approximate" }),
      deadline({ kind: "claim", date: "2026-10-10" }),
    ]);
    expect(items).toEqual([
      { project: P1, deadlineKind: "claim", date: "2026-10-10", approximate: false },
      { project: P1, deadlineKind: "snapshot", date: "2026-10-11", approximate: true },
      { project: P2, deadlineKind: "campaign_end", date: "2026-10-12", approximate: false },
    ]);
  });

  it.each([
    ["a past date", deadline({ date: "2026-10-09" })],
    ["a date past the 48 hours", deadline({ date: "2026-10-13" })],
    ["a month-only date", deadline({ precision: "month" })],
    ["a quarter-only date", deadline({ precision: "quarter" })],
    ["a TGE", deadline({ kind: "tge" })],
    ["a withdraw deadline", deadline({ kind: "withdraw_funds" })],
    ["another kind", deadline({ kind: "other" })],
  ])("leaves out %s", (_, d) => {
    expect(deadlineItems([d])).toEqual([]);
  });

  it("the same deadline from two sources is listed once, as exact when one source has the exact date", () => {
    expect(
      deadlineItems([deadline({ precision: "approximate" }), deadline({ precision: "exact" }), deadline({ precision: "approximate" })]),
    ).toEqual([{ project: P1, deadlineKind: "claim", date: "2026-10-11", approximate: false }]);
  });

  it("a deadline is a reminder, not a change: it is listed whatever the changes are (marking the changes seen never hides it)", () => {
    // After "Tandai sudah dibaca" there are no change rows left; the deadline in the window is still there.
    const feed = buildChangeFeed([], [deadline({ date: "2026-10-11" })], new Set(), now);
    expect(feed.changes).toEqual([]);
    expect(feed.deadlines).toEqual([{ project: P1, deadlineKind: "claim", date: "2026-10-11", approximate: false }]);
  });

  it("keeps at most 20 deadlines, the nearest", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      deadline({ projectId: `p${i}`, project: { slug: `p-${i}`, name: `P ${String(i).padStart(2, "0")}` }, date: i < 5 ? "2026-10-10" : "2026-10-11" }),
    );
    const items = deadlineItems(rows);
    expect(items).toHaveLength(20);
    expect(items.filter((d) => d.date === "2026-10-10")).toHaveLength(5);
  });
});

describe("buildChangeFeed: order and size of the changes", () => {
  it("newest first", () => {
    const items = changeItems([
      change({ field: "risk_level", oldValue: "low", newValue: "high", changedAt: "2026-10-08T23:00:00Z" }),
      change({ field: "curated", oldValue: "true", newValue: "false", changedAt: "2026-10-10T08:00:00Z" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["curated_out", "risk"]);
  });

  it("keeps at most 20 items, the newest", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      change({
        projectId: `p${i}`,
        project: { slug: `p-${i}`, name: `P ${i}` },
        field: "risk_level",
        oldValue: "low",
        newValue: "high",
        changedAt: new Date(Date.UTC(2026, 9, 9, 0, i)).toISOString(),
      }),
    );
    const items = changeItems(rows);
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ project: { slug: "p-24" } });
    expect(items[19]).toMatchObject({ project: { slug: "p-5" } });
  });
});
