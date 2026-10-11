import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KEY_CHECKS } from "@saf/core";
import { describe, expect, it } from "vitest";

// public.key_checks_ran() (0012) hard-codes the 4 key check ids in SQL. They must be the ones core's curate() requires,
// or "{k}/4 security check jalan" would count something else than what decides whether a project is listed.
const SQL = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0012_curated_list.sql", import.meta.url)), "utf8");

describe("key_checks_ran() in 0012", () => {
  it("counts exactly core's key checks", () => {
    const fn = SQL.slice(SQL.indexOf("create function public.key_checks_ran"), SQL.indexOf("$$;"));
    const list = /c->>'id' in \(([^)]*)\)/.exec(fn)?.[1];
    expect(list).toBeDefined();
    const ids = [...list!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...KEY_CHECKS].sort());
  });
});
