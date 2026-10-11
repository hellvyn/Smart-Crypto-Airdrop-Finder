import { describe, expect, it } from "vitest";
import { BANNED_WORDS, GLOSSARY, cleanStyle, findBanned, plainChatText } from "../src/index.js";

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

describe("plainChatText", () => {
  it("removes markdown emphasis, code ticks and heading marks but keeps the words", () => {
    expect(plainChatText("TGE itu **Token Generation Event**. Pakai `wallet` *resmi*.")).toBe(
      "TGE itu Token Generation Event. Pakai wallet resmi.",
    );
    expect(plainChatText("## Ringkasan\n* satu\n- dua")).toBe("Ringkasan\n- satu\n- dua");
    expect(plainChatText("__penting__ dan sisa ** tanda")).toBe("penting dan sisa  tanda");
  });

  it("drops JSON structure lines so a JSON plan never shows in a chat", () => {
    const text = 'Langkah 0: bikin wallet dulu.\n\n{\n  "tasks": [\n    {\n      "name": "Buat wallet",\n    }\n  ],\n}\nSelamat mencoba!';
    expect(plainChatText(text)).toBe("Langkah 0: bikin wallet dulu.\n\nSelamat mencoba!");
  });

  it("leaves ordinary text, multiplication and lone asterisks alone", () => {
    expect(plainChatText("Modal 2 * 5 = 10, catatan: lihat poin 3.")).toBe("Modal 2 * 5 = 10, catatan: lihat poin 3.");
    expect(plainChatText("Kalimat biasa tanpa format.")).toBe("Kalimat biasa tanpa format.");
  });
});
