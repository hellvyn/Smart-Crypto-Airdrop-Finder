# Fondasi Kurasi (sub-proyek #1) — Desain

Tanggal: 2026-10-10
Status: **draft rev. 2, menunggu review owner** (rev. 2: perbaikan skor setelah simulasi terhadap data run pertama)
Dibangun di atas: `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (spec v1, sudah live)

Label: **[FACT]** dari data/kode/run, **[INFERENCE]** kesimpulan dari bukti, **[UNKNOWN]** belum terverifikasi.

---

## 1. Tujuan dan konteks

**Masalah** (dari owner): list v1 terlalu "mentah". Semua orang lihat isi yang sama, info airdrop kurang menarik, dan belum
ada pembeda antara airdrop yang legit dan yang gak jelas.

**Tujuan produk (keputusan owner, direvisi 2026-10-10):** produk **berbayar**. Isi web cuma bisa diakses member yang
bayar; pengunjung lain cuma lihat landing page + contoh terbatas. Ukuran suksesnya: konversi ke berbayar. Target user:
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
| 2 | **Paywall**: landing page + contoh terbatas, pembayaran, akses member-only, top picks, pindah dari Vercel Hobby, ToS/privasi/refund/disclaimer | berikutnya |
| 3 | Track record: hasil nyata airdrop dibanding level Worth it (riset sumber data dulu) | nanti |
| 4 | Checklist task + estimasi effort per wallet | nanti |
| 5 | Link klaim terverifikasi | nanti |
| 6 | Cek eligibility lebih dalam | paling belakang |

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
| 24 | Model akses | Cuma member berbayar yang bisa akses isi web |
| 25 | Pengunjung non-member | Landing page + contoh terbatas (detail di sub-proyek #2) |
| 26 | Alert Telegram | Gak dibikin |
| 27 | Dua jenis peluang | List dipisah jadi tab **"Live now"** (live/announced) dan **"Early bets"** (speculative); `worth()` meranking di dalam tab |
| 28 | Standar tampil | Project cuma tampil kalau cek keamanan kuncinya jalan; paywall baru dinyalakan setelah gerbang kualitas §12 terpenuhi |
| 29 | Bahasa | **Bahasa Indonesia saja** untuk UI web, email, dan semua output AI (menggantikan asumsi v1 "UI bahasa Inggris dulu"). Konten sumber berbahasa Inggris diterjemahkan/diringkas AI |

**Ditolak:** LLM yang menilai legit/worth (gampang ditipu teks scam, gak konsisten, gak bisa dijelaskan); kurasi manual
penuh oleh owner (gak skalabel). API funding berbayar ditunda (lihat §11).

## 4. Model data

### 4.1 Tabel `project_signals` (baru, baca publik)

Satu baris per sinyal per project. Diperbarui tiap run; baris sinyal yang gak ditemukan lagi dihapus.

| Kolom | Isi |
|---|---|
| `project_id` | FK ke `projects`, `on delete cascade` |
| `kind` | `vc_backer`, `tvl`, `coingecko_listed`, `curated_source`, `claimed_backer` |
| `value` | jsonb. `vc_backer`: `{investor, tier}`. `tvl`: `{tvl_usd}`. `coingecko_listed`: `{gecko_id}`. `curated_source`: `{source_kind}`. `claimed_backer`: `{investor, quote}` |
| `source` | `vc_portfolio`, `defillama`, `airdrops_io`, `telegram`, `llm_text` |
| `verified` | `true` hanya untuk sinyal dari sumber independen yang cocok domain. `claimed_backer` **selalu** `false` |
| `observed_at` | waktu sinyal terakhir dicek |

Unik per `(project_id, kind, value->>'investor')` untuk backer, dan per `(project_id, kind)` untuk sinyal lain.

### 4.2 Tabel `curations` (baru, baca publik)

Riwayat, pola sama dengan `risk_assessments`: "terbaru" = `computed_at` terbesar, seri dipecah `seq`.

| Kolom | Isi |
|---|---|
| `project_id` | FK ke `projects` |
| `passed` | boolean |
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
`tab` (`live_now` untuk status live/announced, `early_bets` untuk speculative), `worth_level`, dan ringkasan sinyal (untuk
badge). Urutan default di §6.3.

### 4.6 Ekstraksi LLM (versi prompt naik)

Field baru per project. LLM **cuma mengekstrak**, gak menilai:
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

1. **Cakupan domain resmi.** Cari di mana link website/sosmed project berada di HTML halaman detail airdrops.io
   [INFERENCE: kemungkinan di luar blok `.airdrop-info`…`.airdrop-bottom` yang sekarang diambil] dan ikutkan ke dokumen,
   tetap lewat aturan "URL harus ada di sumber". Target: **≥ 80%** project live/announced dari teks punya domain resmi.
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

Per project aktif, urut:
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
- Dua tab: **"Live now"** (bisa dikerjakan sekarang; default) dan **"Early bets"** (belum ada pengumuman, taruhan awal).
- Baris ringkasan dari run terakhir: "N airdrops checked today · M passed curation".
- Tiap baris menampilkan cakupan cek: "4/4 key safety checks ran".
- Tiap baris: nama, status, level **Worth it**, level risiko, badge sinyal (`VC-backed: Paradigm ✓`, `TVL $45M`,
  `Listed on CoinGecko`, `Curated source`), deadline terdekat.
- Filter: status, risiko, chain (sudah ada) + Worth it.
- Kosong: "No airdrop passed curation today" + jumlah yang dicek.

### 7.2 Halaman detail `/projects/<slug>`
- Bagian **"Why it's listed"**: sinyal, sumber, label verified/claimed, tanggal cek.
- Bagian **"Worth it"**: level + alasan.
- Backer klaim: "Claimed by the project, not verified" + satu kalimat kenapa klaim VC palsu itu modus scam umum.
- Status kedaluwarsa: "Ended (deadline passed)" + deadline dasarnya.

### 7.3 Project yang gak lolos / keluar dari kurasi
- Halaman detail tetap bisa dibuka lewat link langsung (oleh yang punya akses), dengan peringatan di paling atas:
  "Not in the curated list: <alasan>". Halaman diberi `noindex`.
- Watchlist tetap menampilkannya dengan label peringatan yang sama.
- Digest: project di watchlist yang keluar dari kurasi diberitahukan (lewat `project_changes.field = curated`).

## 8. Keamanan dan privasi

- Semua tabel baru RLS on. `project_signals` dan `curations` sementara baca publik, mengikuti tabel tampilan yang ada
  (`projects`, `evidence`, ...). Pembatasan ke member untuk **semua** tabel tampilan dikerjakan di sub-proyek #2 (paywall)
  sekaligus, bukan per tabel di sini. `vc_portfolios` tanpa akses web.
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

- Unit (core): `expireStatus` (termasuk fixture CZR), `curate` (tiap syarat gagal sendiri-sendiri), `worth` (tiap faktor,
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

Sub-proyek #2 (paywall) **gak boleh menerima pembayaran** sebelum semua gerbang ini terpenuhi dan angkanya dicatat di
spec ini. Angka target adalah usulan [INFERENCE]; owner boleh mengubahnya, tapi gak boleh menghapus gerbangnya.

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
