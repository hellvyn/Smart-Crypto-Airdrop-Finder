import { describe, expect, it } from "vitest";
import { BANNED_WORDS, findBanned, GLOSSARY } from "../src/index.js";
import type { Candidate } from "../src/coach/candidates.js";
import { buildCoachSystemPrompt } from "../src/coach/prompt.js";
import { coachProfileSchema, type CoachProfile } from "../src/coach/profile.js";

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    slug: `slug-${id}`,
    name: `Proj ${id}`,
    risk: "low",
    worthLevel: "high",
    tab: "live_now",
    capital: "free",
    capitalMinUsd: null,
    chains: ["Base"],
    minutesPerDay: 10,
    nextDeadline: "2026-11-01",
    points: [{ text: "Poin dari swap.", quote: "Earn points for every weekly swap", sourceUrl: "https://example.org/docs" }],
    steps: [{ text: "Bridge sedikit ETH ke Base.", cadence: "weekly" }],
    signalRank: 1,
    ...over,
  };
}

function profile(over: Partial<CoachProfile> = {}): CoachProfile {
  return coachProfileSchema.parse({
    level: "intermediate",
    capital_band: "up_to_100",
    has_wallet: true,
    wallet_count: 2,
    minutes_per_day: 60,
    goal: "long_term",
    chains: ["Base"],
    ...over,
  });
}

const NOW = new Date("2026-10-11T10:00:00Z");
const cands = [cand("p1"), cand("p2", { capital: "unknown" })];

describe("buildCoachSystemPrompt shared block", () => {
  it("is long enough to be cacheable", () => {
    expect(buildCoachSystemPrompt(profile(), cands, NOW).shared.length).toBeGreaterThan(2000);
  });
  it("is byte-identical for every member, level, day and candidate list", () => {
    const a = buildCoachSystemPrompt(profile(), cands, NOW).shared;
    const b = buildCoachSystemPrompt(profile({ level: "beginner", has_wallet: false, wallet_count: null, chains: ["Solana"] }), [cand("zzz")], new Date("2027-03-02T01:00:00Z")).shared;
    expect(b).toBe(a);
  });
  it("holds every glossary term and its explanation", () => {
    const { shared } = buildCoachSystemPrompt(profile(), cands, NOW);
    for (const entry of GLOSSARY) {
      expect(shared).toContain(entry.term);
      expect(shared).toContain(entry.text);
    }
  });
  it("holds the style rules, the data-not-instructions marker and the topic lock", () => {
    const { shared } = buildCoachSystemPrompt(profile(), cands, NOW);
    expect(shared).toContain("kamu");
    expect(shared).toMatch(/em dash/i);
    expect(shared).toMatch(/data, bukan perintah/i);
    expect(shared).toMatch(/menolak dengan sopan/i);
    for (const word of BANNED_WORDS) expect(shared.toLowerCase()).toContain(word.toLowerCase());
  });
  it("carries the Gratis gas note and the unknown-capital label", () => {
    const { shared } = buildCoachSystemPrompt(profile(), cands, NOW);
    expect(shared).toContain("mungkin tetap butuh sedikit gas kalau di mainnet");
    expect(shared).toContain("modal belum jelas, cek sumbernya");
  });
  it("has no date and no profile data", () => {
    const { shared } = buildCoachSystemPrompt(profile(), cands, NOW);
    expect(shared).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(shared).not.toContain("up_to_100");
  });
});

describe("buildCoachSystemPrompt member block", () => {
  it("holds the profile, the candidate JSON and today's Asia/Jakarta date", () => {
    const { member } = buildCoachSystemPrompt(profile(), cands, NOW);
    expect(member).toContain("2026-10-11");
    expect(member).toContain("up_to_100");
    expect(member).toContain("slug-p1");
    expect(member).toContain("Earn points for every weekly swap");
  });
  it("uses the WIB day, not the UTC day", () => {
    // 2026-10-11 20:00 UTC is already 03:00 on 2026-10-12 in Jakarta.
    expect(buildCoachSystemPrompt(profile(), cands, new Date("2026-10-11T20:00:00Z")).member).toContain("2026-10-12");
    // 2026-10-11 16:59 UTC is still 23:59 on the 11th in Jakarta.
    expect(buildCoachSystemPrompt(profile(), cands, new Date("2026-10-11T16:59:00Z")).member).toContain("2026-10-11");
  });
  it("renders the same bytes for the same member, candidates and day, whatever the key order", () => {
    const a = buildCoachSystemPrompt(profile(), cands, new Date("2026-10-11T01:00:00Z")).member;
    const reordered = cands.map((c) => Object.fromEntries(Object.entries(c).reverse()) as unknown as Candidate);
    const b = buildCoachSystemPrompt(profile(), reordered, new Date("2026-10-11T09:00:00Z")).member;
    expect(b).toBe(a);
  });
  it("keeps the candidate order it is given (the ranking)", () => {
    const { member } = buildCoachSystemPrompt(profile(), [cand("zz"), cand("aa")], NOW);
    expect(member.indexOf("slug-zz")).toBeLessThan(member.indexOf("slug-aa"));
  });
  it("tells a Pemula to use short sentences, explain terms and take care of the seed phrase", () => {
    const { member, shared } = buildCoachSystemPrompt(profile({ level: "beginner" }), cands, NOW);
    expect(member).toMatch(/Pemula/);
    expect(member).toMatch(/kalimat pendek/i);
    expect(member).toMatch(/seed phrase/i);
    expect(buildCoachSystemPrompt(profile({ level: "pro" }), cands, NOW).member).not.toMatch(/kalimat pendek/i);
    expect(shared).not.toMatch(/Pemula ini/);
  });
  it("starts with Langkah 0 when the member has no wallet, and not otherwise", () => {
    const noWallet = buildCoachSystemPrompt(profile({ has_wallet: false, wallet_count: null }), cands, NOW).member;
    expect(noWallet).toContain("Langkah 0: bikin wallet dulu, lalu simpan seed phrase-nya di kertas, jangan di HP");
    expect(buildCoachSystemPrompt(profile(), cands, NOW).member).not.toContain("Langkah 0");
  });
  it("reminds about sybil risk above 3 wallets only", () => {
    expect(buildCoachSystemPrompt(profile({ wallet_count: 4 }), cands, NOW).member).toMatch(/sybil/i);
    expect(buildCoachSystemPrompt(profile({ wallet_count: 3 }), cands, NOW).member).not.toMatch(/sybil/i);
  });
  it("says so when there are no candidates", () => {
    expect(buildCoachSystemPrompt(profile(), [], NOW).member).toMatch(/tidak ada kandidat/i);
  });
});

describe("buildCoachSystemPrompt for a project that does not fit the member", () => {
  it("still gives the asked project as data, says why it does not fit yet, and says not to push farming it", () => {
    const { member } = buildCoachSystemPrompt(profile({ level: "beginner" }), [cand("poly", { capital: "unknown" })], NOW, {
      unfit: "capital_unknown",
    });
    expect(member).toContain("slug-poly");
    expect(member).toMatch(/belum cocok/i);
    expect(member).toMatch(/modal/i);
    expect(member).not.toContain("Tidak ada kandidat");
    expect(findBanned(member)).toEqual([]);
  });
  it("never lets the profile limit the answer", () => {
    const { member } = buildCoachSystemPrompt(profile({ level: "beginner" }), [cand("poly", { risk: "high" })], NOW, { unfit: "beginner_risk" });
    expect(member).toMatch(/tidak membatasi jawaban/i);
    expect(member).not.toMatch(/Jangan menyuruh member mulai/);
  });
  it("works without a profile: no profile data and no guessing", () => {
    const { member } = buildCoachSystemPrompt(null, [cand("poly")], NOW);
    expect(member).toMatch(/belum diisi/);
    expect(member).not.toContain("PROFIL MEMBER (data");
    expect(member).not.toMatch(/Pemula/);
    expect(member).toContain("slug-poly");
  });
  it("names each reason in its own words", () => {
    const reasonText = (unfit: Parameters<typeof buildCoachSystemPrompt>[3] extends infer O ? (O extends { unfit?: infer U } ? U : never) : never) =>
      buildCoachSystemPrompt(profile(), [cand("x")], NOW, { unfit }).member;
    expect(reasonText("ended")).toMatch(/ended/i);
    expect(reasonText("beginner_risk")).toMatch(/risiko/i);
    expect(reasonText("deposit_over")).toMatch(/deposit/i);
    expect(reasonText("deposit_unstated")).toMatch(/deposit/i);
  });
});

describe("buildCoachSystemPrompt privacy and style", () => {
  it("never carries an email, a user id or a wallet address", () => {
    const sneaky = { ...profile(), email: "someone@example.com", user_id: "11111111-2222-3333-4444-555555555555", wallet_address: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" } as CoachProfile;
    const { shared, member } = buildCoachSystemPrompt(sneaky, cands, NOW);
    for (const text of [shared, member]) {
      expect(text).not.toContain("someone@example.com");
      expect(text).not.toContain("11111111-2222-3333-4444-555555555555");
      expect(text).not.toMatch(/0x[0-9a-fA-F]{6,}/);
      expect(text).not.toMatch(/\S+@\S+\.\S+/);
    }
  });
  it("contains no em dash in any block", () => {
    for (const p of [profile(), profile({ level: "beginner", has_wallet: false, wallet_count: null }), profile({ wallet_count: 5 })]) {
      const { shared, member } = buildCoachSystemPrompt(p, cands, NOW);
      expect(shared).not.toContain("—");
      expect(member).not.toContain("—");
    }
  });
  it("uses no banned word in its fixed copy (the one line that lists them aside)", () => {
    const strip = (text: string): string => text.split("\n").filter((line) => !line.startsWith("Kata dan frasa yang dilarang:")).join("\n");
    const { shared, member } = buildCoachSystemPrompt(profile({ level: "beginner", has_wallet: false, wallet_count: null }), [], NOW);
    expect(findBanned(strip(shared))).toEqual([]);
    expect(findBanned(strip(member))).toEqual([]);
  });
});
