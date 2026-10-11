import { describe, expect, it } from "vitest";
import { analystSchema, forbiddenPhrases, postProcessAnalyst, stepTranslationGrounded } from "../src/index.js";
import type { AnalystAnswer } from "../src/index.js";

const U = "https://airdrops.io/ink/";
const V = "https://t.me/airdrops_io/123";
const E: AnalystAnswer["effort"] = { minutes_per_day: 10, capital_usd_min: null, note: "Cukup bridge sekali, sisanya swap kecil." };

const valid: AnalystAnswer = {
  verdict: "garap",
  confidence: "sedang",
  points: [{ text: "Alokasi 5% dari supply.", quote: "allocation of 5%", source_url: U }],
  effort: E,
  steps_id: [{ text: "Bridge ETH ke Ink", cadence: "once" }],
};

describe("analystSchema", () => {
  it("accepts an Indonesian answer with 1 to 5 points", () => {
    expect(analystSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an English-only verdict value", () => {
    expect(analystSchema.safeParse({ ...valid, verdict: "farm" }).success).toBe(false);
  });

  it("rejects an English confidence value", () => {
    expect(analystSchema.safeParse({ ...valid, confidence: "high" }).success).toBe(false);
  });

  it.each([
    ["no points", []],
    ["six points", Array(6).fill(valid.points[0])],
  ])("rejects %s", (_what, points) => {
    expect(analystSchema.safeParse({ ...valid, points }).success).toBe(false);
  });

  it("rejects a negative effort estimate", () => {
    expect(analystSchema.safeParse({ ...valid, effort: { ...E, minutes_per_day: -5 } }).success).toBe(false);
  });

  it("rejects a step with an unknown cadence", () => {
    expect(analystSchema.safeParse({ ...valid, steps_id: [{ text: "Swap", cadence: "monthly" }] }).success).toBe(false);
  });
});

describe("postProcessAnalyst", () => {
  it("drops points whose quote is not in the cited source and downgrades an unsupported verdict", () => {
    const r = postProcessAnalyst(
      { verdict: "garap", confidence: "tinggi", points: [{ text: "Alokasi 5%", quote: "allocation of 10%", source_url: U }], effort: E, steps_id: [] },
      [{ url: U, text: "allocation of 5%" }],
    );
    expect(r.points).toEqual([]);
    expect(r.verdict).toBe("pantau");
    expect(r.confidence).toBe("rendah");
  });

  it("keeps a point quoted from its cited source, ignoring case and whitespace, and keeps the verdict", () => {
    const r = postProcessAnalyst(
      { ...valid, confidence: "tinggi", points: [{ text: "Alokasi 5%.", quote: "Allocation  of\n5%", source_url: U }] },
      [{ url: U, text: "The allocation of 5% goes to early users." }],
    );
    expect(r.points).toEqual([{ text: "Alokasi 5%.", quote: "Allocation  of\n5%", source_url: U }]);
    expect(r.verdict).toBe("garap");
    expect(r.confidence).toBe("tinggi");
  });

  it("drops a point whose quote is only in another source than the one it cites", () => {
    const supported = { text: "Ada mekanisme poin.", quote: "earn points daily", source_url: V };
    const misattributed = { text: "Alokasi 5%.", quote: "allocation of 5%", source_url: V };
    const r = postProcessAnalyst({ ...valid, points: [supported, misattributed] }, [
      { url: U, text: "allocation of 5%" },
      { url: V, text: "You earn points daily." },
    ]);
    expect(r.points).toEqual([supported]);
    expect(r.verdict).toBe("garap");
  });

  it("drops a point that cites a url which is not one of the sources", () => {
    const r = postProcessAnalyst({ ...valid, points: [{ ...valid.points[0]!, source_url: "https://evil.test/" }] }, [
      { url: U, text: "allocation of 5%" },
    ]);
    expect(r.points).toEqual([]);
    expect(r.verdict).toBe("pantau");
  });

  it("forces pantau and low confidence when every point of a skip verdict is dropped", () => {
    const r = postProcessAnalyst({ ...valid, verdict: "skip", confidence: "sedang" }, [{ url: U, text: "nothing here" }]);
    expect([r.verdict, r.confidence]).toEqual(["pantau", "rendah"]);
  });

  it("replaces em dashes in the Indonesian texts with a comma, never in quotes", () => {
    const r = postProcessAnalyst(
      {
        ...valid,
        points: [{ text: "Alokasi besar — tapi belum pasti", quote: "allocation — 5%", source_url: U }],
        effort: { ...E, note: "Modal kecil—cukup buat gas." },
        steps_id: [{ text: "Bridge ETH — sekali aja", cadence: "once" }],
      },
      [{ url: U, text: "Token allocation — 5% of supply" }],
    );
    expect(r.points).toEqual([{ text: "Alokasi besar, tapi belum pasti", quote: "allocation — 5%", source_url: U }]);
    expect(r.effort.note).toBe("Modal kecil, cukup buat gas.");
    expect(r.steps_id).toEqual([{ text: "Bridge ETH, sekali aja", cadence: "once" }]);
  });

  it("keeps a supported point that uses a forbidden word (facts beat style)", () => {
    const point = { text: "Ini krusial: alokasi 5%.", quote: "allocation of 5%", source_url: U };
    const r = postProcessAnalyst({ ...valid, points: [point] }, [{ url: U, text: "allocation of 5%" }]);
    expect(r.points).toEqual([point]);
  });

  it("keeps the effort estimate and the steps as answered", () => {
    const r = postProcessAnalyst(valid, [{ url: U, text: "allocation of 5%" }]);
    expect(r.effort).toEqual(E);
    expect(r.steps_id).toEqual([{ text: "Bridge ETH ke Ink", cadence: "once" }]);
  });
});

describe("forbiddenPhrases", () => {
  it("finds forbidden words and phrases of the style rules, ignoring case", () => {
    expect(forbiddenPhrases("Selain itu, ini langkah KRUSIAL dan seamless.")).toEqual(["krusial", "seamless", "selain itu"]);
  });

  it("finds the paired 'tak hanya … tetapi juga' construction", () => {
    expect(forbiddenPhrases("Tak hanya murah, tetapi juga cepat.")).toEqual(["tak hanya … tetapi juga"]);
    expect(forbiddenPhrases("Tak hanya murah.")).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(forbiddenPhrases("Garap testnet di Erathia, lalu bridge.")).toEqual([]);
    expect(forbiddenPhrases("Ini proyek di era DeFi.")).toEqual(["di era"]);
  });

  it("finds nothing in plain casual Indonesian", () => {
    expect(forbiddenPhrases("Bridge dulu, terus swap tiap hari. Gak ribet kok.")).toEqual([]);
  });
});

describe("stepTranslationGrounded", () => {
  const ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

  it.each([
    ["a plain translation", "Bridge ETH to Ink", "Bridge ETH ke Ink"],
    ["a number written with another decimal separator", "Bridge 0.01 ETH to Ink", "Bridge 0,01 ETH ke Ink"],
    ["a thousands separator", "Earn 1,000 points", "Kumpulkan 1.000 poin"],
    ["a host from the step, in another case", "Visit App.Ink.xyz and swap", "Buka app.ink.xyz lalu swap"],
    ["a handle from the step", "Follow @inkonchain on X", "Follow @inkonchain di X"],
    ["an address from the step", `Send 1 ETH to ${ADDRESS}`, `Kirim 1 ETH ke ${ADDRESS}`],
    ["a secret warning the step has", "Never share your seed phrase", "Jangan pernah kasih kunci privat atau seed phrase kamu"],
    ["a deposit the step asks for", "Deposit USDC into the vault", "Deposit USDC ke vault"],
    ["a sentence end right before a word", "Swap on InkySwap. Then hold", "Swap di InkySwap. Lalu hold"],
  ])("accepts %s", (_case, step, translation) => {
    expect(stepTranslationGrounded(step, translation)).toBe(true);
  });

  it.each([
    ["a host the step does not have", "Swap on InkySwap", "Swap di InkySwap, lalu connect wallet di claim-ink.io"],
    ["a URL the step does not have", "Swap on InkySwap", "Swap di https://inkyswap.com/app"],
    ["a 0x address the step does not have", "Join the waitlist", `Gabung waitlist, lalu isi gas ke ${ADDRESS}`],
    ["a base58 address the step does not have", "Join the waitlist", "Gabung waitlist lalu isi SOL ke 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"],
    ["a number the step does not have", "Swap on InkySwap daily", "Swap minimal 50 USDC di InkySwap tiap hari"],
    ["a handle the step does not have", "Join the Discord", "Join Discord lalu DM @ink_support_desk"],
    ["a secret request the step does not have", "Join the waitlist", "Gabung waitlist, lalu masukkan seed phrase kamu buat verifikasi"],
    ["a secret request in Indonesian", "Join the waitlist", "Gabung waitlist dan isi kunci privat wallet kamu"],
    ["a payment the step does not ask for", "Join the waitlist", "Gabung waitlist, lalu bayar biaya klaim ke admin"],
  ])("refuses %s", (_case, step, translation) => {
    expect(stepTranslationGrounded(step, translation)).toBe(false);
  });
});
