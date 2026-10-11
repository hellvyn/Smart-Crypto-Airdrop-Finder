import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHECK_OF_REASON, KEY_CHECKS } from "@saf/core";
import { describe, expect, it } from "vitest";

// public_risk_checks (0013) hard-codes in SQL which checks are key checks and which warning flags which check. They
// must be core's KEY_CHECKS and CHECK_OF_REASON, or a visitor would see a check as clean (or flagged) while the
// member page, which reads the table, says otherwise.
const SQL = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0013_member_checks.sql", import.meta.url)), "utf8");
const VIEW = SQL.slice(SQL.indexOf("create view public.public_risk_checks"), SQL.indexOf("alter view public.public_risk_checks"));

describe("public_risk_checks in 0013", () => {
  it("splits key and advanced checks by core's key checks", () => {
    const lists = [...VIEW.matchAll(/e\.c->>'id' (not in|in) \(([^)]*)\)/g)].map((m) => [m[1], [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()]);
    expect(lists).toEqual([
      ["in", [...KEY_CHECKS].sort()],
      ["not in", [...KEY_CHECKS].sort()],
    ]);
  });

  it("flags a check by exactly core's warning-to-check map", () => {
    const pairs = Object.fromEntries([...VIEW.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(CHECK_OF_REASON);
  });
});
