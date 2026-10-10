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

  it("keeps encoded slashes as a harmless path", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });
});
