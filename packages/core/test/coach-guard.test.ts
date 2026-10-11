import { describe, expect, it } from "vitest";
import { groundedAgainst, redactSensitive, stepTranslationGrounded } from "../src/index.js";

const MARK = "[dihapus: info sensitif]";

describe("groundedAgainst", () => {
  it("refuses an address the context does not have", () => {
    expect(groundedAgainst("kirim ke 0xabc123def", "join the waitlist")).toBe(false);
  });

  it("accepts a host the context has", () => {
    expect(groundedAgainst("buka jumper.exchange", "Visit jumper.exchange")).toBe(true);
  });

  it("refuses a host the context does not have, even next to one it has", () => {
    expect(groundedAgainst("buka jumper.exchange atau evil.xyz", "Visit jumper.exchange")).toBe(false);
  });

  it("refuses a number the context does not have and accepts one it has in another format", () => {
    expect(groundedAgainst("butuh 50 USDC", "need 10 USDC")).toBe(false);
    expect(groundedAgainst("butuh 1.000 USDC", "need 1,000 USDC")).toBe(true);
  });

  it("refuses a secret term or payment verb the context lacks", () => {
    expect(groundedAgainst("masukkan seed phrase", "connect your wallet")).toBe(false);
    expect(groundedAgainst("bayar biaya kecil", "connect your wallet")).toBe(false);
    expect(groundedAgainst("masukkan seed phrase", "enter your seed phrase")).toBe(true);
  });

  it("accepts plain text that adds nothing", () => {
    expect(groundedAgainst("Hubungkan wallet", "Connect wallet")).toBe(true);
  });
});

describe("stepTranslationGrounded", () => {
  it("is groundedAgainst with the step as context", () => {
    expect(stepTranslationGrounded("Visit jumper.exchange", "buka jumper.exchange")).toBe(true);
    expect(stepTranslationGrounded("join the waitlist", "kirim ke 0xabc123def")).toBe(false);
  });
});

describe("redactSensitive", () => {
  it("replaces a host and a secret phrase the context lacks, counting both", () => {
    const out = redactSensitive("klaim di evil.xyz pakai seed phrase", "Jumper");
    expect(out.text).toBe(`klaim di ${MARK} pakai ${MARK}`);
    expect(out.text).not.toContain("evil.xyz");
    expect(out.text).not.toContain("seed phrase");
    expect(out.redactions).toBe(2);
  });

  it("keeps a token the context has, ignoring case for hosts", () => {
    expect(redactSensitive("buka Jumper.Exchange", "Visit jumper.exchange")).toEqual({
      text: "buka Jumper.Exchange",
      redactions: 0,
    });
  });

  it("replaces a whole URL, path included, when its host is not in the context", () => {
    const out = redactSensitive("buka https://evil.xyz/claim?x=1 sekarang.", "Jumper");
    expect(out).toEqual({ text: `buka ${MARK} sekarang.`, redactions: 1 });
  });

  it("replaces a handle, a 0x address and a base58 address the context lacks", () => {
    const base58 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const out = redactSensitive(`tanya @scammer lalu 0xAbC123dEf456 dan ${base58}`, "Jumper");
    expect(out).toEqual({ text: `tanya ${MARK} lalu ${MARK} dan ${MARK}`, redactions: 3 });
  });

  it("keeps a base58 address only when the case matches exactly", () => {
    const base58 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    expect(redactSensitive(`kirim ${base58}`, base58).text).toContain(base58);
    expect(redactSensitive(base58.toLowerCase(), base58).redactions).toBe(1);
  });

  it("replaces a secret phrase as one unit", () => {
    expect(redactSensitive("masukkan private key kamu", "Jumper")).toEqual({
      text: `masukkan ${MARK} kamu`,
      redactions: 1,
    });
  });

  it("replaces a secret term with its suffix as one whole span", () => {
    expect(redactSensitive("private keys dan seed phrases, kunci rahasianya", "Jumper")).toEqual({
      text: `${MARK} dan ${MARK}, ${MARK}`,
      redactions: 3,
    });
  });
});

describe("redactSensitive: payment verbs", () => {
  const cases: [string, string, string, number][] = [
    ["a payment verb alone is kept", "kirim transaksi swap di app resminya", "Jumper", 0],
    ["a payment verb alone is kept (bayar)", "bayar gas fee kecil", "Jumper", 0],
    ["verb next to a host not in context goes with it", "kirim ke evil.xyz", "Jumper", 2],
    ["verb next to an address not in context goes with it", "kirim ke 0xabc123def456", "Jumper", 2],
    ["verb next to a handle not in context goes with it", "bayar ke @scammer", "Jumper", 2],
    ["verb next to a secret term goes with it", "kirim seed phrase kamu", "Jumper", 2],
    ["verb next to a secret term goes with it, even when the context has the term", "kirim seed phrase kamu", "seed phrase", 2],
    ["the context never exempts a verb next to a trigger", "kirim ke evil.xyz", "kirim gas", 2],
    ["verb next to a number the context lacks goes", "bayar 5 USDC dulu untuk claim", "Jumper", 1],
    ["verb next to a number the context has is kept", "bayar 5 USDC dulu", "bayar 5 USDC", 0],
    ["numbers compare by digits", "bayar 1.000 USDC", "pay 1,000 USDC", 0],
    ["a prohibited secret term in the context is kept with its verb", "Jangan pernah kirim seed phrase", "seed phrase", 0],
    ["a prohibition marker works in English too", "Never send your seed phrase", "seed phrase", 0],
    ["a trigger in another sentence does not reach the verb", "Buka evil.xyz. Lalu kirim transaksi swap.", "Jumper", 1],
    ["a verb with a prefix is a whole word", "dikirim ke evil.xyz", "Jumper", 2],
    ["a verb with a prefix is a whole word (mengirim)", "mengirim 7 ETH", "Jumper", 1],
    ["a verb with a prefix is a whole word (membayar)", "membayar 7 ETH", "Jumper", 1],
    ["a noun form is a whole word (pembayaran)", "pembayaran 7 ETH", "Jumper", 1],
    ["send with a number the context lacks", "send 9 ETH", "Jumper", 1],
  ];
  it.each(cases)("%s", (_name, input, context, redactions) => {
    expect(redactSensitive(input, context).redactions).toBe(redactions);
  });

  it("redacts the verb and the host as whole words", () => {
    expect(redactSensitive("kirim ke evil.xyz", "Jumper").text).toBe(`${MARK} ke ${MARK}`);
    expect(redactSensitive("kirim seed phrase kamu", "Jumper").text).toBe(`${MARK} ${MARK} kamu`);
    expect(redactSensitive("bayar 5 USDC dulu untuk claim", "Jumper").text).toBe(`${MARK} 5 USDC dulu untuk claim`);
    expect(redactSensitive("dikirim ke evil.xyz", "Jumper").text).toBe(`${MARK} ke ${MARK}`);
    expect(redactSensitive("pembayaran 7 ETH", "Jumper").text).toBe(`${MARK} 7 ETH`);
  });

  it("with a prohibition marker, redacts only the secret term the context lacks and keeps the verb", () => {
    expect(redactSensitive("Jangan pernah kirim seed phrase", "Jumper")).toEqual({
      text: `Jangan pernah kirim ${MARK}`,
      redactions: 1,
    });
  });

  it("keeps the secret term next to a verb in a prohibition when the context has it", () => {
    expect(redactSensitive("Jangan pernah kirim seed phrase", "seed phrase")).toEqual({
      text: "Jangan pernah kirim seed phrase",
      redactions: 0,
    });
  });

  it("does not match payload, sender or other words that only start like a verb", () => {
    expect(redactSensitive("payload dan sender, kirim ke evil.xyz", "Jumper").text).toBe(`payload dan sender, ${MARK} ke ${MARK}`);
    expect(redactSensitive("payload 5 sender 9", "Jumper")).toEqual({ text: "payload 5 sender 9", redactions: 0 });
  });

  it("judges each sentence on its own, splitting on . ! ? and newlines but not on dots inside hosts or numbers", () => {
    const out = redactSensitive("Buka jumper.exchange 1.5 kali! Bayar gas.\nkirim ke evil.xyz", "Visit jumper.exchange 1.5");
    expect(out.text).toBe(`Buka jumper.exchange 1.5 kali! Bayar gas.\n${MARK} ke ${MARK}`);
    expect(out.redactions).toBe(2);
  });
});

describe("redactSensitive: secret terms are judged one by one", () => {
  it("redacts a secret term the context lacks even when the context has another one", () => {
    expect(redactSensitive("masukkan private key kamu", "seed phrase")).toEqual({
      text: `masukkan ${MARK} kamu`,
      redactions: 1,
    });
  });

  it("in a prohibition, keeps the term and the verb the context has and redacts the other term", () => {
    expect(redactSensitive("Jangan pernah kirim seed phrase atau private key", "seed phrase")).toEqual({
      text: `Jangan pernah kirim seed phrase atau ${MARK}`,
      redactions: 1,
    });
  });

  it("keeps a term the context has however it is cased, spaced or suffixed", () => {
    expect(redactSensitive("Simpan Seed  Phrases dengan baik", "your seed phrase")).toEqual({
      text: "Simpan Seed  Phrases dengan baik",
      redactions: 0,
    });
  });

  it("counts different wordings as different terms", () => {
    expect(redactSensitive("jaga kunci privat", "kunci pribadi").redactions).toBe(1);
  });
});

describe("redactSensitive: payment and terkirim", () => {
  it.each([
    ["payment 5 USDC", `${MARK} 5 USDC`, 1],
    ["payments 5 USDC", `${MARK} 5 USDC`, 1],
    ["terkirim 5 ETH", `${MARK} 5 ETH`, 1],
    ["terkirim ke evil.xyz", `${MARK} ke ${MARK}`, 2],
    ["payment ke evil.xyz", `${MARK} ke ${MARK}`, 2],
  ])("redacts %s next to a trigger", (input, text, redactions) => {
    expect(redactSensitive(input, "Jumper")).toEqual({ text, redactions });
  });

  it.each(["payment gas fee kecil", "payments dari app resmi", "transaksi terkirim di app resmi", "paymentgateway"])(
    "keeps %s with no trigger",
    (input) => {
      expect(redactSensitive(input, "Jumper")).toEqual({ text: input, redactions: 0 });
    },
  );
});

describe("redactSensitive: URLs", () => {
  it("keeps a URL whose host is in the context, send in the path included", () => {
    expect(redactSensitive("https://jumper.exchange/send/now", "Visit jumper.exchange")).toEqual({
      text: "https://jumper.exchange/send/now",
      redactions: 0,
    });
  });

  it("redacts a URL whose host is not in the context as one span", () => {
    expect(redactSensitive("https://evil.xyz/send/now", "Visit jumper.exchange")).toEqual({ text: MARK, redactions: 1 });
  });

  it("keeps scheme and host of a kept URL and redacts a host nested in its query", () => {
    expect(redactSensitive("https://jumper.exchange/r?u=https://evil.xyz/x", "Visit jumper.exchange")).toEqual({
      text: `https://jumper.exchange/r?u=${MARK}`,
      redactions: 1,
    });
  });

  it("redacts a handle or address nested in the path of a kept URL", () => {
    expect(redactSensitive("https://jumper.exchange/u/@scammer", "Visit jumper.exchange")).toEqual({
      text: `https://jumper.exchange/u/${MARK}`,
      redactions: 1,
    });
  });

  it("keeps a port on a kept URL and a trailing full stop outside the URL", () => {
    expect(redactSensitive("Buka https://jumper.exchange:8080/a.", "jumper.exchange")).toEqual({
      text: "Buka https://jumper.exchange:8080/a.",
      redactions: 0,
    });
  });

  it("treats a nested redaction as a trigger for a verb in the sentence", () => {
    const out = redactSensitive("kirim lewat https://jumper.exchange/r?u=https://evil.xyz/x", "Visit jumper.exchange");
    expect(out).toEqual({ text: `${MARK} lewat https://jumper.exchange/r?u=${MARK}`, redactions: 2 });
  });
});

describe("redactSensitive: plain text", () => {
  it("leaves text without sensitive tokens unchanged", () => {
    expect(redactSensitive("Bridge ETH ke Ink, 10 menit per hari", "Bridge ETH to Ink, 10 minutes")).toEqual({
      text: "Bridge ETH ke Ink, 10 menit per hari",
      redactions: 0,
    });
  });
});
