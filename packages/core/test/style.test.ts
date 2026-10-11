import { describe, expect, it } from "vitest";
import { BANNED_WORDS, GLOSSARY, cleanStyle, findBanned } from "../src/index.js";

describe("findBanned", () => {
  it("lists each banned word found, in list order", () => {
    expect(findBanned("Ini krusial dan seamless")).toEqual(["krusial", "seamless"]);
  });

  it("matches whole words and phrases only, ignoring case and extra spaces", () => {
    expect(findBanned("Totally SAFE")).toEqual(["safe"]);
    expect(findBanned("Pasti  untung")).toEqual(["pasti untung"]);
    expect(findBanned("Risiko kontrak token, keamanan, nyaman, safeHttpUrl, realme")).toEqual([]);
  });

  it("lists a word once however often it appears", () => {
    expect(findBanned("aman, aman, aman")).toEqual(["aman"]);
  });
});

describe("BANNED_WORDS", () => {
  it("keeps the shared list the copy-style gate has always used", () => {
    expect(BANNED_WORDS).toHaveLength(24);
    expect(BANNED_WORDS).toContain("pasti untung");
    expect(BANNED_WORDS).toContain("di era");
  });
});

describe("cleanStyle", () => {
  it("replaces an em dash and the spaces around it with a comma", () => {
    expect(cleanStyle("a — b")).toBe("a, b");
    expect(cleanStyle("a—b — c")).toBe("a, b, c");
  });

  it("leaves text without an em dash alone", () => {
    expect(cleanStyle("a - b, c")).toBe("a - b, c");
  });
});

describe("GLOSSARY", () => {
  it("has the 16 rows of the spec, each with a term and a text", () => {
    expect(GLOSSARY).toHaveLength(16);
    expect(GLOSSARY[0]?.term).toBe("Wallet");
    expect(GLOSSARY[15]?.term).toBe("Connect wallet");
    for (const row of GLOSSARY) {
      expect(row.term).not.toBe("");
      expect(row.text).not.toBe("");
    }
  });

  it("follows the writing style: no banned word, no em dash", () => {
    for (const row of GLOSSARY) {
      expect(findBanned(row.text)).toEqual([]);
      expect(findBanned(row.term)).toEqual([]);
      expect(row.text).not.toContain("—");
    }
  });
});
