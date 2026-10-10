import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { caseIdOf, exportCases, parseLimit, writeCases } from "../eval/export-cases.js";
import type { ExportRow, ExportSource } from "../eval/export-cases.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "export-cases-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function row(over: Partial<ExportRow> = {}): ExportRow {
  return {
    id: "0a1b2c3d-1111-2222-3333-444455556666",
    source_kind: "airdrops_io",
    url: "https://airdrops.io/zeta/",
    text: "Zeta airdrop text",
    published_at: null,
    ...over,
  };
}

describe("caseIdOf", () => {
  it("prefixes by source and uses the first 8 hex digits of the document id", () => {
    expect(caseIdOf(row())).toBe("aio_0a1b2c3d");
    expect(caseIdOf(row({ source_kind: "telegram", id: "ffee0011-aaaa-bbbb-cccc-ddddeeeeffff" }))).toBe("tg_ffee0011");
  });
});

describe("parseLimit", () => {
  it("reads --limit N and defaults to 40", () => {
    expect(parseLimit(["--limit", "12"])).toBe(12);
    expect(parseLimit([])).toBe(40);
  });

  it("rejects a missing, non-numeric, zero or negative value", () => {
    for (const bad of [["--limit"], ["--limit", "abc"], ["--limit", "0"], ["--limit", "-3"], ["--limit", "2.5"]]) {
      expect(() => parseLimit(bad)).toThrow(/--limit/);
    }
  });
});

describe("writeCases", () => {
  it("writes <id>.txt with the exact text and <id>.meta.json with source and published", () => {
    const dir = tempDir();
    const ids = writeCases(
      [row({ text: "line 1\nline 2", published_at: "2026-10-01T00:00:00+00:00" }), row({ id: "99999999-0000-0000-0000-000000000000", source_kind: "telegram", url: "https://t.me/s/chan/12", text: "post", published_at: null })],
      dir,
    );
    expect(ids).toEqual(["aio_0a1b2c3d", "tg_99999999"]);
    expect(readdirSync(dir).sort()).toEqual([
      "aio_0a1b2c3d.meta.json",
      "aio_0a1b2c3d.txt",
      "tg_99999999.meta.json",
      "tg_99999999.txt",
    ]);
    expect(readFileSync(join(dir, "aio_0a1b2c3d.txt"), "utf8")).toBe("line 1\nline 2");
    expect(JSON.parse(readFileSync(join(dir, "aio_0a1b2c3d.meta.json"), "utf8"))).toEqual({
      source: "https://airdrops.io/zeta/",
      published: "2026-10-01T00:00:00.000Z",
    });
    expect(JSON.parse(readFileSync(join(dir, "tg_99999999.meta.json"), "utf8"))).toEqual({
      source: "https://t.me/s/chan/12",
      published: null,
    });
  });

  it("skips rows whose text was purged (empty)", () => {
    const dir = tempDir();
    expect(writeCases([row({ text: "" }), row({ id: "bbbbbbbb-0000-0000-0000-000000000000", text: "  \n " })], dir)).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a row whose id would not make a safe file name", () => {
    const dir = tempDir();
    expect(() => writeCases([row({ id: "../../etc/pa" })], dir)).toThrow(/document id/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("exportCases", () => {
  it("asks for half the limit (rounded up) per source so telegram does not crowd out airdrops.io, and returns ids only", async () => {
    const asked: { kind: string; limit: number }[] = [];
    const source: ExportSource = {
      async latest(kind, limit) {
        asked.push({ kind, limit });
        return kind === "airdrops_io"
          ? [row()]
          : [row({ id: "99999999-0000-0000-0000-000000000000", source_kind: "telegram", url: "https://t.me/s/c/1", text: "post" })];
      },
    };
    const dir = tempDir();
    const ids = await exportCases(source, dir, 5);
    expect(asked).toEqual([
      { kind: "airdrops_io", limit: 3 },
      { kind: "telegram", limit: 3 },
    ]);
    expect(ids).toEqual(["aio_0a1b2c3d", "tg_99999999"]);
    expect(readdirSync(dir)).toHaveLength(4);
  });
});
