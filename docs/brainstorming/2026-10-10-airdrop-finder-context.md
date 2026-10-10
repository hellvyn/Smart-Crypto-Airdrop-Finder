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
| 8 | LLM | Owner mau pakai **NVIDIA** (`integrate.api.nvidia.com`) | Sudah dites pakai key (Spike 3). Kandidat: kimi-k3 → glm-5.3-flash → gemma-4-31b-it. ToS buat produk publik [UNKNOWN] |
| 9 | Akun user | **Pakai akun (login)** | Dipilih owner. Claude awalnya nyaranin anonim + simpan lokal |
| 10 | Fungsi akun di v1 | **Sinkron watchlist & wallet + notifikasi email** (digest harian + reminder H-1 deadline). Cek wallet **on-demand** (di-cache) | Ditunda: monetisasi (tapi field `plan` disiapin), pelacakan wallet otomatis di background, web push. Limit free tier layanan email [UNKNOWN] |

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

### Spike 3: LLM NVIDIA pakai API key (2026-10-10)

Script dan output mentah sekali pakai, **gak di-commit**. Ground truth dinilai manual oleh Claude dari teks sumber.
Sampel kecil (8 teks, 1 run per kombinasi), jadi angka di bawah **indikatif, bukan benchmark**.

**Input uji** (teks asli, diambil 2026-10-10):
- 4 halaman airdrops.io: DeepBook (Sui, claim live), Variational (Arbitrum, points), Abstract (chain ditutup, tim batal bikin token), Raycash (Polygon, points tanpa token)
- 4 pesan `t.me/s/airdrops_io`: $FLOP (testnet), $INK (rumor), berita hack Ledger (kasus negatif, bukan airdrop), weekly radar (28 project dalam 1 pesan)
- Skema output: `is_airdrop_content` + `projects[]` {name, token_symbol, chains, status live/announced/speculative/ended, status_evidence, tasks, deadline, deadline_text, official_urls, confidence}

**Ketersediaan model** (dari 15 kandidat chat yang di-ping):

| Hasil | Model |
|---|---|
| ✅ Bisa dipanggil | `moonshotai/kimi-k3`, `z-ai/glm-5.3`, `z-ai/glm-5.3-flash`, `google/gemma-4-31b-it`, `openai/gpt-oss-20b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3-ultra-550b-a55b`, `meta/muse-glimmer-30b` |
| ❌ 404 "Function not found for account" (pakai key) | `nvidia/llama-3.1-nemotron-70b-instruct`, `nvidia/llama-3.1-nemotron-ultra-253b-v1`, `nvidia/nemotron-nano-3-30b-a3b`, `moonshotai/kimi-k2.6`, `mistralai/mistral-large-2-instruct` |
| ❌ 502 di semua 18 request (ping, non-streaming, streaming) | `deepseek-ai/deepseek-v4.1-flash` |

**Temuan teknis**

| # | Temuan | Label |
|---|---|---|
| 1 | Mode non-streaming: **semua 502 "upstream request failed" jatuh di 30,1–30,8 detik**, semua yang sukses < 27 detik. Pakai `stream: true`, 5/6 kasus yang tadinya 502 sukses dengan total waktu sampai 113 detik (TTFB 1–5 detik) | [FACT] |
| 2 | Ada timeout ~30 detik buat byte pertama, entah di gateway NVIDIA atau proxy sandbox. **Wajib streaming** | [INFERENCE] |
| 3 | Gagal diam-diam: HTTP 200 tapi konten kosong. Penyebabnya: stream putus tanpa `finish_reason` (nemotron-ultra), `finish=stop` dengan konten kosong (kimi-k3, 2 dari 4 percobaan di weekly radar), dan `finish=length` karena token habis buat reasoning. Validasi harus cek `finish_reason == stop` + JSON valid, gak cukup lihat HTTP 200 | [FACT] |
| 4 | Model reasoning ngabisin 15–34 ribu karakter buat "mikir". Di input panjang, `max_tokens` 4096–8192 habis sebelum JSON keluar | [FACT] |
| 5 | **Switch buat matiin reasoning beda per model.** `chat_template_kwargs: {thinking/enable_thinking: false}` jalan di kimi-k3, nemotron-super, nemotron-lightning, dan nemotron-ultra, tapi gak ngaruh di GLM. `reasoning_effort: "low"` jalan di GLM-5.3, GLM-5.3-flash, gpt-oss, dan muse, tapi gak ngaruh di nemotron-super dan nemotron-lightning. Jadi config harus per model | [FACT] |
| 6 | Nemotron-lightning dan nemotron-ultra (dalam mode reasoning) nulis proses mikir di field `content`, makanya JSON gak bisa di-parse | [FACT] |
| 7 | `response_format: json_object` gak nyelesain masalah reasoning yang ngabisin token (GLM, nemotron tetap `length`) | [FACT] |
| 8 | Respon SSE gak nyantumin charset. Client harus maksa UTF-8, kalau gak karakter jadi rusak (`Ã\x97`) | [FACT] |
| 9 | 429 "Too Many Requests" muncul 3× dari ~200 request, waktu 6–8 request jalan paralel. **Gak ada header rate-limit** di respon | [FACT] |
| 10 | Limit free tier: sumber sekunder (forum dan blog) nyebut ~40 RPM, tapi belum ada dokumen resmi. Dokumen ToS resmi gak bisa diakses dari sandbox (domain diblokir) | [UNKNOWN] |

**Kualitas ekstraksi** (matriks streaming, max_tokens 4096, reasoning default)

| Model | Sukses /8 | Status benar /dinilai (+parsial) | Jebakan Abstract (`ended`) | Weekly radar (28 project) | p50 latensi |
|---|---|---|---|---|---|
| kimi-k3 | 7 (1× 429) | 5/5 | gak kenilai (429) | 22–25 project, deadline 5/6 | 9,7 s |
| glm-5.3 | 7 | 5/6 (+1) | ✅ | 27 project, deadline 6/6 (pakai `reasoning_effort: low`) | 44 s |
| glm-5.3-flash | 7 | 5/6 (+1) | ✅ | 23 project, deadline 5/6 (pakai `low`) | 43 s |
| gemma-4-31b-it | 8 | 4/6 (+2) | ✅ | 22–24 project, deadline 4/6 | 9,8 s |
| muse-glimmer-30b | 8 | 5/6 (+1) | ✅ | 12–15 project (recall rendah) | 68 s |
| nemotron-3-ultra | 8 | 2/6 (+3) | ❌ `speculative` | 19–28 project, deadline 4–5/6 | 25 s |
| gpt-oss-20b | 7 | 2/6 (+2) | ❌ `speculative` | 6–23 project, gak stabil | 5,2 s |
| nemotron-3-super | 6 | 2/4 (+1) | ❌ `speculative` | 14 project (pakai `nothink`) | 12,9 s |
| nemotron-3.5-lightning | 8 | 1/2 (+1), 5 parse gagal | – | 20 project (pakai `nothink`) | 136 s |

"Parsial" = jawab `announced` padahal seharusnya `speculative`/`live`. Kesalahan paling sering: $FLOP/$INK (testnet/rumor) dilabelin `announced`.

**Temuan kualitas yang ngaruh ke desain**

- [FACT] **0 URL halusinasi** di semua output: setiap `official_urls` ada persis di teks sumber.
- [FACT] URL resmi di airdrops.io disembunyiin di balik redirect `/visit/<kode>/`, dan tujuannya bawa **kode referral airdrops.io** (`?ref=OMNISHUKOC2R`, `?ref=qYPVZrJw`, `/r/V8P3TX`). Model ikut nyimpen link itu. [INFERENCE] Pipeline harus resolve redirect lalu buang parameter referral **sebelum** dikirim ke LLM dan sebelum ditampilin ke user.
- [FACT] Halaman Abstract nulis "Airdrop ends 2026-12-15" di header, padahal isinya bilang tim batal bikin token dan tanggal itu cuma tanggal chain dimatiin. Hampir semua model ngisi `deadline=2026-12-15`. [INFERENCE] Skema butuh jenis deadline (claim / snapshot / tarik dana / kampanye), gak cukup satu field.
- [FACT] Halaman airdrops.io punya sidebar "related airdrops". gpt-oss nyedot 6 project dari situ sebagai entri terpisah. [INFERENCE] Scraper harus motong cuma konten utama.
- [FACT] Halaman sumber bisa kontradiktif (Variational: alokasi 50% vs 32%, "TGE Q4 2026" vs "belum umumin tanggal TGE"). [INFERENCE] Output LLM tetap harus dianggap klaim, bukan fakta, dan ditampilin dengan `status_evidence`.
- [FACT] Kasus negatif (berita hack Ledger) ditolak dengan benar oleh **semua** model yang ngasih jawaban.
- [FACT] "approximately Oct 11" diubah jadi tanggal pasti oleh hampir semua model, padahal aturan prompt bilang `null`. Aturan soal deadline perkiraan kurang dipatuhi.

**Rekomendasi kandidat** [INFERENCE, confidence sedang: sampel kecil, 1 run]

1. **`moonshotai/kimi-k3`** (utama): status paling akurat, cepat (p50 ~10 s). Risiko: kadang balikin konten kosong dengan `finish=stop`, dan paling sering kena 429. Pakai `thinking: false` buat input panjang.
2. **`z-ai/glm-5.3-flash`** dengan `reasoning_effort: low` (fallback 1): lolos jebakan Abstract, recall weekly radar bagus, ~40 s.
3. **`google/gemma-4-31b-it`** (fallback 2): non-reasoning, 8/8 sukses, lolos jebakan Abstract, cepat. Lebih sering salah ke `announced`, dan TTFB ~20 s di input panjang (aman cuma kalau streaming).

Implikasi buat arsitektur: LLM dipanggil lewat adapter dengan config per model (nama model, switch reasoning, max_tokens), streaming, validasi `finish_reason` + skema JSON, retry ke model fallback, dan antrian dengan batas konkurensi kecil (≤ 4) karena 429 tanpa header.

## 4. Yang masih [UNKNOWN] (harus diverifikasi)

1. **NVIDIA**: ToS resmi API trial (boleh atau gak buat produk publik) dan limit RPM resmi. Belum ada konsistensi kualitas antar-run (temperature 0 tetap pernah kosong). Umur model (end of life) gak bisa diprediksi
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
1. ~~**Spike LLM NVIDIA**~~: selesai 2026-10-10, lihat Spike 3 di bagian 3.
2. (Opsional) Tes riwayat address di Sui GraphQL.
3. Lanjut brainstorming: pertanyaan klarifikasi yang tersisa (misalnya akun user atau anonim, privasi wallet, frekuensi scan),
   lalu 2–3 opsi pendekatan arsitektur, desain per bagian, dan spec di `docs/superpowers/specs/`.
