# Smart Crypto Airdrop Finder & Validator — Konteks Brainstorming

Status: **brainstorming belum selesai, spec belum ditulis.** Dokumen ini ringkasan keputusan dan hasil spike
supaya bisa dilanjut di session baru. Ini bukan spec dan bukan izin buat mulai implementasi.

Tanggal: 2026-10-10
Proses: `superpowers:brainstorming`, jalur **Architectural** (project baru, repo masih kosong).

Label:
- **[FACT]**: langsung dari data atau hasil spike
- **[INFERENCE]**: kesimpulan dari bukti
- **[UNKNOWN]**: belum bisa dipastikan

---

## 1. Keputusan yang sudah disepakati

| # | Topik | Keputusan | Catatan |
|---|---|---|---|
| 1 | Pengguna | Owner sendiri **dan** orang lain | Validasi ditampilkan sebagai **skor risiko + alasan**, bukan label "AMAN" |
| 2 | Lingkup validasi | **A** anti-scam, **B** worth it atau gak, **C** cek eligibility wallet | Diusulkan rilis bertahap: Finder+A → B → C |
| 3 | Chain | **Multi-chain dari awal** | Arsitektur pakai **chain adapter**. Inti sistem gak peduli chain, adapter diimplementasi bertahap |
| 4 | Budget operasional | **Hampir $0/bulan** | Free tier + scraping. Scan berkala, bukan real-time. Desain harus gampang naik ke tier berbayar |
| 5 | Antarmuka | **Web dashboard** | Telegram bot ditolak buat v1 |
| 6 | Jenis airdrop | **Semua**, dengan label status | `live` → anti-scam, `diumumin` → eligibility, `spekulatif` → worth it |
| 7 | Sumber data | Gabungan (lihat bagian 2) | **X/Twitter gak dipakai di v1** (API berbayar, scraping rawan diblokir) |
| 8 | LLM | Owner mau pakai **NVIDIA** (`integrate.api.nvidia.com`) | Belum dites pakai API key, lihat bagian 4 |

## 2. Rencana sumber data (setelah spike)

| Fungsi | Sumber | Status dari spike |
|---|---|---|
| Finder: spekulatif | DefiLlama `/protocols`: protocol tanpa token, difilter per kategori, diurutkan dari pertumbuhan TVL | ✅ gratis |
| Finder: live/diumumin | Scraping halaman utama airdrops.io + preview channel Telegram publik `t.me/s/<channel>` yang dikurasi | ✅ bisa diakses. ToS [UNKNOWN] |
| A. Anti-scam | GoPlus (keamanan token, address, phishing) + cek sendiri: umur domain via RDAP, domain yang mirip nama project, URL resmi | ✅ gratis |
| A. Riwayat hack | DefiLlama `/hacks` | ✅ gratis |
| B. Worth it | DefiLlama TVL + CoinGecko (pakai Demo key) + ekstraksi oleh LLM dari teks pengumuman | ⚠️ data funding berbayar |
| C. Eligibility / aktivitas wallet | Blockscout/Etherscan V2 (EVM), Solana RPC, Aptos REST, Sui GraphQL, toncenter (TON), Cosmos REST per chain | campuran, lihat bagian 3 |

## 3. Hasil spike (2026-10-10)

Script spike cuma buat sekali pakai dan **sengaja gak di-commit**.

### Spike 1: sumber utama

| Sumber | Hasil | Temuan |
|---|---|---|
| DefiLlama `/protocols` | ✅ 200, tanpa key | [FACT] 8.691 protocol. 4.116 tanpa token (`gecko_id` kosong & `symbol` "-"). 294 di antaranya TVL > $10M, tapi 8 teratas CEX/aset wrapped (Bitfinex, Bybit, Robinhood, WBTC). [INFERENCE] Wajib filter kategori |
| DefiLlama `/raises`, `/emissions` | ❌ 402 | [FACT] "Upgrade to the paid API plan". Data funding **gak gratis** |
| DefiLlama `/hacks` | ✅ 200 | Database hack, berguna buat skor risiko |
| GoPlus | ✅ 200, tanpa key | [FACT] 46 chain di `supported_chains` (EVM + Solana). Token security 36 field. Address security jalan. **Domain palsu baru `claim-uniswap-airdrop.xyz` → `phishing_site: 0`**. [INFERENCE] Pengecekan phishing berbasis daftar domain yang sudah dilaporkan, jadi domain baru lolos. Perlu heuristik sendiri |
| CoinGecko tanpa key | ⚠️ | [FACT] Request ke-2 kena 429, `x-ratelimit-limit: 2`, 12/12 request beruntun 429. [INFERENCE] Butuh Demo key gratis + cache. IP sandbox yang dipakai bareng mungkin memperparah |
| Blockscout (eth) | ✅ | [FACT] `is_verified`, alamat creator, counters wallet, txlist gaya Etherscan. Header limit v2 180, endpoint gaya Etherscan 10 |
| RDAP | ✅ | [FACT] Tanggal registrasi kebaca buat `.com` (verisign), `.org` (PIR), `.xyz` (centralnic) |
| Telegram `t.me/s/` | ✅ | [FACT] 20 pesan per halaman + timestamp + link pagination `?before=` |
| Solana RPC publik | ✅ | [FACT] Tier `free`. Limit metode `getSignaturesForAddress` 10. 15/15 request beruntun lolos |
| airdrops.io | ✅ | [FACT] `robots.txt` gak melarang halaman utama, ~49 link kandidat (sebagian bukan airdrop). RSS isinya artikel atau panduan, bukan daftar airdrop |

### Spike 2: chain non-EVM

| Chain | Hasil | Temuan |
|---|---|---|
| Aptos (`api.mainnet.aptoslabs.com`) | ✅ | [FACT] Transaksi per akun kebaca. 15/15 request beruntun lolos |
| Sui JSON-RPC (`fullnode.mainnet.sui.io`) | ❌ | [FACT] "JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL" |
| Sui GraphQL (`graphql.mainnet.sui.io`) | ✅ terhubung | [FACT] Checkpoint & transaksi kebaca. Di query uji, `sender` bernilai `null`. [UNKNOWN] Query riwayat transaksi per address belum diverifikasi |
| GoPlus Sui | ✅ | [FACT] `/api/v1/sui/token_security` jalan |
| TON (`toncenter.com`) tanpa key | ⚠️ | [FACT] 8/10 request beruntun 429. [INFERENCE] Butuh API key gratis toncenter |
| Cosmos (`rest.cosmos.directory`) | ⚠️ tergantung chain | [FACT] cosmoshub ✅ (546 tx per sender). osmosis ❌ "transaction indexing is disabled". celestia ❌ "search query too broad". [UNKNOWN] Butuh indexer lain buat Cosmos |

### NVIDIA (tanpa key)

| Cek | Hasil |
|---|---|
| `GET /v1/models` | [FACT] 200, 80 model terdaftar |
| `POST /v1/chat/completions` `meta/llama-3.3-70b-instruct` | [FACT] 410: model sudah end of life per 2026-08-26 |
| `POST /v1/chat/completions` `nvidia/llama-3.1-nemotron-70b-instruct` | [FACT] 404 "Function ... Not found for account" (dipanggil tanpa key) |

[INFERENCE] Model yang muncul di daftar belum tentu bisa dipanggil, dan model bisa end of life. Desain harus bisa ganti model lewat
config dan punya fallback.

## 4. Yang masih [UNKNOWN] (harus diverifikasi)

1. **NVIDIA dengan API key**: model mana yang bisa dipanggil, kualitas ekstraksi JSON, limit free tier, syarat pemakaian buat produk publik
2. Query aktivitas address di Sui GraphQL
3. API key gratis toncenter (TON): limit
4. Indexer Cosmos buat chain yang node REST-nya gak mengindeks transaksi
5. Etherscan V2 (butuh key): chain apa saja yang masuk free tier
6. ToS airdrops.io soal scraping
7. Syarat free tier hosting (Vercel, GitHub Actions, database) buat pemakaian komersial

## 5. Lanjutan di session baru

Prasyarat (sudah atau sedang dikerjakan owner):
- `NVIDIA_API_KEY` disimpan di settings environment (Network secrets atau env var). **Jangan ditempel di chat.**
- Domain allowlist sudah berisi: `api.llama.fi`, `api.gopluslabs.io`, `api.coingecko.com`, `eth.blockscout.com`,
  `rdap.org`, `rdap.verisign.com`, `rdap.publicinterestregistry.org`, `rdap.centralnic.com`, `t.me`,
  `api.mainnet-beta.solana.com`, `airdrops.io`, `www.airdrops.io`, `fullnode.mainnet.sui.io`, `graphql.mainnet.sui.io`,
  `toncenter.com`, `api.mainnet.aptoslabs.com`, `rest.cosmos.directory`, `integrate.api.nvidia.com`

Langkah berikutnya, urut:
1. **Spike LLM NVIDIA**: pakai `NVIDIA_API_KEY`, ambil daftar model, pilih 2–3 kandidat, tes ekstraksi info airdrop dari
   teks pengumuman asli (misalnya pesan dari `t.me/s/...` atau halaman airdrops.io) ke format JSON (nama project, chain, status, task, deadline,
   URL resmi). Catat latensi, error, limit, dan model yang end of life.
2. (Opsional) Tes riwayat address di Sui GraphQL.
3. Lanjut brainstorming: pertanyaan klarifikasi yang tersisa (misalnya akun user atau anonim, privasi wallet, frekuensi scan),
   lalu 2–3 opsi pendekatan arsitektur, desain per bagian, dan spec di `docs/superpowers/specs/`.
