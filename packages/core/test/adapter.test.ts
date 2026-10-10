import { describe, expect, it } from "vitest";
import { isEvmAddress } from "../src/index.js";

describe("isEvmAddress", () => {
  it("accepts a 0x-prefixed 40-hex-char address", () => {
    expect(isEvmAddress("0x" + "a".repeat(40))).toBe(true);
  });

  it("rejects a short address", () => {
    expect(isEvmAddress("0x123")).toBe(false);
  });

  it("rejects a 42-char string with a non-hex character", () => {
    expect(isEvmAddress("0x" + "g".repeat(40))).toBe(false);
  });
});
