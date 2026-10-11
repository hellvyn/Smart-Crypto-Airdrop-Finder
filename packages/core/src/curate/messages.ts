// All Indonesian reason copy of `curate()` and `worth()` lives here, so a later copy rewrite touches one file.

export const CURATE_MESSAGES = {
  status_not_open: "Airdrop ini belum atau tidak lagi dibuka.",
  status_not_open_ended: "Airdrop ini sudah berakhir dan belum pernah lolos kurasi sebelum berakhir.",
  risk_too_high: "Tingkat risikonya terlalu tinggi, atau belum dinilai.",
  no_legit_signal: "Belum ada sinyal yang menunjukkan project ini sah (VC terverifikasi, TVL, CoinGecko, atau sumber kurasi).",
  lookalike: "Namanya mirip dengan project lain yang sudah ada.",
  insufficient_checks: "Cek keamanan utama belum lengkap atau project belum punya domain resmi.",
  scam_pattern: "Teksnya memuat pola scam yang kuat (minta data rahasia, minta bayaran, menyamar, atau dukungan palsu).",
  passed: "Lolos semua syarat kurasi.",
  ended_after_curation: "Airdrop ini sudah berakhir, tapi pernah lolos kurasi saat masih dibuka.",
} as const;

export const WORTH_MESSAGES = {
  vc_backer_tier1: "Didukung VC tier 1 yang terverifikasi.",
  vc_backer: "Didukung VC yang terverifikasi.",
  reported_backer: "Ada laporan pendanaan sebesar $5 juta atau lebih (belum terverifikasi).",
  tvl_very_high: "TVL di atas $100 juta.",
  tvl_high: "TVL di atas $10 juta.",
  no_token_yet: "Belum ada token yang diperdagangkan.",
  multiple_sources: "Muncul di lebih dari satu sumber independen.",
  capital_high: "Butuh modal besar.",
  capital_low: "Butuh modal kecil.",
  capital_unknown: "Kebutuhan modal belum diketahui.",
  many_tasks: "Tugasnya banyak (lebih dari 8).",
  ai_pantau: "Analisis AI menyarankan dipantau dulu.",
  ai_skip: "Analisis AI menyarankan dilewati.",
} as const;
