# Fondasi Kurasi (sub-proyek #1) — Desain

Tanggal: 2026-10-10
Status: **draft, menunggu review owner**
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

**Yang gak dijanjikan:** "dijamin legit" atau "pasti untung". Kurasi mengurangi risiko, gak menghapusnya (prinsip spec v1
§1: gak pernah ada label "AMAN"). Tiap klaim di UI harus bisa ditelusuri ke sinyal dan sumbernya.

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
- Statistik `pipeline_runs.stats`: tambah `curation_checked`, `curation_passed`, `vc_portfolios_failed`.

### 4.5 View `curated_list` (baru)

Turunan `project_list` (security_invoker), cuma project yang curation terbarunya `passed = true`. Menambah kolom
`worth_level` dan ringkasan sinyal (untuk badge). Urutan default di §6.3.

### 4.6 Ekstraksi LLM (versi prompt naik)

Field baru per project. LLM **cuma mengekstrak**, gak menilai:
- `claimed_backers`: `[{investor, quote}]`. Nama investor yang disebut teks, plus kalimat aslinya. Kutipan wajib ada di
  teks sumber (aturan yang sama dengan field lain).
- `capital_required`: `none` | `low` | `high` | `unknown`. Contoh: "deposit min. $1,000" = `high`.

## 5. Pipeline

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

Alasan gagal disimpan (untuk owner dan peringatan di halaman detail).

**Konsekuensi yang diterima owner** [INFERENCE]: `curated_source` itu longgar, hampir semua project dari airdrops.io
memenuhinya. Penyaring utama dalam praktik = risiko; sinyal kuat (VC/TVL/CoinGecko) dipakai untuk ranking dan badge.

### 6.3 `worth()` — potensi dibanding effort

| Faktor | Poin |
|---|---|
| `vc_backer` terverifikasi tier 1 / tier lain | +3 / +2 (diambil yang tertinggi) |
| TVL ≥ $100 jt / ≥ $10 jt | +2 / +1 |
| Belum ada token (tanpa `token_symbol` dan tanpa `coingecko_listed`) | +2 |
| Sinyal dari > 1 sumber independen | +1 |
| `capital_required` high / low / none | −2 / −1 / 0 (`unknown` = 0, disebut di alasan) |
| Task > 8 | −1 |

Level: ≥ 4 `high`, 2–3 `medium`, ≤ 1 `low`. `insufficient_data` kalau satu-satunya sinyal potensi adalah
`curated_source` **dan** `capital_required` = `unknown`.

Bobot dan ambang ini **tebakan awal** [INFERENCE]. Plan menyertakan langkah kalibrasi terhadap data produksi (≥ 33
project saat ini), dan angka akhir dicatat di spec ini.

**Urutan list kurasi:** worth (`high` → `medium` → `low` → `insufficient_data`), lalu sinyal terkuat (VC → TVL →
CoinGecko → sumber kurasi), lalu deadline terdekat, lalu `last_seen` terbaru.

## 7. Tampilan (UI bahasa Inggris)

Halaman di bawah ini nantinya **khusus member** (sub-proyek #2 yang menambah paywall, landing page, dan contoh terbatas).
Sub-proyek #1 membangunnya di route yang sekarang; pemindahan ke balik paywall dikerjakan di #2.

### 7.1 Halaman list (sekarang `/`)
- Sumber data: `curated_list`. Project yang gak lolos gak muncul di list mana pun.
- Baris ringkasan dari run terakhir: "N airdrops checked today · M passed curation".
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
- Eval LLM: kasus baru untuk `claimed_backers` dan `capital_required`; syarat lulus eval v1 tetap berlaku.

## 11. Harus diverifikasi

| # | Item | Dampak kalau buruk |
|---|---|---|
| 1 | Struktur dan ToS halaman portfolio tiap VC kandidat | VC dicoret dari daftar; cakupan `vc_backer` mengecil |
| 2 | Data `/protocols` DefiLlama memuat `url` dan `gecko_id` yang cukup untuk pencocokan domain [INFERENCE dari kode collector] | Sinyal TVL/CoinGecko cuma untuk project DefiLlama |
| 3 | Kalibrasi bobot `worth()` terhadap data produksi | Level worth gak mencerminkan potensi; ubah bobot |
| 4 | Seberapa banyak project lolos per hari. Data run pertama [FACT]: 85 dari 96 project berisiko low/medium (0 high/critical), jadi aturan §6.2 akan meloloskan hampir semua | Kurasi gak terasa menyaring. Diputuskan setelah kalibrasi `worth()`: opsi utamanya list default cuma worth `medium` ke atas, sisanya di tab "All checked" |
| 5 | RootData: owner melaporkan gak ada API gratis (2026-10-10) [FACT dari owner]; CryptoRank Sandbox gak memuat funding [INFERENCE dari review pihak ketiga]; DefiLlama `/raises` berbayar (HTTP 402) [FACT] | Sumber funding lengkap butuh budget; Apify (~$0,002/round) jadi upgrade pertama |
