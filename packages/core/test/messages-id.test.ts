// Exact Indonesian reason copy (Plan 6 glossary). Codes never change; these messages are shown to visitors and
// members, so each branch pins its full text. Every expectation is a hand-written literal, produced here by the
// real assessRisk / detectDangerousAsks / curate / worth, never read from the message constants.
import { describe, expect, it } from "vitest";
import { assessRisk, curate, detectDangerousAsks, worth } from "../src/index.js";
import type { CheckId, CurateInput, NewSignal, RiskCheck, RiskInput, WorthInput } from "../src/index.js";

function riskInput(over: Partial<RiskInput> = {}): RiskInput {
  return {
    project: {
      name: "Uniswap",
      officialDomains: ["uniswap.org"],
      status: "live",
      tokenSymbol: "UNI",
      conflict: false,
      sourceCount: 3,
      hasOfficialSocial: true,
      lookalikeOf: null,
      lookalikeOfName: null,
      lookalikeOfDomains: [],
    },
    tasks: ["Swap on the app"],
    sourceAsks: [],
    linkDomains: [{ domain: "app.uniswap.org", kind: "app" }],
    domainAgeDays: { "app.uniswap.org": 2000 },
    phishingFlags: { "app.uniswap.org": false },
    token: { honeypot: false, ownerCanMintOrChangeBalance: false, maliciousCreator: false },
    contractVerified: true,
    hackCount: 0,
    ...over,
  };
}

const messageOf = (a: ReturnType<typeof assessRisk>, code: string) => a.reasons.filter((r) => r.code === code).map((r) => r.message);
const flag = (pattern: string) => ({ pattern, quote: "q" });

describe("risk reason copy (Indonesian)", () => {
  it("single_source", () => {
    const base = riskInput();
    const a = assessRisk(riskInput({ project: { ...base.project, sourceCount: 1, hasOfficialSocial: false } }));
    expect(messageOf(a, "single_source")).toEqual([
      "Baru 1 sumber yang menyebut project ini dan belum ada akun sosial resmi yang ditemukan.",
    ]);
  });

  it("speculative", () => {
    const base = riskInput();
    const a = assessRisk(riskInput({ project: { ...base.project, status: "speculative" } }));
    expect(messageOf(a, "speculative")).toEqual(["Belum ada pengumuman airdrop; ini spekulasi berdasarkan sinyal onchain."]);
  });

  it("hack_history interpolates the count", () => {
    expect(messageOf(assessRisk(riskInput({ hackCount: 1 })), "hack_history")).toEqual(["Project ini punya 1 catatan hack."]);
    expect(messageOf(assessRisk(riskInput({ hackCount: 3 })), "hack_history")).toEqual(["Project ini punya 3 catatan hack."]);
  });

  it("conflicting_evidence", () => {
    const base = riskInput();
    const a = assessRisk(riskInput({ project: { ...base.project, conflict: true } }));
    expect(messageOf(a, "conflicting_evidence")).toEqual(["Sumber-sumber saling beda soal fakta penting project ini."]);
  });

  it("phishing_listed names the domain once per registrable domain", () => {
    const a = assessRisk(riskInput({ phishingFlags: { "app.uniswap.org": true } }));
    expect(messageOf(a, "phishing_listed")).toEqual(["app.uniswap.org masuk daftar situs phishing."]);
  });

  it("token_honeypot", () => {
    const a = assessRisk(riskInput({ token: { honeypot: true, ownerCanMintOrChangeBalance: false, maliciousCreator: false } }));
    expect(messageOf(a, "token_honeypot")).toEqual(["Token ini kelihatan seperti honeypot: bisa dibeli tapi gak bisa dijual."]);
  });

  it("token_owner_powers and malicious_creator", () => {
    const a = assessRisk(riskInput({ token: { honeypot: false, ownerCanMintOrChangeBalance: true, maliciousCreator: true } }));
    expect(messageOf(a, "token_owner_powers")).toEqual(["Pemilik token bisa mencetak token baru atau mengubah saldo."]);
    expect(messageOf(a, "malicious_creator")).toEqual(["Pembuat kontrak token ini ditandai berbahaya."]);
  });

  it("unverified_contract", () => {
    expect(messageOf(assessRisk(riskInput({ contractVerified: false })), "unverified_contract")).toEqual([
      "Source code kontrak token belum diverifikasi.",
    ]);
  });

  it("young_domain and new_claim_domain interpolate the domain and the age in days", () => {
    const a = assessRisk(
      riskInput({
        linkDomains: [
          { domain: "app.uniswap.org", kind: "app" },
          { domain: "claim-x.xyz", kind: "claim" },
        ],
        domainAgeDays: { "app.uniswap.org": 2000, "claim-x.xyz": 5 },
        phishingFlags: { "app.uniswap.org": false, "claim-x.xyz": false },
      }),
    );
    expect(messageOf(a, "new_claim_domain")).toEqual(["Link claim claim-x.xyz bukan domain resmi dan baru didaftarkan 5 hari lalu."]);
    expect(messageOf(a, "young_domain")).toEqual(["claim-x.xyz baru didaftarkan 5 hari lalu."]);
  });

  it("lookalike_domain for a link domain and for a shared project name", () => {
    const link = assessRisk(
      riskInput({
        linkDomains: [{ domain: "uniswap-claim.xyz", kind: "claim" }],
        domainAgeDays: { "uniswap-claim.xyz": 2000 },
        phishingFlags: { "uniswap-claim.xyz": false },
      }),
    );
    expect(messageOf(link, "lookalike_domain")).toEqual(['uniswap-claim.xyz mirip nama "Uniswap" tapi bukan domain resmi.']);

    const base = riskInput();
    const named = assessRisk(
      riskInput({ project: { ...base.project, lookalikeOf: "id-1", lookalikeOfName: "DeepBook", lookalikeOfDomains: ["deepbook.tech"] } }),
    );
    expect(messageOf(named, "lookalike_domain")).toEqual(['Nama project ini sama dengan "DeepBook" (deepbook.tech) tapi domainnya beda.']);

    const anonymous = assessRisk(riskInput({ project: { ...base.project, lookalikeOf: "id-1" } }));
    expect(messageOf(anonymous, "lookalike_domain")).toEqual(["Nama project ini sama dengan project lain tapi domainnya beda."]);
  });

  it("phishing_claim_link counts the links and names none", () => {
    const one = assessRisk(riskInput({ claimLinks: [{ url: "https://x-claim.io/a", status: "phishing" }] }));
    expect(messageOf(one, "phishing_claim_link")).toEqual(["1 link claim project ini kedeteksi phishing dan di-hide."]);
    const two = assessRisk(
      riskInput({
        claimLinks: [
          { url: "https://x-claim.io/a", status: "phishing" },
          { url: "https://y-claim.io/b", status: "phishing" },
        ],
      }),
    );
    expect(messageOf(two, "phishing_claim_link")).toEqual(["2 link claim project ini kedeteksi phishing dan di-hide."]);
  });

  it("source-text asks keep the quoted sentence", () => {
    const a = assessRisk(
      riskInput({
        sourceAsks: [
          { code: "asks_secret", quote: "Enter your seed phrase to claim." },
          { code: "asks_payment", quote: "Send 0.1 ETH to receive your airdrop." },
        ],
      }),
    );
    expect(messageOf(a, "asks_secret")).toEqual(['Teks sumber minta seed phrase atau private key: "Enter your seed phrase to claim."']);
    expect(messageOf(a, "asks_payment")).toEqual([
      'Teks sumber minta kamu kirim crypto supaya bisa claim: "Send 0.1 ETH to receive your airdrop."',
    ]);
  });

  it.each([
    ["urgency", "Analisis AI: teks sumber menekan pembaca supaya buru-buru."],
    ["connect_wallet_to_check", "Analisis AI: teks sumber menyuruh pembaca connect wallet cuma buat ngecek eligibility."],
    ["fake_support", "Analisis AI: teks sumber mengarahkan pembaca ke support atau admin yang gak resmi."],
    ["secret_request", "Analisis AI: teks sumber minta seed phrase atau private key."],
    ["payment_request", "Analisis AI: teks sumber minta pembaca kirim crypto atau bayar supaya bisa claim."],
    ["impersonation", "Analisis AI: teks sumber menyamar jadi project lain atau timnya."],
    ["other", "Analisis AI: teks sumber memakai pola social engineering lain."],
    ["not_a_known_pattern", "Analisis AI: teks sumber memakai pola social engineering lain."],
  ])("ai_scam_pattern %s", (pattern, expected) => {
    const a = assessRisk(riskInput({ aiFlags: { scam: [flag(pattern)], contradictions: 0 } }));
    expect(messageOf(a, "ai_scam_pattern")).toEqual([expected]);
  });

  it("ai_contradiction interpolates the count", () => {
    const a = assessRisk(riskInput({ aiFlags: { scam: [], contradictions: 3 } }));
    expect(messageOf(a, "ai_contradiction")).toEqual(["Analisis AI menemukan 3 kontradiksi antar sumber atau di dalam satu sumber."]);
  });
});

describe("dangerous ask copy (Indonesian)", () => {
  it("asks_secret keeps the task snippet", () => {
    expect(detectDangerousAsks(["Enter your seed phrase to verify"]).map((r) => r.message)).toEqual([
      'Ada task yang minta seed phrase atau private key: "Enter your seed phrase to verify"',
    ]);
  });

  it("asks_payment keeps the task snippet", () => {
    expect(detectDangerousAsks(["Send 0.1 ETH to receive your airdrop"]).map((r) => r.message)).toEqual([
      'Ada task yang minta kamu kirim crypto supaya bisa claim: "Send 0.1 ETH to receive your airdrop"',
    ]);
  });

  it("cuts a long snippet at 80 characters", () => {
    const task = `Enter your seed phrase ${"x".repeat(100)}`;
    const [reason] = detectDangerousAsks([task]);
    expect(reason?.message).toBe(`Ada task yang minta seed phrase atau private key: "${task.slice(0, 77)}..."`);
  });
});

const ALL_CHECKS: CheckId[] = ["dangerous_asks", "phishing_list", "domain_age", "lookalike", "token_security", "contract_verified", "hack_history", "corroboration"];
const checksWithout = (...skipped: CheckId[]): RiskCheck[] => ALL_CHECKS.map((id) => ({ id, ran: !skipped.includes(id) }));
const tvl = (tvl_usd: number): NewSignal => ({ kind: "tvl", value: { tvl_usd }, source: "defillama", verified: true });
const passing: CurateInput = {
  status: "live",
  riskLevel: "low",
  checks: checksWithout(),
  lookalikeOf: null,
  hasOfficialDomain: true,
  signals: [tvl(25_000_000)],
  passedBeforeEnd: false,
  aiScamPatterns: [],
};
const failMessages = (r: ReturnType<typeof curate>) => r.reasons.map((x) => [x.code, x.message]);

describe("curation reason copy (Indonesian)", () => {
  it("passed and ended_after_curation", () => {
    expect(failMessages(curate(passing))).toEqual([["passed", "Lolos semua syarat kurasi."]]);
    expect(failMessages(curate({ ...passing, status: "ended", passedBeforeEnd: true }))).toEqual([
      ["ended_after_curation", "Airdrop ini udah ended, tapi pernah lolos kurasi waktu masih dibuka."],
    ]);
  });

  it("status_not_open, for a closed project and for an ended one that never passed", () => {
    expect(failMessages(curate({ ...passing, status: "unknown" }))).toEqual([
      ["status_not_open", "Airdrop ini belum dibuka atau udah gak dibuka lagi."],
    ]);
    expect(failMessages(curate({ ...passing, status: "ended" }))).toEqual([
      ["status_not_open", "Airdrop ini udah ended dan belum pernah lolos kurasi sebelum berakhir."],
    ]);
  });

  it("risk_too_high, no_legit_signal, lookalike and scam_pattern", () => {
    expect(failMessages(curate({ ...passing, riskLevel: "high" }))).toEqual([["risk_too_high", "Risikonya terlalu tinggi, atau belum dinilai."]]);
    expect(failMessages(curate({ ...passing, signals: [] }))).toEqual([
      ["no_legit_signal", "Belum ada sinyal bahwa project ini legit (VC verified, TVL $10 juta atau lebih, listing CoinGecko, atau sumber kurasi)."],
    ]);
    expect(failMessages(curate({ ...passing, lookalikeOf: "other-id" }))).toEqual([
      ["lookalike", "Namanya mirip project lain yang udah ada."],
    ]);
    expect(failMessages(curate({ ...passing, aiScamPatterns: ["payment_request"] }))).toEqual([
      ["scam_pattern", "Teksnya punya pola scam yang kuat (minta data rahasia atau bayaran, menyamar, atau pakai dukungan palsu)."],
    ]);
  });

  it("insufficient_checks lists the key checks that did not run", () => {
    expect(failMessages(curate({ ...passing, checks: checksWithout("domain_age") }))).toEqual([
      ["insufficient_checks", "Cek keamanan kunci belum lengkap: umur domain."],
    ]);
    expect(failMessages(curate({ ...passing, checks: checksWithout("phishing_list", "lookalike") }))).toEqual([
      ["insufficient_checks", "Cek keamanan kunci belum lengkap: domain tiruan, database phishing."],
    ]);
    expect(failMessages(curate({ ...passing, checks: [] }))).toEqual([
      [
        "insufficient_checks",
        "Cek keamanan kunci belum lengkap: minta seed phrase / bayar dulu, domain tiruan, umur domain, database phishing.",
      ],
    ]);
  });

  it("insufficient_checks names the missing official domain, first, and still lists checks that did not run", () => {
    expect(failMessages(curate({ ...passing, hasOfficialDomain: false }))).toEqual([
      ["insufficient_checks", "Cek keamanan kunci belum lengkap: domain resmi (belum ada)."],
    ]);
    expect(failMessages(curate({ ...passing, hasOfficialDomain: false, checks: checksWithout("lookalike", "domain_age") }))).toEqual([
      ["insufficient_checks", "Cek keamanan kunci belum lengkap: domain resmi (belum ada), domain tiruan, umur domain."],
    ]);
  });
});

const baseWorth: WorthInput = {
  signals: [{ kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: false }],
  tgePassed: true,
  sourceCount: 1,
  capitalRequired: "none",
  taskCount: 3,
  aiVerdict: null,
};
const w = (over: Partial<WorthInput>) => worth({ ...baseWorth, ...over });
const worthMessages = (r: ReturnType<typeof worth>) => r.reasons.map((x) => [x.code, x.message]);
const vc = (tier: number): NewSignal => ({ kind: "vc_backer", value: { investor: "Fund", tier }, source: "vc_portfolio", verified: true });

describe("worth reason copy (Indonesian)", () => {
  it("backer reasons", () => {
    expect(worthMessages(w({ signals: [vc(1)] }))).toEqual([["vc_backer", "Didukung VC tier 1 yang verified."]]);
    expect(worthMessages(w({ signals: [vc(2)] }))).toEqual([["vc_backer", "Didukung VC yang verified."]]);
    expect(
      worthMessages(
        w({ signals: [{ kind: "reported_backer", value: { investor: "Fund", lead: true, amount_usd: 5_000_000 }, source: "alphadrops", verified: false }] }),
      ),
    ).toEqual([["reported_backer", "Ada laporan pendanaan $5 juta atau lebih (belum verified)."]]);
  });

  it("TVL copy says 'atau lebih' because the thresholds are inclusive", () => {
    expect(worthMessages(w({ signals: [tvl(100_000_000)] }))).toEqual([["tvl_very_high", "TVL $100 juta atau lebih."]]);
    expect(worthMessages(w({ signals: [tvl(10_000_000)] }))).toEqual([["tvl_high", "TVL $10 juta atau lebih."]]);
  });

  it("no_token_yet, multiple_sources and many_tasks", () => {
    expect(worthMessages(w({ tgePassed: false }))).toEqual([["no_token_yet", "Belum ada token yang diperdagangkan."]]);
    expect(worthMessages(w({ sourceCount: 2 }))).toEqual([["multiple_sources", "Muncul di lebih dari satu source independen."]]);
    expect(worthMessages(w({ taskCount: 9 }))).toEqual([["many_tasks", "Step-nya banyak (lebih dari 8)."]]);
  });

  it("capital reasons", () => {
    expect(worthMessages(w({ capitalRequired: "high" }))).toEqual([["capital_high", "Butuh modal besar."]]);
    expect(worthMessages(w({ capitalRequired: "low" }))).toEqual([["capital_low", "Butuh modal kecil."]]);
    expect(worthMessages(w({ capitalRequired: "unknown" }))).toEqual([["capital_unknown", "Kebutuhan modal belum jelas."]]);
  });

  it("AI verdict reasons", () => {
    expect(worthMessages(w({ aiVerdict: "pantau" }))).toEqual([["ai_pantau", "Analisis AI menyarankan pantau dulu."]]);
    expect(worthMessages(w({ aiVerdict: "skip" }))).toEqual([["ai_skip", "Analisis AI menyarankan skip."]]);
  });
});
