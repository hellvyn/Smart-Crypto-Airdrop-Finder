# Fondasi Kurasi (sub-proyek #1) — Desain

Tanggal: 2026-10-10
Status: **rev. 3, disetujui owner untuk dibuat plan (2026-10-10)**. Rev. 2: perbaikan skor setelah simulasi terhadap data run
pertama. Rev. 3: akar masalah domain, halaman project vs airdrops.io, fitur AI (§13, detail provider belum lengkap),
Bahasa Indonesia. Tambahan 2026-10-10: keputusan #40 (airdrop yang berakhir setelah lolos kurasi tetap tampil);
keputusan #47–#49 (nama AirdropIQ, desain C, gaya tulisan, §16); keputusan #41–#46 (head-to-head AlphaDrops, §15): sumber baru, cek link klaim, rekam jejak, "Dicek", web publik + fitur AI
khusus member.
Dibangun di atas: `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (spec v1, sudah live)

Label: **[FACT]** dari data/kode/run, **[INFERENCE]** kesimpulan dari bukti, **[UNKNOWN]** belum terverifikasi.

---

## 1. Tujuan dan konteks

**Masalah** (dari owner): list v1 terlalu "mentah". Semua orang lihat isi yang sama, info airdrop kurang menarik, dan belum
ada pembeda antara airdrop yang legit dan yang gak jelas.

**Tujuan produk (keputusan owner, direvisi 2026-10-10, lalu #45):** produk **berbayar** dengan model **freemium**.
List kurasi dan lapisan keamanan bisa dilihat semua pengunjung (seperti AlphaDrops); keputusan dan fitur AI penghemat
waktu khusus member yang **ditambahkan manual oleh owner**. Pendaftaran dan pembayaran di web menyusul (#46). Ukuran suksesnya: konversi ke berbayar. Target user:
pemula **dan** farmer berpengalaman.

**Positioning:** "Airdrop paling cuan, yang udah dicek aman, dan ada buktinya." Cuan = pengait (skor Worth it, top picks),
aman = pembeda dari list lain, bukti = sumber untuk tiap label + track record (sub-proyek berikutnya).

**Tujuan sub-proyek #1:** list member cuma berisi airdrop yang **lolos kurasi**: belum berakhir, risiko low/medium, dan
punya minimal satu sinyal legit. Tiap airdrop yang lolos punya level **Worth it** (potensi dibanding effort) dengan
alasan yang bisa dicek. Sampai paywall (sub-proyek #2) jadi, halaman tetap bisa dibuka siapa saja seperti sekarang.

**Target owner:** produk ini jadi "superpower" buat orang yang garap airdrop: mau untung **dan** mau aman, dan semua yang
ditampilkan bisa dipegang.

**Janji kualitas (cara spec ini menerjemahkan "semua yang dikasih pasti ok"):** gak ada sistem yang bisa menjamin
sebuah airdrop legit atau pasti untung (prinsip spec v1 §1: gak pernah ada label "AMAN"). Yang dijanjikan dan diukur:
1. **Gak ada yang tampil tanpa cek keamanan kuncinya benar-benar jalan.** "Gak ditemukan masalah" baru berarti sesuatu
   kalau ceknya jalan (§6.2 syarat 5).
2. **Tiap label punya sumber** yang bisa ditelusuri member.
3. **Akurasi diukur sebelum paywall dinyalakan** dan harus memenuhi gerbang kualitas di §12.

## 2. Pemecahan scope

Permintaan owner dipecah jadi sub-proyek, masing-masing punya spec → plan → implementasi sendiri (urutan direvisi
2026-10-10 setelah keputusan positioning dan produk berbayar):

| # | Sub-proyek | Status |
|---|---|---|
| 1 | **Fondasi kurasi**: sinyal legit, `curate()`, `worth()`, status kedaluwarsa, tampilan list kurasi | **spec ini** |
| 2 | **Akses member manual** (Plan 7, dikerjakan lebih dulu): hapus signup/email, data khusus user login, landing page. Sisa: top picks, pindah dari Vercel Hobby, ToS/privasi/disclaimer | Plan 7 + berikutnya |
| 3 | Track record: hasil nyata airdrop dibanding level Worth it. Versi pertama = rekam jejak #43 (§15.3) | §15 |
| 4 | **Tracker "Garapan saya"**: checklist harian + heatmap per project (§14, Plan 8, dikerjakan setelah Plan 4) | Plan 8 |
| 5 | Link klaim terverifikasi: versi pertama = cek link klaim #42 (§15.2) | §15 |
| 6 | Cek eligibility lebih dalam | paling belakang |
| 7 | **AI Daily Briefing + Change Detector (A4)**: plan berikutnya setelah Plan 6, sebelum Coach (#41–#46) | setelah Plan 6 |
| 8 | Pendaftaran + pembayaran di web (#46) | nanti |

**Dicoret:** alert Telegram (keputusan owner). Notifikasi tetap lewat email digest yang ada.

Sub-proyek 2–6 bergantung pada data kurasi dari #1.

## 3. Keputusan owner (2026-10-10)

| # | Topik | Keputusan |
|---|---|---|
| 15 | Tujuan "lebih menarik" | ~~Bikin orang mau daftar (signup rate)~~ Diganti #24 |
| 16 | Target user | Pemula dan farmer berpengalaman |
| 17 | Budget data VC/funding | Tetap ~$0/bulan |
| 18 | Project yang gak lolos kurasi | **Disembunyikan** dari semua list publik |
| 19 | Sinyal legit yang dihitung | VC terverifikasi, TVL DefiLlama, terdaftar di CoinGecko, sumber kurasi (minimal satu) |
| 20 | Definisi "worth it" | Potensi dibanding effort, ditampilkan sebagai level + alasan, tanpa nominal $ |
| 21 | Arsitektur | Pendekatan A: tahap sinyal + fungsi deterministik di core. LLM cuma mengekstrak, gak pernah menilai |
| 22 | Sumber VC terverifikasi | Cek silang ke halaman portfolio VC top (opsi A) + sinyal lain tetap jalan (opsi B). Scraper Apify jadi upgrade kalau ada budget |
| 23 | Positioning | "Paling cuan, udah dicek aman, ada buktinya" |
| 24 | Model akses | ~~Cuma member berbayar yang bisa akses isi web~~ Diganti #45 |
| 25 | Pengunjung non-member | Landing page + contoh terbatas (detail di sub-proyek #2) |
| 26 | Alert Telegram | Gak dibikin |
| 27 | Dua jenis peluang | List dipisah jadi tab **"Live now"** (live/announced) dan **"Early bets"** (speculative); `worth()` meranking di dalam tab. Tab ketiga "Sudah berakhir" (#40) |
| 28 | Standar tampil | Project cuma tampil kalau cek keamanan kuncinya jalan; paywall baru dinyalakan setelah gerbang kualitas §12 terpenuhi |
| 29 | Bahasa | **Bahasa Indonesia saja** untuk UI web, email, dan semua output AI (menggantikan asumsi v1 "UI bahasa Inggris dulu"). Konten sumber berbahasa Inggris diterjemahkan/diringkas AI |
| 31 | Pendaftaran member | Gak ada signup; owner menambah user satu per satu di Supabase (Auto Confirm); signup dimatikan di Supabase Auth |
| 32 | Email | Gak ada email sama sekali: email digest dihapus, lupa password = owner reset manual |
| 33 | Akses data | ~~Diganti #45.~~ Semua data airdrop cuma untuk user login, dikunci di RLS **dan** routing; non-login cuma landing (`/`) + `/login`. Menggantikan rencana paywall berbayar di web |
| 34 | Info perubahan | Ditampilkan di web ("Perubahan sejak kunjungan terakhir"), gak lewat email |
| 35 | Tracker garapan | Checklist + heatmap **per project** (bukan per wallet), warna = % task harian dicentang (4 tingkat), streak hari 100% |
| 39 | Rentang heatmap | Sesuai masa garap: dari "Mulai garap" sampai snapshot/akhir kampanye paling awal; tanpa tanggal selesai = 1 tahun (52 minggu) dari hari mulai; maks. 52 minggu |
| 36 | Privasi tracker | Cuma member itu sendiri yang bisa melihat |
| 37 | Asal task tracker | Langkah Harian/Mingguan dari sumber + task buatan member; centang cuma untuk hari ini (zona waktu member) |
| 38 | Coach → tracker | Rekomendasi AI Farming Coach menampilkan tombol "Mulai garap" yang memakai aksi yang sama dengan halaman project |
| 40 | Airdrop yang berakhir | Yang **pernah lolos kurasi** tetap tampil setelah berakhir, di tab ketiga **"Sudah berakhir"**, dengan status "Berakhir", **selamanya** (arsip rekam jejak). Yang belum pernah lolos tetap tersembunyi. Risiko tetap dicek: kalau naik ke high/critical, keluar dari list |
| 41 | Sumber baru | DefiLlama v2 (TVL ≥ $1 jt, listing < 180 hari diprioritaskan, buang rugged/dead/misrepresented, 80 kandidat), collector AlphaDrops (listing), backer dari data fundraising AlphaDrops (`reported_backer`, gak terverifikasi) (§15.1) |
| 42 | Cek link klaim | Tiap link `claim`/`app` dicek domain resmi, umur domain, phishing; AI Scam Analyst membaca halaman portal klaim; link phishing gak bisa diklik (§15.2) |
| 43 | Rekam jejak | Angka agregat dari airdrop yang lolos sebelum token diperdagangkan; tampil publik setelah ≥ 10 berakhir (§15.3) |
| 44 | "Dicek" | Waktu cek terakhir di tiap baris dan halaman; peringatan kalau > 48 jam (§15.4) |
| 45 | Web publik + fitur member | Menggantikan #24/#33: list, keamanan, kontradiksi, langkah, rekam jejak publik; Kelayakan, urutan "paling cuan", Keputusan AI, effort, Briefing, Coach, tracker, watchlist, wallet khusus member. Dikunci di RLS, bukan cuma UI (§15.5) |
| 46 | Jalan jadi member | Belum ada tombol/CTA; bagian member menampilkan "Khusus member" saja. Pendaftaran + pembayaran di update berikutnya |
| 47 | Nama produk | **AirdropIQ** (domain kandidat airdropiq.ai, belum dibeli; airdropiq.com dipakai pihak lain) (§16) |
| 48 | Desain | Arah C **"Sertifikat inspeksi"**: terang, garis hitam tebal, oranye keselamatan, strip hazard, cap bundar "LOLOS 4/4 CEK". Mockup acuan `docs/design/airdropiq-c/` (§16) |
| 49 | Gaya tulisan | Ditulis dengan skill humanizer: tanpa klise AI dan em dash, panjang kalimat bervariasi, nada santai dengan opini "kami", boleh campur istilah Inggris yang umum di crypto Indonesia. Teks final = glosarium Plan 6 (§16) |
| 50 | Task utama di tracker | Langkah sekali jalan (`once`) ikut masuk "Garapan saya" sebagai "Task utama" (dicentang sekali, gak masuk heatmap/streak). "Tambah task" dikecilkan jadi link teks "+ Tambah task sendiri" |
| 51 | Hasil garapan | Member mengisi sendiri hasil airdrop yang udah ended (jumlah token + tanggal claim, atau "Gak dapet"); nilai dolar dihitung dari harga CoinGecko di tanggal claim dan hari ini. Privat. Opt-in "boleh dipakai anonim" untuk rata-rata hasil member, tampil kalau ≥ 5 member ikut. Deteksi otomatis dari wallet ditunda (risiko token palsu, cakupan chain) |
| 30 | Provider AI | `freellm.hellvyn.id`, model `auto`; NVIDIA jadi cadangan lewat circuit breaker (dikonfirmasi owner) |

**Ditolak:** LLM yang menilai legit/worth (gampang ditipu teks scam, gak konsisten, gak bisa dijelaskan); kurasi manual
penuh oleh owner (gak skalabel). API funding berbayar ditunda (lihat §11).

## 4. Model data

### 4.1 Tabel `project_signals` (baru, baca publik)

Satu baris per sinyal per project. Diperbarui tiap run; baris sinyal yang gak ditemukan lagi dihapus.

| Kolom | Isi |
|---|---|
| `project_id` | FK ke `projects`, `on delete cascade` |
| `kind` | `vc_backer`, `tvl`, `coingecko_listed`, `curated_source`, `claimed_backer`, `reported_backer` (#41) |
| `value` | jsonb. `vc_backer`: `{investor, tier}`. `tvl`: `{tvl_usd}`. `coingecko_listed`: `{gecko_id}`. `curated_source`: `{source_kind}`. `claimed_backer`: `{investor, quote}`. `reported_backer`: `{investor, lead, amount_usd, round, round_date, source_url}` |
| `source` | `vc_portfolio`, `defillama`, `airdrops_io`, `telegram`, `llm_text`, `alphadrops` |
| `verified` | `true` hanya untuk sinyal dari sumber independen yang cocok domain. `claimed_backer` dan `reported_backer` **selalu** `false` |
| `observed_at` | waktu sinyal terakhir dicek |

Unik per `(project_id, kind, value->>'investor')` untuk backer, dan per `(project_id, kind)` untuk sinyal lain.

### 4.2 Tabel `curations` (baru, baca publik)

Riwayat, pola sama dengan `risk_assessments`: "terbaru" = `computed_at` terbesar, seri dipecah `seq`.

| Kolom | Isi |
|---|---|
| `project_id` | FK ke `projects` |
| `passed` | boolean |
| `tab` | `live_now`, `early_bets`, `ended` (#40), atau null kalau gak lolos |
| `status_at` | status project (setelah `expireStatus`) saat kurasi dihitung; dasar aturan "pernah lolos sebelum berakhir" (§6.2) |
| `ended_on` | tanggal berakhir (date, null kalau belum berakhir): tanggal deadline dasar `expireStatus` kalau ada, kalau gak ada tanggal pertama status tercatat `ended` (dibawa dari curation sebelumnya) |
| `worth_level` | `high`, `medium`, `low`, `insufficient_data` |
| `reasons` | jsonb: alasan lolos/gagal + alasan worth (kode + pesan, seperti `RiskReason`) |
| `coverage` | jsonb: sinyal mana yang dicek vs belum (mis. portfolio VC gagal diambil) |
| `computed_at`, `seq` | seperti `risk_assessments` |

### 4.3 Tabel `vc_portfolios` (baru, service role saja)

Cache mingguan domain di halaman portfolio VC: `(vc_id, domain, fetched_at)`. Cuma domain yang disimpan, bukan teks
halaman. Gak bisa dibaca publik.

### 4.4 Perubahan tabel yang ada

- `project_changes.field`: tambah `curated` (old/new = `true`/`false`), selain `status` dan `risk_level`.
- Statistik `pipeline_runs.stats`: tambah `curation_checked`, `curation_passed`, `curation_hidden_insufficient_checks`,
  `vc_portfolios_failed`, dan cakupan cek kunci: `projects_with_official_domain`, `domain_age_ran`, `phishing_list_ran`.

### 4.5 View `curated_list` (baru)

Turunan `project_list` (security_invoker), cuma project yang curation terbarunya `passed = true`. Menambah kolom
`tab` (`live_now` untuk status live/announced, `early_bets` untuk speculative, `ended` untuk yang berakhir setelah lolos,
#40), `ended_on`, `worth_level`, dan ringkasan sinyal (untuk badge). Urutan default di §6.3; tab `ended` diurutkan
`ended_on` terbaru dulu.

### 4.6 Ekstraksi LLM (versi prompt naik)

Field baru per project untuk menyamai isi halaman airdrops.io (§7.2). Ekstraksi tetap tugas LLM; penilaian ada di
§13 (AI Analyst) dan aturan deterministik:
- `key_parameters`: alokasi airdrop (mis. "5% dari total supply"), metode distribusi, tanggal TGE, masing-masing dengan
  kutipan.
- `steps`: langkah berurutan (menggantikan `tasks` yang datar), tiap langkah ditandai `recurring` (harian/mingguan, mis.
  "check in daily") atau `once`.
- `source_ratings`: penilaian editorial sumber kalau ada (airdrops.io: Difficulty, Cost to earn), disimpan sebagai klaim
  sumber, bukan fakta.
- `latest_update`: kalimat update terbaru dari sumber, dengan tanggalnya.

Field yang sudah direncanakan di rev. 1:
- `claimed_backers`: `[{investor, quote}]`. Nama investor yang disebut teks, plus kalimat aslinya. Kutipan wajib ada di
  teks sumber (aturan yang sama dengan field lain).
- `capital_required`: `none` | `low` | `high` | `unknown`. Contoh: "deposit min. $1,000" = `high`.

## 5. Pipeline

### 5.0 Perbaikan data dasar (dikerjakan pertama, sebelum `curate()`)

Simulasi aturan rev. 1 terhadap run pertama menunjukkan kurasi dibangun di atas data yang bolong [FACT, run 2026-10-10]:

| Tahap | Angka |
|---|---|
| Dokumen airdrops.io | 39; **21 tanpa URL sama sekali** di teks yang diambil |
| Project dari teks (airdrops.io + Telegram) | 47; 18 punya link apa pun; **7 punya website resmi** |
| Dokumen Telegram | 17; **1 diekstrak**, 16 tertunda (kimi-k3 timeout, sudah diperbaiki di PR #2) |
| Cek kunci yang jalan (dari 96 project) | `dangerous_asks` 96, `lookalike` 56, `phishing_list` 30, **`domain_age` 10**, `token_security`/`contract_verified` 0 |

Tanpa domain resmi, cek domain (umur, phishing, lookalike) dan semua sinyal terverifikasi gak bisa jalan. Jadi:

1. **Cakupan domain resmi.** Akar masalahnya sudah ketemu [FACT, screenshot halaman Arcus dari owner + teks DAC]:
   - Link resmi (Website, Docs, X, Telegram, Blog) ada di kotak **"Overview" di bagian bawah** halaman detail, di luar
     blok `.airdrop-info`…`.airdrop-bottom` yang sekarang diambil.
   - Link eksternal **di dalam** blok juga hilang: collector cuma menyimpan link `/visit/`. Contoh: teks DAC berbunyi
     "enter it on the Interstellar portal ." (kata "portal" tersisa, URL-nya hilang).
   Perbaikan: ambil kotak Overview sebagai bagian dokumen, dan pertahankan URL eksternal di dalam blok (dalam bentuk teks
   yang tetap lolos aturan "URL harus ada di sumber"). Target: **≥ 80%** project live/announced dari teks punya domain
   resmi.
2. **Cakupan cek domain.** Cari kenapa `domain_age` (RDAP) cuma jalan di 10 dan `phishing_list` (GoPlus) di 30 project
   (TLD gak didukung RDAP, rate limit, timeout, atau project tanpa domain). Perbaiki yang bisa; TLD yang memang gak punya
   RDAP dicatat sebagai keterbatasan. Target: **≥ 95%** project yang punya domain resmi menjalankan `domain_age` dan
   `phishing_list`.
3. Angka cakupan di atas masuk `pipeline_runs.stats` (§4.4) supaya regresi kelihatan tiap hari.

### 5.1 Urutan tahap

```
collect → extract+merge → speculative → signals (baru) → score (diperluas) → notify → purge
```

`signals` dapat nomor `failed_step` baru (8), nomor lama tetap stabil.

### 5.2 Tahap `signals`

| Sinyal | Cara | Request tambahan |
|---|---|---|
| `tvl`, `coingecko_listed` | Cocokkan project ke daftar `/protocols` DefiLlama yang **sudah diambil** di tahap collect (daftar lengkap, bukan hasil filter collector yang sengaja membuang protocol ber-`gecko_id`) | 0 |
| `curated_source` | Dari `source_kind` dokumen project (airdrops.io atau channel Telegram di config) | 0 |
| `claimed_backer` | Dari `claimed_backers` hasil ekstraksi | 0 |
| `curated_source` (AlphaDrops) | Project dari collector `alphadrops` (#41) | 0 |
| `reported_backer` | Halaman `/raises/<slug>` AlphaDrops, diterima cuma kalau "Official Website" cocok domain (§15.1) | ≤ 40 halaman **seminggu sekali** |
| `vc_backer` | Cek domain project terhadap cache `vc_portfolios` | 0 per project; ~10–15 request **seminggu sekali** untuk menyegarkan cache |

**Aturan pencocokan (anti-scam, wajib):** sinyal terverifikasi (`tvl`, `coingecko_listed`, `vc_backer`) hanya menempel
kalau **registrable domain** resmi project sama dengan domain di sumbernya. **Cocok nama saja gak diterima**: scam sering
memakai nama project terkenal, dan cocok nama akan memberi mereka badge milik project asli. Project tanpa domain resmi gak
dapat sinyal terverifikasi.

**`vc_backer`:** project dapat sinyal ini kalau domainnya ada di portfolio sebuah VC di daftar, baik project itu
mengklaim VC tersebut atau tidak. Klaim backer yang **gak** ditemukan di portfolio tetap tersimpan sebagai
`claimed_backer` (`verified = false`).

**Daftar VC** ada di config: `{id, name, aliases, tier, portfolioUrl}`, 10–15 VC. Daftar final diusulkan di plan.
VC yang halaman portfolionya gak bisa dibaca dengan rapi, atau ToS-nya melarang, dicoret.

**Kegagalan:** sinyal yang gagal diambil dicatat sebagai "belum dicek" di `coverage`, bukan "gak ada". Satu sumber gagal
gak menggagalkan run.

### 5.3 Tahap `score` (diperluas)

Per project aktif, urut (project berstatus `ended` yang curation terbarunya lolos tetap ikut di-score sampai 90 hari
setelah `ended_on`, karena masa klaim adalah waktu paling rawan situs klaim palsu; setelah itu hasil terakhir dibekukan
dan halaman menampilkan tanggal cek terakhir):
1. `expireStatus()`: status kedaluwarsa (§6.1). Perubahan status masuk `project_changes`.
2. `assessRisk()`: tetap seperti v1.
3. `curate()` + `worth()`: hasil masuk `curations`. Perubahan `passed` masuk `project_changes` (`field = curated`).

## 6. Aturan (fungsi murni di `@saf/core`)

### 6.1 `expireStatus(status, deadlines, today)`

Berlaku untuk status `live`, `announced`, `speculative`. Status menjadi `ended` (alasan "deadline passed") kalau:
- ada deadline `claim` atau `campaign_end` dengan presisi `exact`/`approximate` yang tanggalnya **sebelum** `today`, **dan**
- gak ada deadline `claim`, `snapshot`, `campaign_end`, atau `tge` (presisi `exact`/`approximate`) di `today` atau
  setelahnya. Hanya jenis yang masih membuka kesempatan ikut yang menahan kedaluwarsa; `withdraw_funds` dan `other`
  (mis. "token terkunci sampai 11 Okt") tidak.

Status bisa balik otomatis: `deriveStatus` dijalankan ulang tiap merge dari evidence, lalu `expireStatus` diterapkan lagi.

Kasus nyata yang wajib jadi fixture [FACT, run 2026-10-10]: CZR, status `live` dari halaman 1 Okt, `campaign_end` 30 Sep,
`claim` 5 Okt, `tge` 1 Okt, dua deadline `other` 11 Okt. Hasil yang diharapkan pada `today` = 10 Okt: `ended`.

### 6.2 `curate()` — lolos atau tidak

Lolos kalau **semua**:
1. Status (setelah `expireStatus`) ∈ {`live`, `announced`, `speculative`}.
2. Risiko terbaru ∈ {`low`, `medium`} (bukan `high`, `critical`, `insufficient_data`).
3. Minimal satu sinyal legit: `vc_backer` terverifikasi, `tvl` ≥ $10 jt, `coingecko_listed`, atau `curated_source`.
4. `lookalike_of` kosong.
5. **Cek keamanan kunci jalan semua:** `dangerous_asks`, `lookalike`, `domain_age`, dan `phishing_list` untuk domain resmi
   project. Project tanpa domain resmi otomatis gagal di sini (alasan "insufficient checks"). Ini yang membuat "low risk"
   berarti "dicek dan bersih", bukan "gak sempat dicek".

Alasan gagal disimpan (untuk owner dan peringatan di halaman detail).

**Project yang berakhir (keputusan #40).** Kalau status (setelah `expireStatus`) = `ended`, syarat 1, 3, dan 5 diganti
dengan "**pernah lolos sebelum berakhir**": curation terbaru dengan `status_at` ≠ `ended` punya `passed = true`. Syarat 2
dilonggarkan jadi risiko ∉ {`high`, `critical`} (`insufficient_data` gak menggugurkan, karena cek domain bisa berhenti
jalan setelah kampanye selesai), syarat 4 tetap. Lolos → `tab = ended`, alasan `ended_after_curation`. Yang gak pernah
lolos sebelum berakhir tetap gagal (`status_not_open`), jadi filter gak bocor. Kalau status balik ke live/announced/
speculative, aturan normal berlaku lagi.

**Konsekuensi** [INFERENCE dari data run pertama]: dengan cakupan domain sekarang (7 dari 47 project teks), syarat 5
akan menyembunyikan hampir semua airdrop live. Itu disengaja: perbaikan §5.0 harus selesai lebih dulu, dan gerbang §12
memastikan paywall gak nyala dengan list yang kosong atau yang belum dicek. `curated_source` tetap longgar; sinyal kuat
(VC/TVL/CoinGecko) dipakai untuk ranking dan badge.

### 6.3 `worth()` — potensi dibanding effort

**Kenapa direvisi** [FACT dari simulasi rev. 1 terhadap 96 project]: rev. 1 akan menaruh 50 kandidat DefiLlama
(speculative, belum ada pengumuman airdrop, rata-rata 0,1 task) di atas airdrop live/announced, karena kandidat DefiLlama
otomatis dapat poin TVL + "belum ada token", sedangkan airdrop live hampir gak punya domain resmi dan umumnya sudah
menyebut ticker. Rev. 2 memperbaiki tiga hal:

1. **Diranking di dalam tab** (`live_now` vs `early_bets`), bukan di satu skala. Taruhan awal dan kerjaan yang bisa
   dimulai sekarang gak dibandingkan langsung.
2. **Proxy "belum ada token yang diperdagangkan"** diganti: bukan `token_symbol` kosong (airdrop live umumnya sudah
   menyebut ticker), tapi **gak `coingecko_listed` dan gak ada deadline `tge` yang sudah lewat**.
3. **Kalibrasi jadi syarat**, bukan catatan (§12).

| Faktor | Poin |
|---|---|
| `vc_backer` terverifikasi tier 1 / tier lain | +3 / +2 (diambil yang tertinggi) |
| TVL ≥ $100 jt / ≥ $10 jt | +2 / +1 |
| Belum ada token yang diperdagangkan (gak `coingecko_listed`, gak ada `tge` yang lewat) | +2 |
| Sinyal dari > 1 sumber independen | +1 |
| Funding dilaporkan (`reported_backer`) ≥ $5 jt, gak dijumlah dengan `vc_backer` terverifikasi (diambil yang tertinggi) | +1 (#41, ikut kalibrasi) |
| `capital_required` high / low / none | −2 / −1 / 0 (`unknown` = 0, disebut di alasan) |
| Task > 8 | −1 |

Level: ≥ 4 `high`, 2–3 `medium`, ≤ 1 `low`. `insufficient_data` kalau satu-satunya sinyal potensi adalah
`curated_source` **dan** `capital_required` = `unknown`.

Bobot dan ambang di atas **titik awal kalibrasi** [INFERENCE], bukan angka final. Prosedur kalibrasi (setelah §5.0
selesai dan minimal 3 run harian dengan data hasil perbaikan):
- Jalankan `worth()` ke semua project; owner me-review **top 20 per tab** dan menandai yang urutannya gak masuk akal.
- Ubah bobot sampai owner setuju; bobot final dan alasannya dicatat di spec ini.

**Urutan di dalam tab:** worth (`high` → `medium` → `low` → `insufficient_data`), lalu sinyal terkuat (VC → TVL →
CoinGecko → sumber kurasi), lalu deadline terdekat, lalu `last_seen` terbaru.

## 7. Tampilan (UI Bahasa Indonesia, keputusan #29)

Teks UI di bawah masih ditulis dalam bahasa Inggris sebagai acuan; implementasinya **Bahasa Indonesia**. Penerjemahan UI
yang sudah ada (halaman v1, email digest, assertion e2e) masuk plan sebagai task tersendiri.

Halaman di bawah ini nantinya **khusus member** (sub-proyek #2 yang menambah paywall, landing page, dan contoh terbatas).
Sub-proyek #1 membangunnya di route yang sekarang; pemindahan ke balik paywall dikerjakan di #2.

### 7.1 Halaman list (sekarang `/`)
- Sumber data: `curated_list`. Project yang gak lolos gak muncul di list mana pun.
- Tiga tab: **"Live now"** (bisa dikerjakan sekarang; default), **"Early bets"** (belum ada pengumuman, taruhan awal), dan
  **"Sudah berakhir"** (#40: pernah lolos kurasi lalu berakhir; status "Berakhir" + tanggal berakhir, urut terbaru dulu,
  tanpa batas waktu).
- Baris ringkasan dari run terakhir: "N airdrops checked today · M passed curation".
- Tiap baris menampilkan cakupan cek: "4/4 key safety checks ran" dan "Dicek {waktu}" (#44).
- Tiap baris: nama, status, level **Worth it**, level risiko, badge sinyal (`VC-backed: Paradigm ✓`, `TVL $45M`,
  `Listed on CoinGecko`, `Curated source`), deadline terdekat.
- Filter: status, risiko, chain (sudah ada) + Worth it.
- Kosong: "No airdrop passed curation today" + jumlah yang dicek.

### 7.2 Halaman detail `/projects/<slug>`: harus lebih berguna dari halaman airdrops.io

Acuan pembanding [FACT, halaman Arcus di airdrops.io]: label status, vote, "Join now" (link referral, "Signing up through
our link gives you 5% off"), detail, update terbaru, checklist 7 langkah, widget bridge, tips, istilah, FAQ, Difficulty
"Easy" / Cost to earn "Medium" tanpa alasan, kotak Overview. Halaman mereka bertentangan sendiri: teks "dYdX Labs has
confirmed that Arcus will launch its own token" vs label "Airdrop unconfirmed" (DAC kebalikannya).

Urutan bagian halaman kita (atas ke bawah):

| Bagian | Isi | Bergantung pada |
|---|---|---|
| Kepala | Nama, tab (Live now / Early bets), level Worth it, level risiko + "4/4 cek kunci jalan", link resmi terverifikasi, "Terakhir berubah: N hari lalu" | §5, §6 |
| **Keputusan AI** | "Garap / Pantau / Skip" + tesis 3–5 poin (alokasi, backer, mekanisme poin, persaingan, modal & menit per hari), keyakinan, kutipan sumber per poin | §13 AI Analyst |
| **Kontradiksi** | Fakta yang gak disepakati antar sumber atau di dalam satu sumber, dengan dua kutipannya | §13 |
| **Progress lo** | Checklist per wallet; langkah `recurring` dipisah dari `once`; hitung mundur deadline | sub-proyek checklist (struktur data `steps` disiapkan di sini) |
| **Timeline perubahan** | "1 Okt: program poin mulai · 30 Sep: Season 0 selesai" | §13 Change Detector |
| **Keamanan** | Peringatan spesifik project (AI Scam Analyst + 4 cek kunci), tiap link diberi status cek domain | §6.2, §13 |
| **Effort** | Estimasi AI "≈10 menit/hari · modal $100+", disandingkan dengan penilaian sumber ("airdrops.io: Easy") + alasan beda | §13 |
| **Langkah** | Langkah diringkas dan diterjemahkan AI ke Bahasa Indonesia, tiap langkah dengan link bersih (tanpa referral) yang sudah dicek | §4.6 `steps`, §13 |
| **Why it's listed** | Sinyal, sumber, label terverifikasi/diklaim, tanggal cek | §5.2 |
| **Tanya AI** | Pintu ke AI Farming Coach dengan konteks project ini | §13 |

Aturan yang tetap: backer klaim ditulis "Diklaim project, belum terverifikasi"; status kedaluwarsa ditulis "Berakhir
(deadline lewat)" + deadline dasarnya; semua link keluar lewat pembersih referral yang sudah ada.

### 7.3 Project yang gak lolos / keluar dari kurasi
Berakhir setelah lolos (#40) **bukan** "keluar dari kurasi": halaman detailnya tanpa peringatan, dengan status "Berakhir"
+ tanggal berakhir, dan perubahannya tampil sebagai perubahan status ("X sudah berakhir"), bukan `curated` true→false.

- Halaman detail tetap bisa dibuka lewat link langsung (oleh yang punya akses), dengan peringatan di paling atas:
  "Not in the curated list: <alasan>". Halaman diberi `noindex`.
- Watchlist tetap menampilkannya dengan label peringatan yang sama.
- Web: project di watchlist yang keluar dari kurasi muncul di bagian "Perubahan sejak kunjungan terakhir" (lewat
  `project_changes.field = curated`). Gak ada email (keputusan #32, #34).

## 8. Keamanan dan privasi

- Semua tabel baru RLS on. Pembagian baca publik vs member mengikuti #45 dan §15.5 (menggantikan "cuma
  `authenticated`" dari #33). `vc_portfolios` tanpa akses web.
- Gak ada data user baru. Log run tetap angka saja (spec v1 §9).
- Teks halaman portfolio VC gak disimpan, cuma domain.
- LLM gak pernah memutuskan lolos/worth; teks project (termasuk klaim "backed by X") gak bisa menaikkan status verified.

## 9. Penanganan error

| Kondisi | Perilaku |
|---|---|
| Halaman portfolio VC gagal diambil / berubah format | VC itu "belum dicek" di `coverage`; cache lama dipakai kalau < 14 hari; `vc_portfolios_failed` +1 |
| DefiLlama `/protocols` gagal | `tvl`/`coingecko_listed` "belum dicek"; kurasi tetap jalan dengan sinyal lain |
| `curate()`/`worth()` throw untuk satu project | Dihitung `score_failed`, project lain tetap diproses |
| Semua project gagal kurasi di satu run | List memakai curation terbaru yang ada (view memakai baris terbaru, bukan run terbaru) |

## 10. Testing

- Unit (core): `expireStatus` (termasuk fixture CZR), `curate` (tiap syarat gagal sendiri-sendiri; berakhir setelah
  lolos → `ended`; berakhir tanpa pernah lolos → gagal; berakhir + risiko high → gagal), `worth` (tiap faktor,
  batas level, `insufficient_data`), pencocokan domain (nama sama + domain beda = **gak** cocok).
- Unit (pipeline): tahap `signals` dengan fake DefiLlama/portfolio, kegagalan sumber → coverage, cache portfolio mingguan.
- pgTAP: RLS tabel baru, `vc_portfolios` gak terbaca anon/authenticated, view `curated_list` cuma berisi yang lolos.
- e2e: list cuma menampilkan yang lolos; halaman project yang gak lolos menampilkan peringatan + `noindex`; badge klaim
  gak pernah tampil sebagai verified.
- **Eval LLM diperluas:** dari 8 jadi **≥ 30 kasus** berlabel tangan, dan menilai field yang sekarang gak dinilai padahal
  jadi dasar aturan: **tanggal + jenis deadline** (dasar `expireStatus`), **URL resmi** (dasar semua cek domain), plus
  `claimed_backers` dan `capital_required`. [FACT] Eval sekarang cuma menilai status, token, chain, halusinasi URL, dan
  recall.
- **Set uji scam:** ≥ 30 kasus fake-airdrop nyata (domain/halaman yang dilaporkan publik: daftar phishing, laporan
  korban) + ≥ 30 airdrop legit yang sudah terbukti bayar. Risk engine + `curate()` dijalankan ke keduanya, hasilnya jadi
  angka tangkap-scam dan salah-sembunyi di §12. Data uji disimpan seperti `eval/cases` (gak di-commit kalau ToS
  sumbernya gak jelas).

## 11. Harus diverifikasi

| # | Item | Dampak kalau buruk |
|---|---|---|
| 1 | Struktur dan ToS halaman portfolio tiap VC kandidat | VC dicoret dari daftar; cakupan `vc_backer` mengecil |
| 2 | Data `/protocols` DefiLlama memuat `url` dan `gecko_id` yang cukup untuk pencocokan domain [INFERENCE dari kode collector] | Sinyal TVL/CoinGecko cuma untuk project DefiLlama |
| 3 | Kalibrasi bobot `worth()` terhadap data produksi | Level worth gak mencerminkan potensi; ubah bobot |
| 4 | Seberapa banyak project lolos per hari. Data run pertama [FACT]: 85 dari 96 project berisiko low/medium (0 high/critical), jadi aturan §6.2 akan meloloskan hampir semua | Rev. 2 menjawab ini dengan syarat cek kunci (§6.2 nomor 5): jumlah yang lolos akan turun tajam sampai §5.0 selesai. Batas bawahnya dijaga gerbang G9 (§12) |
| 5 | RootData: owner melaporkan gak ada API gratis (2026-10-10) [FACT dari owner]; CryptoRank Sandbox gak memuat funding [INFERENCE dari review pihak ketiga]; DefiLlama `/raises` berbayar (HTTP 402) [FACT] | Sumber funding lengkap butuh budget; Apify (~$0,002/round) jadi upgrade pertama |
| 6 | Lokasi link website/sosmed di HTML halaman airdrops.io (§5.0 nomor 1) | Cakupan domain gak naik; perlu sumber domain lain (mis. DefiLlama `url` dengan pencocokan yang aman) |

## 12. Gerbang kualitas sebelum paywall dinyalakan

Owner **gak menambahkan member berbayar** sebelum semua gerbang ini terpenuhi dan angkanya dicatat di spec ini. Angka target adalah usulan [INFERENCE]; owner boleh mengubahnya, tapi gak boleh menghapus gerbangnya.

| # | Gerbang | Target | Diukur dari |
|---|---|---|---|
| G1 | Cakupan domain resmi project live/announced | ≥ 80% | `pipeline_runs.stats`, rata-rata 3 run terakhir |
| G2 | Cek kunci jalan untuk project ber-domain | ≥ 95% | `pipeline_runs.stats` |
| G3 | Project tampil tanpa 4 cek kunci | 0 | aturan §6.2 nomor 5 + test pgTAP/e2e |
| G4 | Akurasi status LLM | ≥ 90% di ≥ 30 kasus | eval §10 |
| G5 | Akurasi tanggal + jenis deadline | ≥ 90% | eval §10 |
| G6 | URL halusinasi | 0 | eval §10 |
| G7 | Scam dari set uji yang **lolos kurasi** | 0 dari ≥ 30 | set uji scam §10 |
| G8 | Airdrop legit dari set uji yang tersembunyi | ≤ 20% | set uji scam §10 |
| G9 | Isi list | ≥ 5 project lolos di tab "Live now", rata-rata 3 run | `curation_passed` |
| G10 | Urutan worth disetujui owner | top 20 per tab di-review | prosedur §6.3 |

Kalau G7 gagal (ada scam yang lolos), penyebabnya diperbaiki di aturan risiko/kurasi dulu, lalu set uji dijalankan
ulang. Kalau G9 gagal karena syarat cek kunci, perbaikannya di cakupan data (§5.0), bukan melonggarkan syarat.

## 13. Fitur AI (rev. 3, detail provider belum lengkap)

**Konteks keputusan:** nama produknya "Smart Airdrop Finder" karena owner mau AI jadi inti produk. Rev. 1–2 membatasi AI
cuma sebagai pengekstrak; itu terlalu sempit. Rev. 3 memakai AI di mana AI paling kuat, dengan satu batas yang gak boleh
dilanggar.

**Batas keras (asimetris):** AI boleh **menambah** peringatan dan menurunkan rekomendasi; AI **gak boleh** menghapus
peringatan, memberi badge "terverifikasi", atau meloloskan project yang gagal syarat §6.2. Alasan: teks project (termasuk
"backed by a16z, 100% safe") ditulis pihak yang bisa saja scammer, dan AI bisa terbujuk. Teks sumber selalu diperlakukan
sebagai data, bukan instruksi.

**Aturan umum output AI:** tiap klaim faktual menyertakan kutipan sumber; ditampilkan berlabel "Analisis AI", terpisah
dari "Data terverifikasi"; semua output Bahasa Indonesia (keputusan #29); hasil disimpan beserta versi prompt dan model.

| # | Fitur | Isi | Masuk sub-proyek |
|---|---|---|---|
| A1 | **AI Analyst** | Tesis per airdrop: Garap / Pantau / Skip, keyakinan, 3–5 poin berkutipan. Menjadi masukan `worth()` (bobotnya dikalibrasi bersama §6.3) | #1 |
| A2 | **AI Scam Analyst** | Membaca halaman klaim/pengumuman, menandai pola rekayasa sosial (desakan waktu, "connect wallet to check eligibility", admin palsu, minta seed phrase terselubung). Cuma bisa menaikkan risiko | #1 |
| A3 | **Deteksi kontradiksi** | Membandingkan fakta antar sumber dan di dalam satu sumber (label vs teks) | #1 |
| A4 | **Daily Briefing + Change Detector** | Membandingkan versi dokumen (hash konten sudah disimpan) dan merangkum perubahan yang penting; briefing pagi per member | #3 |
| A5 | **Farming Coach (chat)** | Rencana farming personal dari modal, jumlah wallet, dan waktu member, berdasar data kurasi. Tiap project yang direkomendasikan punya tombol **"Mulai garap"** (aksi `startFarming` dari §14) | #4 |
| A6 | **Estimasi effort + terjemahan langkah** | Menit per hari, modal, gas; langkah diringkas ke Bahasa Indonesia | #1 |

**Provider (keputusan #30):** AI pribadi owner `https://freellm.hellvyn.id/v1`, model **`auto`** (keputusan owner:
pakai `auto`, tanpa eval sekarang). Fakta dari pengecekan 2026-10-10:
- OpenAI-compatible (`/v1/models`, `/v1/chat/completions`) [FACT]; adapter yang ada cocok, cukup `baseUrl` + key per model.
- Router ke model gratis: 4.150 model terdaftar, 170 tersedia; nama seperti `claude-opus-4-5` adalah "slot" yang
  di-route ke model gratis [FACT]. `auto` memilih model per request (contoh: `gpt-oss:120b`), jadi model yang menjawab
  bisa berbeda antar request [FACT/INFERENCE].
- Rate limit upstream nyata: eval parsial `deepseek-v4-flash` 7 dari 8 kasus gagal `http_429`, 1 kasus terjawab dengan
  status salah [FACT]. `gemini-3.8-flash` 502 di 30 detik tanpa streaming → streaming wajib (sudah) [FACT].
- **Endpoint menjawab tanpa API key** [FACT]. Owner perlu mengaktifkan autentikasi sebelum produk dibuka; adapter tetap
  mengirim `LLM_API_KEY`.

Konsekuensi desain:
- **Cadangan NVIDIA** (`glm-5.3-flash` → `kimi-k3` → `gemma-4-31b-it`) lewat circuit breaker, supaya pipeline harian gak
  gagal total saat router kena rate limit (dikonfirmasi owner).
- Tiap hasil AI menyimpan **model yang benar-benar menjawab** (dari field `model` di respons), supaya penurunan kualitas
  bisa ditelusuri ke model tertentu.
- Kunci disimpan sebagai secret (`LLM_API_KEY`, `LLM_BASE_URL` di GitHub Actions dan Vercel server-side), gak pernah di kode
  atau chat.
- Eval tetap jadi **syarat sebelum paywall** (G4–G6, G11–G13), bukan sekarang. Karena `auto` bisa berganti model, eval
  diulang berkala (mis. mingguan) dan hasilnya dicatat.

**Gerbang kualitas tambahan (melengkapi §12):**

| # | Gerbang | Target |
|---|---|---|
| G11 | Tesis AI Analyst direview owner | ≥ 20 sampel, ≥ 80% dinilai "masuk akal" |
| G12 | AI Scam Analyst di set uji scam §10 | menandai ≥ 80% kasus scam; gak pernah menurunkan level risiko |
| G13 | Kualitas Bahasa Indonesia output AI | owner review ≥ 20 sampel |
| G14 | Kapasitas provider untuk Coach | diukur sebelum Coach dibuka; batas pemakaian per member ditentukan dari angka itu |

## 14. Tracker "Garapan saya" (keputusan #35–#38)

**Tujuan:** kebiasaan harian. Member menandai project yang sedang digarap, mencentang task harian, dan melihat
konsistensinya sebagai heatmap sepanjang masa garap airdrop itu (seperti grafik kontribusi GitHub). Tracker manual, tanpa cek onchain.

**Alur:**
- Halaman project: tombol "Mulai garap" / "Berhenti garap" (beda dari Watch: Watch = memantau).
- Halaman `/garapan` ("Garapan saya"): satu kartu per project aktif berisi checklist hari ini (task Harian), task
  Mingguan (indikator "minggu ini sudah"), heatmap masa garap, streak, dan sisa hari sampai snapshot/akhir kampanye. "Berhenti garap"
  mengarsipkan; riwayat tetap.
- AI Farming Coach (A5) memakai aksi `startFarming` yang sama.

**Aturan:**
- Hari = tanggal lokal di `profiles.timezone`. Centang cuma untuk **hari ini**; hari lalu gak bisa diubah.
- Warna kotak = persentase task Harian yang aktif hari itu dan dicentang: 0% / 1–49% / 50–99% / 100%. Hari tanpa task
  Harian aktif = kosong (abu).
- Streak = jumlah hari berturut-turut 100%, berakhir hari ini (atau kemarin kalau hari ini belum 100%).
- **Rentang heatmap (keputusan #39):** dari hari "Mulai garap" (tanggal lokal) sampai deadline `snapshot` atau
  `campaign_end` (presisi `exact`/`approximate`) paling awal yang ≥ hari mulai. Hari yang belum lewat sampai deadline
  tampil sebagai kotak "akan datang" + teks "Sisa {n} hari sampai {snapshot|akhir kampanye}". Tanpa tanggal selesai: 1 tahun
  (364 hari) dari hari mulai, tanpa teks "Sisa n hari"; begitu sumber menyebut snapshot/akhir kampanye, rentang ikut
  berubah (dihitung ulang tiap kali dibuka). Maksimal 52 minggu (yang dipotong bagian paling awal). Project yang sudah
  berakhir (#40): rentang berhenti di `ended_on` kalau itu lebih awal, dengan teks "Berakhir {tanggal}".
- Task Mingguan gak masuk persentase harian; "sudah" kalau dicentang di minggu ISO yang sama (zona waktu member).
- Task awal = semua langkah dari sumber (terjemahan AI kalau ada) saat "Mulai garap": `once` jadi "Task utama" (#50), `daily`/`weekly` jadi checklist harian/mingguan. Member bisa menambah dan
  mengarsipkan task sendiri. "Ambil ulang langkah dari sumber" menambah langkah baru (berdasar teks) dan mengarsipkan yang
  sudah hilang; centang lama tetap tersimpan dengan teks task-nya.
- Batas: 50 project aktif per member, 30 task aktif per project.
- **Hasil garapan (#51):** kartu project yang ended menanyakan "Dapet berapa dari airdrop ini?" (jumlah token + tanggal
  claim, atau "Gak dapet"). Nilai dolar dari harga CoinGecko (`gecko_id` dari sinyal `coingecko_listed` yang cocok
  domain); kalau gak ada `gecko_id`, cuma jumlah token. Di atas halaman: "Total hasil garapan". Privat untuk member itu.
  Opt-in anonim untuk "Rata-rata member yang garap {project}: ≈ ${x} (dari {n} member yang mau berbagi)", tampil kalau
  n ≥ 5. Token yang masuk wallet **gak pernah** dicatat otomatis: token palsu dengan simbol sama sering dikirim ke banyak
  wallet.

**Data dan keamanan:** tabel `farming_projects`, `farming_tasks`, `farming_checks`; RLS: tiap baris cuma bisa dibaca
dan diubah pemiliknya (`user_id = auth.uid()`); centang lewat fungsi `SECURITY DEFINER` yang menghitung tanggal lokal di
server, jadi klien gak bisa menulis tanggal lain. Hapus akun ikut menghapus semuanya (cascade dari `auth.users`).

**Gak termasuk:** cek onchain otomatis, versi per wallet, leaderboard/profil publik, pengingat email.

## 15. Head-to-head AlphaDrops (keputusan #41–#46)

Riset: `docs/research/2026-10-10-alphadrops-head-to-head.md`. Ringkas [FACT]: AlphaDrops punya 169 airdrop + 881
proyek fundraising, tanpa cek keamanan per project, 25% link website berupa referral, 42 dari 63 entri aktif ditambahkan
sebelum April 2026, tanpa AI, Inggris saja, Premium $5/bulan. Irisan dengan data kita: 11 dari 63 airdrop aktif mereka.
Strategi: **tutup celah isi, menang di kepercayaan dan keputusan.**

### 15.1 Sumber baru (#41)

**DefiLlama v2** (mengganti seleksi kandidat collector `defillama`): gak ada `gecko_id`/symbol; TVL ≥ $1.000.000;
buang `rugged = true`, `deadFrom` terisi, `misrepresentedTokens = true`; urut: `listedAt` < 180 hari dulu, lalu
`change_7d` desc, lalu TVL desc; maksimal 80. Syarat sinyal legit TVL di §6.2 tetap ≥ $10 jt.

**Collector `alphadrops`** (`source_kind` baru):
- Listing `https://alphadrops.net/airdrops`: data terstruktur di HTML (Next.js), ambil status `active`, `upcoming`,
  `claimable`. Satu dokumen per project untuk ekstraksi LLM: nama, deskripsi, kategori, chain, funding, status, plus teks
  halaman detail kalau diambil.
- Halaman detail `/airdrops/<slug>` untuk tiap item yang diambil, maksimal 80 per run, jeda ≥ 1,5 detik. Hash dokumen
  yang sudah ada mencegah ekstraksi LLM ulang kalau isinya sama.
- Link website: buang parameter referral (pembersih yang ada), resolve redirect (maks. 3 lompatan). Kalau host akhir
  persis ada di daftar host perantara di config (`s.kaito.ai`, `linktr.ee`, `galxe.com`, `app.galxe.com`, `zealy.io`,
  `layer3.xyz`, `bit.ly`, `t.co`) atau `alphadrops.net`, link itu **bukan** domain resmi dan gak ditulis ke dokumen.
  Cocok host persis, bukan registrable domain, supaya project yang memang beralamat di `kaito.ai` tetap punya domain.
- Gagal ambil = `CollectorResult.failed`, run tetap jalan (pola collector yang ada).

**`reported_backer`** (tahap `signals`; halaman diambil seminggu sekali dan disimpan di cache `alphadrops_raises`
(`slug` pk, `official_domain`, `rounds` jsonb, `fetched_at`), service role saja, karena sinyal ditulis ulang tiap run): untuk project kita yang belum punya `reported_backer` segar,
cari slug di daftar fundraising `https://alphadrops.net/llms-full.txt` (nama dinormalisasi; **cuma untuk memilih halaman
yang diambil**), ambil `/raises/<slug>`, terima ronde hanya kalau link "Official Website" di halaman itu punya
registrable domain yang sama dengan domain resmi project. Simpan investor (lead ditandai), jumlah, jenis ronde, tanggal,
URL. Maksimal 40 halaman per minggu. Tampil "Menurut AlphaDrops: …"; jadi terverifikasi cuma lewat `vc_backer`.

**Ditunda:** membuat kandidat baru dari 881 data fundraising (butuh crawl ±881 halaman).

### 15.2 Cek link klaim (#42)

- Per link berjenis `claim` atau `app` (tahap `score`): `official` = host-nya domain resmi atau subdomainnya; umur domain
  (RDAP/crt.sh yang ada); phishing (GoPlus yang ada).
- Status per link: `official` ("✓ Domain resmi"), `different_domain` ("⚠ Domain beda dari situs resmi"), `phishing`
  ("Link disembunyikan: terdeteksi phishing"), `unchecked` ("Belum dicek"). Link `phishing` gak pernah dirender sebagai
  link; `different_domain` tetap bisa diklik dengan peringatan.
- **AI Scam Analyst (A2)** juga membaca teks halaman portal klaim (diambil sekali, maks. 20 halaman per run, dicache per
  URL 7 hari). Hasilnya cuma bisa menaikkan risiko (batas keras §13).
- Project ber-deadline `claim` yang masih terbuka mendapat badge "Klaim terbuka · link dicek" kalau semua link klaimnya
  `official`.
- Link `phishing` pada project yang lolos kurasi menaikkan risiko project ke `high` (lewat alasan risiko baru
  `phishing_claim_link`), jadi project keluar dari list.

Hasil cek per link disimpan di tabel `link_checks` (`url` pk, `status`, `checked_at`), baca publik; link yang sama di
beberapa project cukup dicek sekali per run.

### 15.3 Rekam jejak (#43)

- Populasi: project yang **curation lolos pertamanya** terjadi saat project belum `coingecko_listed`, dan sekarang
  `tab = ended` (#40).
- Angka: (a) jumlah yang sekarang `coingecko_listed`; (b) jumlah yang berakhir tanpa token diperdagangkan; (c) jumlah yang
  setelah lolos pernah berisiko `high`/`critical`. Tiga angka + total populasi, tanpa nama project.
- Dihitung harian di pipeline, disimpan di `pipeline_runs.stats` (`track_record_total`, `_listed`, `_no_token`,
  `_risk_raised`).
- Tampil di landing dan halaman list publik **hanya kalau populasi ≥ 10**; sebelum itu gak ditampilkan sama sekali.

### 15.4 "Dicek" (#44)

- `checked_at` = `computed_at` curation terbaru. Baris dan kepala halaman: "Dicek {relatif}" ("hari ini", "kemarin",
  "{n} hari lalu").
- > 48 jam: "Belum dicek ulang sejak {tanggal}" dengan warna peringatan. Project `ended` yang dibekukan (§5.3, > 90 hari)
  menampilkan "Cek terakhir {tanggal}" tanpa warna peringatan.

### 15.5 Publik vs member (#45, #46)

| Isi | Pengunjung | Member |
|---|---|---|
| List kurasi 3 tab (urut "terbaru dicek"), status, risiko, deadline, chain, "Dicek", ringkasan run | ✓ | ✓ |
| Badge sinyal (terverifikasi, "Menurut AlphaDrops", TVL, CoinGecko, sumber kurasi) | ✓ | ✓ |
| Keamanan: 4 cek kunci, A2, cek link klaim | ✓ | ✓ |
| Kontradiksi (A3) | ✓ | ✓ |
| Langkah (terjemahan A6) | ✓ | ✓ |
| Rekam jejak | ✓ | ✓ |
| Level Kelayakan, urutan "paling cuan" (§6.3) | ✗ | ✓ |
| Keputusan AI (A1) | "Khusus member" | ✓ |
| Estimasi effort (A6: menit/hari, modal, gas) | ✗ | ✓ |
| Daily Briefing (A4), Farming Coach (A5), "Tanya AI" | ✗ | ✓ |
| Garapan saya, watchlist, wallet, "Perubahan sejak kunjungan terakhir" | ✗ | ✓ |

- **Dikunci di database**, bukan cuma UI (anon key publik bisa query REST langsung): view publik `public_list` tanpa
  `worth_level`; `curated_list` (dengan `worth_level`) cuma `authenticated`; `ai_analyses` kind `analyst` cuma
  `authenticated`, kind `scam`/`contradictions` publik; terjemahan langkah disimpan terpisah dari hasil Analyst (kolom
  `tasks.text_id`) supaya bisa publik; `curations.reasons` worth dibaca lewat view member.
- Halaman publik bisa di-index; yang gak lolos kurasi tetap `noindex` (§7.3). Root `/` = landing + cuplikan list;
  `/airdrops` = list publik; `/login` tetap; signup tetap mati (#31).
- Bagian khusus member menampilkan "Khusus member" tanpa tombol atau link pendaftaran (#46).
- Gerbang §12 tetap syarat sebelum owner menarik bayaran dari member.

## 16. Identitas, desain, dan gaya tulisan (keputusan #47–#49)

**Nama:** AirdropIQ. Cek 2026-10-10 [FACT, registry Vercel]: airdropiq.ai tersedia ($160/2 tahun), airdropiq.com dipakai
pihak lain. Merek dagang dan handle sosial [UNKNOWN], dicek owner sebelum launch.

**Proses memilih desain:** mockup pertama (gelap, ungu, kartu bulat) ditolak owner sebagai "AI slop". Tiga arah dibuat
dengan isi sama (A laporan riset, B terminal, C sertifikat inspeksi); owner memilih **C**.

**Sistem desain C** (dibangun di Plan 7 Task 3; nilai di bawah adalah sumber kebenaran):

| Token | Nilai |
|---|---|
| Latar / permukaan | `#F7F7F2` / `#FFFFFF` |
| Tinta / teks sekunder / redup | `#111111` / `#2B2B28` / `#3D3D3A` |
| Garis lembut | `#CFCFC8` |
| Aksen (isian saja) / teks aksen kecil | `#FF5A1F` / `#C2410C` |
| Lolos / ended / hati-hati | `#1F7A45` / `#55554F` / `#B45309` |
| Isian peringatan / isian member | `#FFD7C2` / `#FFF1EA` |
| Strip hazard | `repeating-linear-gradient(-45deg, #111111 0 14px, #FF5A1F 14px 28px)` |
| Huruf | Barlow Condensed 800 huruf kapital untuk judul; Barlow 400–700 untuk isi |
| Bentuk | Sudut 0; garis 2 px (kartu), 3 px (header, kontainer utama, tombol), putus-putus untuk "Member only" |
| Cap | Lingkaran bergaris 3–5 px, diputar −10° sampai 10°; "LOLOS 4/4 CEK" hijau, "ENDED" abu, rekam jejak hijau/abu/oranye tua |
| Tema | Terang saja di versi ini |

Elemen yang wajib konsisten: strip hazard di atas tiap halaman, link phishing dibungkus strip hazard dan gak bisa
diklik, tiket bergaris untuk tiap airdrop, bagian halaman project bernomor "01 · …".

**Gaya tulisan:** aturan lengkap ada di Global Constraints Plan 6 (kata terlarang, tanpa em dash, variasi kalimat,
nada santai, campur Inggris yang wajar). Output AI ikut aturan yang sama (Plan 5). Teks yang dikutip di bagian lain spec
ini (mis. "Khusus member", "Sudah berakhir") adalah rancangan awal; teks final mengikuti glosarium Plan 6.

