import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath } from "./safe-next";

describe("safeNextPath (open-redirect guard)", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/watchlist")).toBe("/watchlist");
    expect(safeNextPath("/projects/abc?tab=risk#evidence")).toBe("/projects/abc?tab=risk#evidence");
    expect(safeNextPath("/")).toBe("/");
  });

  it("falls back for missing or non-string values", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT);
    expect(safeNextPath(42)).toBe(DEFAULT_NEXT);
    expect(safeNextPath(null, "/settings")).toBe("/settings");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example/watchlist")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("http:/evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("//evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("//evil.example/watchlist")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_NEXT);
  });

  it("rejects paths that do not start with a single slash", () => {
    expect(safeNextPath("watchlist")).toBe(DEFAULT_NEXT);
    expect(safeNextPath(" /watchlist")).toBe(DEFAULT_NEXT);
  });

  it("rejects backslash and control-character tricks browsers turn into //", () => {
    expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("\\\\evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\t/evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\n/evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/watch\u0000list")).toBe(DEFAULT_NEXT);
  });

  it("rejects dot segments that normalise to a protocol-relative path", () => {
    expect(safeNextPath("/.//evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/a/..//evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/%2e//evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/%2E%2E//evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/x/%2e%2e//evil.example/p")).toBe(DEFAULT_NEXT);
  });

  it("returns valid paths exactly as given, without normalising them", () => {
    for (const path of ["/watchlist", "/a/../watchlist", "/./settings", "/wallets/%2e%2e/x", "/p?q=a%20b#h", "/a//b"]) {
      expect(safeNextPath(path)).toBe(path);
    }
  });

  it("rejects non-ASCII and non-printable characters (they cannot go in a Location header)", () => {
    expect(safeNextPath("/日本")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\u0085")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/café")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/watch\u00a0list")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\u2028x")).toBe(DEFAULT_NEXT);
  });

  it("keeps printable ASCII paths, including percent-encoded non-ASCII", () => {
    expect(safeNextPath("/caf%C3%A9")).toBe("/caf%C3%A9");
    expect(safeNextPath("/a~b!$&'()*+,;=:@-._")).toBe("/a~b!$&'()*+,;=:@-._");
  });

  it("keeps encoded slashes as a harmless path", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });
});
