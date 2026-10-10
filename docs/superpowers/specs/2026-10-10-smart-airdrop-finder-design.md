# Smart Airdrop Finder & Validator — Desain v1

Tanggal: 2026-10-10
Status: **draft, menunggu review owner**
Sumber keputusan: `docs/brainstorming/2026-10-10-airdrop-finder-context.md` (keputusan #1–#14, Spike 1–3)

Label: **[FACT]** dari data/spike, **[INFERENCE]** kesimpulan dari bukti, **[UNKNOWN]** belum terverifikasi.

---

## 1. Tujuan

Web dashboard yang tiap hari ngumpulin info airdrop crypto, nilai **risiko scam** tiap project dengan **alasan yang bisa dicek**,
dan ngingetin user soal deadline di watchlist mereka.

**Pengguna:** owner dan publik. Skala v1: puluhan sampai ratusan user.

**Kriteria sukses v1**
1. Daftar airdrop diperbarui tiap hari dari sumber yang ditentukan.
2. Tiap project punya level risiko + daftar alasan + cakupan pemeriksaan. Gak pernah ada label "AMAN".
3. Gak ada deadline di watchlist yang kelewat tanpa pemberitahuan, **kecuali** deadline yang diumumin < 24 jam sebelumnya
   (risiko yang diterima di keputusan #12).

## 2. Lingkup

**Masuk v1**
- Finder: status `speculative` / `announced` / `live` / `ended`
- Skor risiko anti-scam (A)
- Akun email + password, watchlist, daftar wallet
- Email digest harian (termasuk deadline dalam 48 jam)
- Cek aktivitas wallet **khusus EVM**, on-demand
- UI bahasa Inggris

**Gak masuk v1** (urutan rilis berikutnya)
1. Adapter chain non-EVM (Solana, Aptos, Sui, TON, Cosmos)
2. B: penilaian "worth it" (butuh data funding, yang ternyata berbayar)
3. Cek interaksi wallet dengan kontrak project
4. Monetisasi (field `plan` sudah disiapin)
5. Pelacakan wallet otomatis di background, web push, Telegram bot, sumber X/Twitter

## 3. Arsitektur

```
GitHub Actions (cron harian, TypeScript)          Supabase
┌───────────────────────────────────┐            ┌──────────────────┐
│ collect → diff → extract (LLM) →  │── tulis ──▶│ Postgres         │
│ merge → score → notify            │◀── baca ───│ Auth email+pw    │
└───────────────────────────────────┘            └────────▲─────────┘
                                                          │ anon key + RLS
                              Web Next.js (dashboard, watchlist, wallet)
                              └─ cek wallet on-demand → ChainAdapter EVM
```

**Struktur repo** (satu repo, TypeScript)

| Folder | Isi |
|---|---|
| `packages/core` | Tipe data, skema (validasi runtime), interface `ChainAdapter`, pembersih URL, parser deadline, aturan risiko, penggabung entitas. Gak boleh ada akses jaringan langsung |
| `pipeline/` | Job harian: collector, ekstraktor LLM, penilai risiko, notifier |
| `apps/web` | Next.js: UI + API route cek wallet |

**Prinsip**
- Web gak pernah manggil LLM atau scraping.
- Web cuma baca database, plus satu panggilan on-demand ke adapter wallet.

**Hosting**
- Pipeline: GitHub Actions. [FACT] Repo ini public, jadi menitnya unlimited menurut sumber sekunder.
- Database dan auth: Supabase Free.
- Web: lihat §12, karena host-nya belum dipilih.

## 4. Pipeline harian

Jalan sekali sehari, default **23:00 UTC (06:00 WIB)**. Jadwal diatur lewat config. Tiap tahap dan tiap sumber terisolasi: satu
gagal, yang lain tetap jalan. Job aman diulang di hari yang sama.

### 4.1 Collector

| Sumber | Cara | Catatan |
|---|---|---|
| airdrops.io | Halaman utama → halaman detail tiap airdrop | Ambil **konten utama saja** (buang sidebar "related airdrops"). Resolve redirect `/visit/<kode>/` ke URL tujuan |
| Telegram | `t.me/s/<channel>` | Daftar channel dikurasi owner di config. Awal: `airdrops_io`. Paginasi `?before=` sampai pesan yang sudah pernah diambil |
| DefiLlama | `/protocols` | Kandidat `speculative`: tanpa token (`gecko_id` kosong dan `symbol` "-"), TVL > $10M, diurutkan dari pertumbuhan TVL. Kategori yang dikecualikan diatur di config (awal: CEX dan aset wrapped). Data terstruktur, **gak lewat LLM** |

Semua URL dilewatin **pembersih URL** sebelum disimpan. Pembersih ini buang parameter dan path referral (`ref`, `/r/<kode>`,
`utm_*`, dan pola lain yang diatur di config), lalu nandain `referral_stripped`.
[FACT, Spike 3] Redirect dari airdrops.io bawa kode referral.

### 4.2 Cek perubahan

- Teks bersih di-hash.
- LLM cuma dipanggil buat dokumen baru atau yang hash-nya berubah.

### 4.3 Ekstraktor LLM

**Provider:** NVIDIA (`integrate.api.nvidia.com`).

**Urutan model fallback** (diatur di config, tiap model punya parameternya sendiri):

| Urutan | Model | Parameter khusus |
|---|---|---|
| 1 | `z-ai/glm-5.3-flash` | `reasoning_effort: "low"` |
| 2 | `moonshotai/kimi-k3` | `chat_template_kwargs: {thinking: false}` |
| 3 | `google/gemma-4-31b-it` | – |

**Aturan pemanggilan** (semua dari temuan Spike 3)
- Selalu `stream: true`, karena request non-streaming kena 502 di ~30 detik.
- Decode respon sebagai UTF-8, karena respon SSE gak nyantumin charset.
- Sukses = `finish_reason == "stop"` **dan** JSON lolos validasi skema. HTTP 200 aja gak cukup.
- Kalau gagal (error, 429, konten kosong, `length`, atau skema gak valid), lanjut ke model berikutnya. Kalau semua model gagal,
  dokumen ditandai `pending` dan diulang di run berikutnya.
- Maksimal 3 panggilan paralel. Kalau kena 429, tunggu dengan jeda yang makin panjang (backoff).
- Circuit breaker per run: model yang gagal 3 kali berturut-turut (timeout, 5xx, atau 429 setelah retry habis) dilewati
  sampai run selesai. Balasan HTTP 200 apa pun (termasuk JSON rusak) dihitung sukses, karena endpoint-nya hidup.
- Urutan diubah 2026-10-10 (glm duluan): di run produksi pertama, kimi-k3 timeout 180 detik di semua panggilan sejak
  14:53 UTC, sedangkan glm-5.3-flash menjawab 22 dari 22 panggilan dalam 2–31 detik.
- Output yang gak lolos validasi **gak pernah** ditampilin ke user.
- Tiap panggilan dicatat di tabel `extractions`: model, versi prompt, latensi, `finish_reason`, JSON mentah.

**Kontrak output** (versi prompt disimpan di `extractions.prompt_version`)

```
{ is_airdrop_content: boolean,
  projects: [{
    name, token_symbol | null, chains: string[],
    status: live | announced | speculative | ended | unknown,
    status_evidence: string,          // kutipan dari teks
    tasks: string[],
    deadlines: [{ kind: claim | snapshot | campaign_end | withdraw_funds | tge | other,
                  date: YYYY-MM-DD | null,
                  precision: exact | approximate | month | quarter,
                  text: string }],
    official_urls: string[],          // harus muncul verbatim di teks
    confidence: number }] }
```

**Validasi setelah LLM** (deterministik)
- Tiap `official_urls` harus ada di teks sumber. Kalau gak ada, URL itu dibuang.
- Tanggal tanpa tahun dihitung relatif ke tanggal publikasi dokumen.

### 4.4 Penggabung entitas

- Kunci penggabungan: nama yang dinormalisasi (huruf kecil, tanpa tanda baca, tanpa kata "airdrop") **dan** domain resmi.
- Nama sama tapi domain beda → **gak digabung**. Domain itu ditandai sebagai kandidat domain mirip (lookalike), lalu masuk ke
  penilai risiko.
- Bukti dari tiap sumber disimpan terpisah di tabel `evidence`.

### 4.5 Status project

- Status diambil dari bukti **terbaru**. Tanggal bukti: `published_at` dokumen; kalau gak ada, tanggal "Updated" di halaman
  (airdrops.io); kalau itu juga gak ada, `fetched_at`. Status boleh turun (contoh: Abstract jadi `ended`).
- Status `unknown` dari LLM ditampilin sebagai "Unconfirmed" dan gak pernah menimpa status yang sudah ada.
- Kalau dua bukti di hari yang sama bertentangan, project dikasih flag `conflict` dan dua-duanya ditampilin.

### 4.6 Penilai risiko

Lihat §6.

### 4.7 Notifier

Lihat §8.

## 5. Model data (Postgres di Supabase)

**Data dari pipeline**

| Tabel | Kolom penting |
|---|---|
| `documents` | sumber, URL, `fetched_at`, `published_at`, `content_hash`, teks (dihapus setelah 90 hari, hash tetap disimpan), status ekstraksi (`done`/`pending`/`not_airdrop`) |
| `extractions` | dokumen, model, `prompt_version`, JSON mentah, `finish_reason`, latensi |
| `projects` | slug, nama, token, chain, domain resmi, status, flag `conflict`, `first_seen`, `last_seen` |
| `evidence` | project, dokumen, field, nilai, kutipan asli |
| `deadlines` | project, jenis, tanggal, presisi, teks asli, evidence |
| `tasks` | project, deskripsi, evidence |
| `links` | project, URL bersih, jenis (website/app/docs/claim/social), `referral_stripped` |
| `risk_assessments` | project, level, poin internal, `reasons[]` (kode, keparahan, pesan, sumber data), cakupan cek, `computed_at` |
| `project_changes` | project, field (`status`/`risk_level`), nilai lama, nilai baru, waktu. Dipakai digest buat nampilin perubahan |
| `pipeline_runs` | waktu mulai dan selesai, angka agregat per tahap |

Daftar sumber (channel Telegram, kategori DefiLlama yang dikecualikan) disimpan di config pipeline, bukan di tabel.

**Data user** (Row Level Security aktif: user cuma bisa baca dan ubah datanya sendiri)

| Tabel | Kolom penting |
|---|---|
| `profiles` | user, `plan` (default `free`), digest aktif, opsi "airdrop baru", timezone, `unsubscribe_token` (acak) |
| `watchlist` | user, project |
| `wallets` | user, alamat, `chain_family` (`evm`), label |
| `wallet_checks` | alamat, chain, hasil, `checked_at` (cache, TTL 6 jam) |
| `wallet_check_requests` | user, waktu. Buat batas cek per jam |
| `notification_log` | user, jenis, referensi, `sent_at` |

**Estimasi kapasitas** [INFERENCE, dari ukuran teks di spike]
- ~20–50 dokumen per hari × 1–10 ribu karakter.
- Dengan retensi teks 90 hari, totalnya puluhan MB. Masih jauh di bawah batas Supabase Free 500 MB.

## 6. Skor risiko anti-scam

**Prinsip**
1. Risiko scam dipisah dari kepastian airdrop. UI nampilin dua badge: **Risk** dan **Status**.
2. Output berupa **level**: `Low` / `Medium` / `High` / `Critical` / `Insufficient data`, plus daftar alasan. **Gak pakai angka
   0–100**, karena bobotnya belum dikalibrasi. Poin internal tetap disimpan buat kalibrasi nanti.
3. Satu aturan Kritis cukup buat bikin level jadi `Critical`, berapa pun poin dari aturan lain.
4. Cakupan cek selalu ditampilin, misalnya "4/6 checks ran; domain age unavailable". Cek yang gagal **gak dihitung aman**.

**Aturan v1**

| Level | Aturan | Sumber |
|---|---|---|
| Critical | Minta seed phrase atau private key; minta kirim crypto buat "klaim"; `phishing_site=1`; token honeypot | Task dan teks (kata kunci + hasil LLM), GoPlus |
| High | Domain link klaim ≠ domain resmi **dan** umurnya < 30 hari; domain mirip nama project tapi bukan domain resmi; owner token bisa mint atau ngubah saldo; creator kontrak ditandai berbahaya | RDAP, heuristik, GoPlus |
| Medium | Domain < 90 hari; kontrak belum diverifikasi; cuma 1 sumber tanpa akun sosial resmi; flag `conflict`; ada riwayat hack | RDAP, Blockscout, DefiLlama `/hacks` |
| Info | Status `speculative`, token belum ada | Ekstraksi |

**Kenapa perlu heuristik sendiri:** [FACT, Spike 1] GoPlus gak nangkep domain phishing yang baru (`claim-uniswap-airdrop.xyz` →
`phishing_site: 0`).

**Heuristik domain mirip:** domain yang bukan domain resmi, tapi mengandung atau sangat mirip nama project (jarak edit kecil), dan/atau
mengandung kata `claim`, `airdrop`, `reward`, atau `drop`.

**Frekuensi dan cache:** GoPlus, RDAP, DefiLlama, dan Blockscout di-refresh harian, di-cache per domain atau per alamat.

## 7. Cek aktivitas wallet (EVM)

- Interface di `packages/core`:
  `ChainAdapter { family, chains, isValidAddress(addr), getActivity(addr, chain) → ActivitySummary }`
- `ActivitySummary`: chain, jumlah tx, tx pertama, tx terakhir, jumlah bulan aktif, sumber data, `fetched_at`.
- Adapter EVM pakai provider per chain yang diatur di config (URL Blockscout atau Etherscan V2). Chain awal: Ethereum lewat
  Blockscout (sudah dites di spike). Chain lain ditambah setelah provider-nya diverifikasi (§12).
- UI nyebut **"wallet activity"**, gak pernah "eligible". Di sebelahnya ada link ke checker resmi (`links` jenis `claim`) bareng
  badge risikonya. Sistem **gak pernah** ngirim alamat wallet user ke checker pihak ketiga.
- Hasil di-cache 6 jam per alamat + chain. Batas cek default 10 per user per jam, diatur lewat config.
- Kalau chain project bukan EVM (misalnya Sui), UI nampilin "chain not supported yet".
- Kalau provider error atau kena limit: tampilkan "data unavailable, try again later". Jangan tampilkan angka nol.

## 8. Notifikasi email

> **Diganti keputusan #31–#34, lihat spec kurasi** (`2026-10-10-curation-foundation-design.md`): gak ada email sama
> sekali. Digest dihapus (#32), perubahan ditampilkan di web (#34), pendaftaran ditutup dan user ditambah owner (#31).
> Isi di bawah dibiarkan sebagai catatan sejarah v1.

- Maksimal **1 email per user per hari**: digest yang dikirim setelah pipeline selesai. Dikirim cuma kalau ada isinya.
- Isi digest, berurutan:
  1. Deadline dalam 48 jam di watchlist. Cuma deadline dengan presisi `exact` atau `approximate`, dan jenis `claim`, `snapshot`,
     `campaign_end`, atau `withdraw_funds`.
  2. Perubahan status atau level risiko di watchlist.
  3. Airdrop baru hari ini, kalau user nyalain opsinya.
- Provider: **Brevo** sebagai default. Provider bisa diganti lewat config (misalnya Resend).
  [FACT, sumber sekunder] Kuota gratis Brevo 300/hari, Resend 100/hari. Deliverability dua-duanya [UNKNOWN].
- Email verifikasi dan reset password dari Supabase Auth lewat SMTP provider yang sama. **~20% kuota harian disisain** buat email
  auth.
- Kalau kuota gak cukup, prioritasnya: user dengan deadline dekat → perubahan risiko → sisanya. Yang gak kebagian dicatat sebagai
  angka di `pipeline_runs`.
- `notification_log` nyegah email dobel kalau job diulang.
- Tiap email punya link berhenti langganan.

## 9. Akun, privasi, dan keamanan

> **Diganti keputusan #31–#34, lihat spec kurasi** (`2026-10-10-curation-foundation-design.md`): gak ada signup,
> verifikasi email, atau reset password lewat email. Owner menambah user (Auto Confirm) dan mereset password lewat
> Supabase Dashboard, runbook di `docs/ops/web.md` §4. Key email gak ada lagi di GitHub Secrets. Bagian privasi log,
> hapus data, dan anon key di bawah tetap berlaku.

- **Auth:** Supabase Auth email + password, dengan verifikasi email dan reset password. Gak bikin auth sendiri.
- **Privasi log:** [INFERENCE, keyakinan tinggi, cek di §12] log GitHub Actions di repo public bisa dibaca publik. Jadi:
  - Pipeline **gak boleh** nge-log email, alamat wallet, atau isi watchlist. Log cuma berisi angka agregat.
  - Wallet gak pernah diproses di pipeline.
- **Hapus data:** user bisa hapus wallet dan akunnya sendiri. Penghapusan ikut ke `wallet_checks` dan `notification_log`.
- **Secret:**
  - NVIDIA key, Supabase service role key, dan key email disimpan di GitHub Secrets.
  - Web cuma pegang Supabase anon key. Service role key gak pernah sampai ke browser.
- **Link di UI:** yang ditampilin selalu versi yang udah dibersihin dari referral.

## 10. Web dashboard (Next.js, bahasa Inggris)

| Halaman | Isi |
|---|---|
| Daftar airdrop | Filter: status, level risiko, chain. Urutan default: deadline terdekat, lalu yang terbaru. Banner kalau data > 36 jam |
| Detail project | Badge Status + Risk, alasan risiko + cakupan cek, deadline (jenis + presisi), task, link resmi, kutipan bukti + link sumber, flag konflik |
| Watchlist | Project yang diikuti user |
| Wallets | Tambah dan hapus alamat EVM, cek aktivitas per chain project |
| Settings | Digest on/off, opsi "airdrop baru", timezone, hapus akun |
| Auth | Daftar, login, verifikasi email, reset password |

## 11. Penanganan error dan testing

**Error**
- Tiap sumber dan tiap tahap pipeline terisolasi. Hasilnya dicatat di `pipeline_runs`.
- Kalau run harian gagal, GitHub Actions nandain workflow gagal.
- Dashboard selalu nampilin "last updated" supaya data yang basi kelihatan.

**Test**
1. **Unit test `packages/core`** (tanpa jaringan): pembersih URL, parser deadline + presisi (termasuk tanggal tanpa tahun dan
   kata "approximately"), aturan risiko per level, penggabung entitas (nama sama dengan domain beda gak boleh digabung).
2. **Fixture test collector:** pakai potongan HTML dan teks dari Spike 3 (halaman airdrops.io dan pesan Telegram).
3. **Eval set LLM:** 8 kasus Spike 3 + ground truth. Dijalanin manual tiap kali model atau prompt diganti. Syarat lulus:
   - URL halusinasi = 0
   - Kasus negatif (hack Ledger) ditolak
   - Kasus Abstract = `ended`
   - Akurasi status gak turun dari baseline run sebelumnya

## 12. Harus diverifikasi sebelum atau di awal implementasi

| # | Item | Dampak kalau hasilnya buruk |
|---|---|---|
| 1 | ~~ToS NVIDIA API trial buat produk publik~~ (dicek owner 2026-10-10, oke) + limit RPM resmi | Ganti provider LLM. Adapter sudah dirancang buat itu |
| 2 | Host web: owner pilih Vercel Hobby dulu (2026-10-10). Hobby khusus non-komersial: sebelum monetisasi, pindah ke Vercel Pro atau host lain | Upgrade tier atau pindah host |
| 3 | Apakah workflow terjadwal di repo public dimatiin setelah ~60 hari tanpa aktivitas | Perlu mekanisme keep-alive |
| 4 | Apakah job harian cukup buat nyegah Supabase Free di-pause (7 hari idle) | Perlu ping terpisah |
| 5 | Log GitHub Actions di repo public bisa dibaca publik | Udah diantisipasi di §9 |
| 6 | Limit dan syarat Brevo/Resend dari halaman resmi | Ubah prioritas kuota atau tier |
| 7 | Limit GoPlus tanpa key | Perketat cache |
| 8 | Instance Blockscout atau cakupan Etherscan V2 buat chain EVM selain Ethereum | Daftar chain v1 menyesuaikan |
| 9 | ~~ToS airdrops.io soal scraping~~ (dicek owner 2026-10-10, oke) | Kurangi atau ganti sumber |
| 10 | Seberapa telat cron GitHub dari jadwal | Geser jam job |
| 11 | Sumber data scam terverifikasi buat ngukur false negative | Akurasi skor gak bisa diklaim sampai ada |
