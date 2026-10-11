# Head-to-head: Smart Airdrop Finder vs AlphaDrops

Tanggal: 2026-10-10. Data diambil langsung dari alphadrops.net hari ini (HTML, `llms.txt`, `llms-full.txt`,
`robots.txt`, `sitemap.xml`, halaman yang dirender di Chromium) dan dari database produksi kita (96 project).

Label: **[FACT]** dari data, **[INFERENCE]** kesimpulan dari bukti, **[UNKNOWN]** belum bisa dipastikan.

## 1. Apa itu AlphaDrops

| Area | Isi | Label |
|---|---|---|
| Airdrop | 169 entri: active 61, upcoming 2, claimable 8, ended 74, inactive 24 | FACT |
| Halaman project | Deskripsi, funding, chain, task (mis. "Join the waitlist", "Follow on X", "Join Discord"), "Deep dive strategy" + backer, vote sentimen (bearish/neutral/bullish) | FACT |
| Fundraising | 881 project (`/raises`); detail per ronde: tanggal, jenis ronde, valuasi, lead + investor lain, link pengumuman, label "Synced" | FACT |
| Tracker | Butuh login: "saved projects, farming stages, and tasks", task kustom, bookmark, kalender aktivitas | FACT |
| Claims | 8 klaim terbuka, 197 riwayat, cek wallet | FACT |
| Checkers | Riwayat airdrop (claimed/unclaimed), Base Score, Polymarket, xStocks, Arcus season rank, kalkulator poin perp (8 protokol), kalkulator APY | FACT |
| Perps hub | 32 airdrop perp, tabel, compare, kalkulator | FACT |
| Kalender | 1 entri (Pharos, 25 Okt) | FACT |
| Komunitas | Discord. Klaim sendiri gak konsisten: "80K+" (home) vs "13k+" (halaman project); listing Discord publik ±13.559 member | FACT (angka), INFERENCE ("80K+" kemungkinan gabungan kanal atau gak akurat) |
| Monetisasi | Premium $5/bulan, $13/3 bulan, $50/tahun (bayar kripto via Boomfi, non-refundable); NFT "Alpha Pass" = premium seumur hidup; Google AdSense; slot sponsor ("Taba"); popup promo | FACT |
| Isi Premium | Airdrop premium-only (1 dari 169), tracking tanpa batas, role Discord, giveaway, early alpha | FACT |
| SEO/AI | `sitemap.xml` ±1.450 URL (882 raises, 299 checker, 256 airdrop), `llms.txt`/`llms-full.txt` (diperbarui per jam), `ai.txt` | FACT |
| Bahasa | Inggris saja | FACT |

## 2. Kelemahan AlphaDrops (bukti)

1. **Gak ada lapisan keamanan per project.** Halaman project gak menyebut risiko, phishing, umur domain, atau audit.
   Klaim "Our team manually verifies every project" gak disertai bukti apa pun di halaman. [FACT]
2. **Konflik kepentingan.** 43 dari 169 link website (25%) adalah link referral mereka (`?r=`, `/ref/ALPHADROPS`);
   ditambah AdSense dan slot sponsor. Syarat layanan gak menyebut afiliasi. [FACT] Pengguna gak bisa tahu apakah
   urutan dipengaruhi referral. [INFERENCE]
3. **Status basi.** 42 dari 63 entri active/upcoming ditambahkan sebelum April 2026, ±30 di antaranya pada satu hari
   (2025-12-14, impor massal). Ada "active" seperti Optimism, Base, Metamask, Phantom. Gak ada tanggal "terakhir dicek"
   per project. [FACT] Status kemungkinan gak dirawat rutin. [INFERENCE]
4. **Gak ada penilaian layak/effort.** `estimatedValue` kosong di 103 entri, "TBA" di 65. Gak ada estimasi modal atau
   menit per hari. [FACT]
5. **Task generik.** Contoh Catalyst: waitlist, follow X, join Discord. [FACT]
6. **Data kotor.** `fundingAmount` teks bebas ("$$30M", "NA", "Undisclosed", "Hidden", "$$88.2"); website Axis
   Robotics mengarah ke `s.kaito.ai`, bukan domain project. [FACT]
7. **Kalender dan klaim tipis.** Kalender 1 entri; klaim terbuka 8. [FACT]
8. **Inggris saja**, gak ada analisis AI, gak ada penjelasan kenapa sebuah project masuk list. [FACT]

## 3. Kekuatan AlphaDrops yang belum kita punya

1. **Database fundraising** (881 project, ronde + valuasi + investor). Ini persis hook "di-back siapa". [FACT]
2. **Seleksi project lebih tepat sasaran** daripada sumber kita sekarang: fokus tokenless yang didanai VC (perp DEX, AI,
   L1). Irisan dengan database kita cuma 11 dari 63 airdrop aktif mereka (5 cocok domain, 6 cocok nama saja); **52
   project aktif mereka gak ada di data kita** (mis. Catalyst $30M/Sequoia, Bulk, N1, Phoenix $44M, Fomo, Perpl, QFEX
   versi domain). [FACT] Sebaliknya 28 project live/announced kita banyak yang berasal dari airdrops.io dengan kualitas
   rendah (banyak tanpa domain resmi). [FACT]
3. **Checker wallet dan kalkulator** (Polymarket, Base, perp points). [FACT]
4. **Komunitas Discord** dan harga murah ($5/bulan). [FACT]
5. **Mesin SEO** (±1.450 halaman) yang mendatangkan trafik gratis. [FACT halaman] Trafik aktual [UNKNOWN].

## 4. Di mana kita menang (dan harus kelihatan menang)

| Dimensi | AlphaDrops | Kita (spec rev. 3 + #40) |
|---|---|---|
| Keamanan per project | Gak ada | 4 cek kunci (dangerous asks, lookalike, umur domain, phishing list) + AI Scam Analyst, wajib lolos untuk tampil |
| Bukti | Gak ada kutipan | Tiap klaim punya kutipan sumber; label terverifikasi vs diklaim |
| Keputusan | Gak ada | AI Analyst Garap/Pantau/Lewati + tesis + modal & menit/hari; level Kelayakan |
| Kesegaran | Gak ada tanggal cek | Dicek harian, auto-expire, timeline perubahan, "Perubahan sejak kunjungan terakhir" |
| Link | 25% referral + iklan | Link dibersihkan dari referral, tanpa iklan |
| Bahasa | Inggris | Indonesia penuh + AI Coach |
| Arsip | Ended dicampur, tanpa rekam jejak | Tab "Sudah berakhir" (#40) |

## 5. Rekomendasi (urut dampak)

1. **Tutup celah coverage dulu** (tanpa ini kita kalah di isi): AlphaDrops jadi sumber kandidat kedua (listing +
   fundraising) dan DefiLlama v2. Semua tetap lewat kurasi + cek domain; referral dibuang; label "menurut AlphaDrops"
   untuk backer sampai terverifikasi.
2. **"Cek link klaim"**: setiap link klaim/portal dicek domainnya (cocok domain resmi, umur domain, daftar phishing)
   sebelum ditampilkan. AlphaDrops menampilkan klaim tanpa cek; masa klaim adalah waktu paling rawan.
3. **Rekam jejak publik**: dari tab "Sudah berakhir", hitung berapa pilihan kita yang benar-benar TGE/klaim. Ini bukti
   yang gak bisa ditiru kompetitor tanpa data historis. Jadi materi landing page.
4. **"Terakhir dicek: hari ini"** di tiap baris dan halaman, sebagai pembeda langsung dari status basi mereka.
5. **Lewati dulu**: checker per protokol, kalkulator, perps hub, NFT pass. Effort besar, bukan inti positioning.

## 6. UI/UX AlphaDrops (screenshot owner, 2026-10-10)

[FACT dari screenshot]:
- Tema gelap, sidebar kiri (Airdrops, Perps, Tracker, Claims, Checkers, Raises), aksen oranye, tombol "Join Now".
- **Iklan di ruang paling mahal:** dua banner di atas judul tiap halaman + kolom kanan berisi iklan "Taba" dan tiga
  checker. Konten utama cuma ±50% lebar layar desktop.
- **Grid kartu Perps rusak:** nama project terpotong jadi 2–3 huruf ("Ca", "Txl", "Po", "Ar"), baris "Funding" dan
  chain bertumpuk/terpotong.
- **Claims:** tombol oranye besar "Claim ↗" di tiap kartu tanpa info apa pun soal keaslian link; satu baris peringatan
  umum "Use official claim portals only".
- **Raises:** tabel rapi (project, funding + jenis ronde, investor, tanggal), "7,314 raises", filter kategori/ronde/tahun.
- **Home:** hero carousel kartu pastel, angka "40 Active · 81 Ended · 4 Claimable · 34K+ Community", blok NFT Alpha
  Pass, "More than a list", FAQ generik.
- **List airdrop:** ±169 kartu seragam tanpa hierarki (gak ada yang menonjol sebagai "paling layak"), diakhiri dinding
  teks SEO.
- Angka komunitas di situs sendiri tiga versi: "80K+" (teks home), "34K+" (statistik home), "13k+" (halaman project).
  [FACT] Mana yang benar [UNKNOWN].

[INFERENCE] Peluang UI kita: konten tanpa iklan dengan lebar penuh, hierarki yang jelas (yang paling layak menonjol),
bahasa visual kepercayaan (status cek, status link, "Dicek"), dan tampilan mobile yang gak rusak.

## 7. Yang belum diketahui

- Trafik, jumlah member premium, dan pendapatan AlphaDrops. [UNKNOWN]
- Sumber data fundraising mereka (label "Synced" mengarah ke sinkronisasi otomatis dari pihak ketiga). [UNKNOWN]
- Akurasi data fundraising mereka (belum dicek silang). [UNKNOWN]
- Harga kita belum ditentukan; jangkar pasar = $5/bulan. [UNKNOWN]
