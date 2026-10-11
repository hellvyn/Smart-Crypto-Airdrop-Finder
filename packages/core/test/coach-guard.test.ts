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

  it("replaces a secret phrase as one unit and a payment verb the context lacks", () => {
    expect(redactSensitive("masukkan private key kamu", "Jumper")).toEqual({
      text: `masukkan ${MARK} kamu`,
      redactions: 1,
    });
    expect(redactSensitive("bayar sekarang", "Jumper").redactions).toBe(1);
    expect(redactSensitive("bayar sekarang", "bayar gas").redactions).toBe(0);
  });

  it("leaves text without sensitive tokens unchanged", () => {
    expect(redactSensitive("Bridge ETH ke Ink, 10 menit per hari", "Bridge ETH to Ink, 10 minutes")).toEqual({
      text: "Bridge ETH ke Ink, 10 menit per hari",
      redactions: 0,
    });
  });
});
