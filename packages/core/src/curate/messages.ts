// All Indonesian reason copy of `curate()` and `worth()` lives here, so a later copy rewrite touches one file.
// Casual-polite "kamu" tone per the Plan 6 glossary. The web prefixes a failed reason with "Gak masuk list: ".
import type { CheckId } from "../risk/assess.js";

export const CURATE_MESSAGES = {
  status_not_open: "Airdrop ini belum dibuka atau udah gak dibuka lagi.",
  status_not_open_ended: "Airdrop ini udah ended dan belum pernah lolos kurasi sebelum berakhir.",
  risk_too_high: "Risikonya terlalu tinggi, atau belum dinilai.",
  no_legit_signal:
    "Belum ada sinyal bahwa project ini legit (VC verified, TVL $10 juta atau lebih, listing CoinGecko, atau sumber kurasi).",
  lookalike: "Namanya mirip project lain yang udah ada.",
  scam_pattern: "Teksnya punya pola scam yang kuat (minta data rahasia atau bayaran, menyamar, atau pakai dukungan palsu).",
  passed: "Lolos semua syarat kurasi.",
  ended_after_curation: "Airdrop ini udah ended, tapi pernah lolos kurasi waktu masih dibuka.",
} as const;

/** The four key security checks as the visitor knows them (glossary "Cek 01" to "Cek 04"), in the lowercase used mid-sentence. */
export const KEY_CHECK_LABELS = {
  dangerous_asks: "minta seed phrase / bayar dulu",
  lookalike: "domain tiruan",
  domain_age: "umur domain",
  phishing_list: "database phishing",
} as const satisfies Partial<Record<CheckId, string>>;

/** Listed first when the project has no official domain, since the lookalike and domain age checks depend on it. */
export const NO_OFFICIAL_DOMAIN_LABEL = "domain resmi (belum ada)";

/** `insufficient_checks`: `missing` is what stopped the key checks, as labels (never empty). */
export const insufficientChecksMessage = (missing: readonly string[]): string =>
  `Cek keamanan kunci belum lengkap: ${missing.join(", ")}.`;

export const WORTH_MESSAGES = {
  vc_backer_tier1: "Didukung VC tier 1 yang verified.",
  vc_backer: "Didukung VC yang verified.",
  reported_backer: "Ada laporan pendanaan $5 juta atau lebih (belum verified).",
  tvl_very_high: "TVL $100 juta atau lebih.",
  tvl_high: "TVL $10 juta atau lebih.",
  no_token_yet: "Belum ada token yang diperdagangkan.",
  multiple_sources: "Muncul di lebih dari satu source independen.",
  capital_high: "Butuh modal besar.",
  capital_low: "Butuh modal kecil.",
  capital_unknown: "Kebutuhan modal belum jelas.",
  many_tasks: "Step-nya banyak (lebih dari 8).",
  ai_pantau: "Analisis AI menyarankan pantau dulu.",
  ai_skip: "Analisis AI menyarankan skip.",
} as const;
