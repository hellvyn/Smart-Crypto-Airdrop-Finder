import { describe, expect, it } from "vitest";
import { allocateQuota } from "../src/index.js";

type P = 0 | 1 | 2;
const cands = (n: number, prio: (i: number) => P) =>
  Array.from({ length: n }, (_, i) => ({ key: `u${i}`, priority: prio(i) }));

describe("allocateQuota", () => {
  it("sends 240 of 300 and puts priority 0 first, keeping order within a priority", () => {
    const list = cands(300, (i) => (i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0));
    const r = allocateQuota(list, { dailyLimit: 300, reserveRatio: 0.2, sentToday: 0 });
    expect(r.send).toHaveLength(240);
    expect(r.skipped).toBe(60);
    const zeros = list.filter((c) => c.priority === 0).map((c) => c.key);
    expect(r.send.slice(0, zeros.length)).toEqual(zeros);
    const ones = list.filter((c) => c.priority === 1).map((c) => c.key);
    expect(r.send.slice(zeros.length, zeros.length + ones.length)).toEqual(ones);
    // all priority-2 skipped ones are the tail of the priority-2 list
    const twos = list.filter((c) => c.priority === 2).map((c) => c.key);
    expect(r.send.slice(zeros.length + ones.length)).toEqual(twos.slice(0, 240 - zeros.length - ones.length));
  });

  it("sends nothing when the digest budget is already used", () => {
    const r = allocateQuota(cands(10, () => 0), { dailyLimit: 300, reserveRatio: 0.2, sentToday: 240 });
    expect(r).toEqual({ send: [], skipped: 10 });
  });

  it("never goes negative when sentToday exceeds the budget", () => {
    const r = allocateQuota(cands(3, () => 1), { dailyLimit: 300, reserveRatio: 0.2, sentToday: 500 });
    expect(r).toEqual({ send: [], skipped: 3 });
  });

  it("sends everyone when the budget is large enough", () => {
    const r = allocateQuota(cands(5, () => 2), { dailyLimit: 300, reserveRatio: 0.2, sentToday: 0 });
    expect(r.send).toEqual(["u0", "u1", "u2", "u3", "u4"]);
    expect(r.skipped).toBe(0);
  });

  it("floors the budget", () => {
    const r = allocateQuota(cands(10, () => 2), { dailyLimit: 10, reserveRatio: 0.25, sentToday: 0 });
    expect(r.send).toHaveLength(7);
    expect(r.skipped).toBe(3);
  });

  it("treats invalid inputs as a zero budget", () => {
    const list = cands(4, () => 0);
    for (const opts of [
      { dailyLimit: -1, reserveRatio: 0.2, sentToday: 0 },
      { dailyLimit: Number.NaN, reserveRatio: 0.2, sentToday: 0 },
      { dailyLimit: 300, reserveRatio: Number.NaN, sentToday: 0 },
      { dailyLimit: 300, reserveRatio: 0.2, sentToday: Number.NaN },
      { dailyLimit: 300, reserveRatio: 1.5, sentToday: 0 },
      { dailyLimit: 300, reserveRatio: -0.5, sentToday: 0 },
      { dailyLimit: 300, reserveRatio: 0.2, sentToday: -5 },
    ]) {
      expect(allocateQuota(list, opts)).toEqual({ send: [], skipped: 4 });
    }
  });
});
