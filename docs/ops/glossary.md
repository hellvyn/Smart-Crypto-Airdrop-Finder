# UI glossary

Fixed Indonesian UI wording. `apps/web/test/copy-style.test.ts` reads this table, so keep the markers below.

- **Glosarium (dipakai persis, juga di test):**
  | Konsep | Teks |
  |---|---|
  | tab `live_now` / `early_bets` / `ended` | "Live sekarang" / "Early" / "Ended" |
  | tanggal selesai (tab `ended`) | "Ended {tanggal}" |
  | worth `high`/`medium`/`low`/`insufficient_data` | "Sangat worth it" / "Worth it" / "Kurang worth it" / "Data belum cukup" |
  | label worth | "Worth it" (filter: "Worth it: semua") |
  | risiko `low`/`medium`/`high`/`critical`/`insufficient_data` | "Rendah" / "Sedang" / "Tinggi" / "Kritis" / "Data belum cukup" (di kepala: "Risiko rendah") |
  | status `live`/`announced`/`speculative`/`ended`/`unknown` | "Live" / "Diumumkan" / "Spekulatif" / "Ended" / "Belum pasti" |
  | verdict `garap`/`pantau`/`skip` | "Garap" / "Pantau" / "Skip"; keyakinan: "Confidence: tinggi/sedang/rendah" |
  | label sumber | "Verified", "Klaim project, belum verified", "Analisis AI" |
  | ringkasan list | judul "Update hari ini" + "{N} dicek" / "{M} lolos" |
  | cakupan cek | cap "LOLOS 4/4 CEK"; teks "{k}/4 security check jalan" |
  | peringatan gak lolos | "Gak masuk list: {alasan}" |
  | status kedaluwarsa | "Ended (deadline lewat)" |
  | cadence `daily`/`weekly`/`once` | "Daily" / "Weekly" / "Sekali" |
  | bagian khusus member (#46) | "Member only" (tanpa tombol/link daftar) |
  | waktu cek (#44) | "Dicek hari ini" / "Dicek kemarin" / "Dicek {n} hari lalu"; > 48 jam: "Belum dicek lagi sejak {tanggal}"; dibekukan: "Last check {tanggal}" |
  | status link (#42) `official`/`different_domain`/`phishing`/`unchecked` | "✓ Official domain" / "⚠ Beda domain dari web official" / "Link di-hide: kedeteksi phishing" / "Belum dicek" |
  | badge klaim (#42) | "Claim open · link dicek" |
  | backer laporan (#41) | "Menurut AlphaDrops: {investor} (lead), …" |
  | rekam jejak (#43) | judul "Track record kami"; tiga cap: "{listed}" "Token listing", "{noToken}" "Ended tanpa token", "{riskRaised}" "Belakangan jadi risky"; catatan "Dari {total} airdrop yang lolos sebelum token listing dan sekarang udah ended atau belakangan jadi risky." |
  | urutan | pengunjung "Baru dicek"; member "Paling worth it"; tab `ended` "Baru ended" |
  | bagian halaman project | "01 · AI verdict", "02 · Sumber yang beda cerita", "03 · Step garap", "04 · Security check", "05 · Estimasi effort", "06 · Kenapa lolos"; samping "Ringkasan", "Update terbaru" |
  | navigasi & akun | "Airdrop", "Kenapa AirdropIQ", "Track record", "Garapan saya", "Watchlist", "Login", "← Balik ke list" |
  | footer | "Not financial advice. Tetap DYOR sebelum connect wallet." |
  | sub-filter modal (#52) | label "Modal:"; pilihan "Semua" / "Gratis" / "Butuh $" (+ " · {n}"); tag baris "Gratis" / "Butuh ${x}+" / "Butuh $" / "Modal belum jelas" |
  | security check (#53) | badge "Re-check tiap pagi · terakhir {jam} WIB"; strip "Lapis cek" / "Source dibaca" / "Link dicek" / "Red flag"; badge "Wajib lolos" + "Satu aja gagal jalan, project ini gak bakal tampil. Bukan dianggap lolos."; kartu "Cek 01"…"Cek 04": "Minta seed phrase / bayar dulu", "Domain tiruan", "Umur domain", "Database phishing"; judul "Advanced check": "Riwayat hack", "Cross-check antar source", "AI baca halaman claim"; sumber "Scanner AirdropIQ", "Database AirdropIQ", "RDAP registry", "GoPlus Security", "DefiLlama Hacks", "Analisis AI" |
  | advanced check pengunjung (#54) | cap "Member only" (tanpa kalimat penjelasan) |
  | hasil garapan (#51) | "Dapet berapa dari airdrop ini?", "Gak dapet", "Hasil kamu", "Total hasil garapan", "Boleh dipakai anonim buat rata-rata hasil member", "Rata-rata member yang garap {project}: ≈ ${x} (dari {n} member yang mau berbagi)" |
  Sumber kebenaran teks: mockup `docs/design/airdropiq-c/*.dc.html` (spec §16). Kalau glosarium dan mockup beda,
