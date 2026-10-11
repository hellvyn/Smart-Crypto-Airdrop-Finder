# AI Farming Coach + Daily Briefing (A5 + A4)

Tanggal: 2026-10-11. Status: draf untuk direview owner.
Induk: `2026-10-10-curation-foundation-design.md` (fitur A4 dan A5, gerbang G13 dan G14, keputusan #45).
Sumber keputusan: sesi brainstorming dengan owner, 2026-10-11.

## 1. Tujuan

Member yang baru mulai garap airdrop dapet rencana yang cocok sama modal, waktu, dan pengalamannya. Rencana itu cuma
berisi proyek yang lolos kurasi, dengan alasan yang bisa dicek sumbernya. Member juga bisa nanya lanjutan dan minta
penjelasan langkah yang gak dimengerti. Tiap pagi member lihat ringkasan airdrop baru dan perubahan penting begitu buka
web.

Ukuran berhasil:
- Gak ada rekomendasi proyek di luar list kurasi. Gak ada kutipan karangan. Gak ada link luar, alamat wallet, atau
  permintaan seed phrase yang lolos ke layar. Semuanya dibuktikan dengan test.
- Owner menilai minimal 80% dari 20 contoh jawaban Coach dan 5 contoh Briefing "enak dibaca, gampang dimengerti, gak
  kaku" (G13) sebelum fitur dibuka.
- Jatah 20 pesan per member per hari gak bisa diakali dari browser.

## 2. Keputusan owner (lanjutan nomor dari spec induk)

| # | Keputusan | Isi |
|---|---|---|
| 61 | Satu paket | Coach dan Briefing dibuat dalam satu spec dan satu rencana kerja. |
| 62 | Model AI | Coach dan Briefing pakai Claude Sonnet (`claude-sonnet-5-5`) selama credit ada, lalu otomatis ke freellm `auto` lalu NVIDIA (rantai yang sama dengan analyze). |
| 63 | Jatah Coach | 20 pesan per member per hari, reset jam 00:00 WIB (Asia/Jakarta) untuk semua member, apa pun zona waktu di profil (owner 2026-10-11: menutup celah ganti zona waktu). Rencana awal, chat, "Tanya AI", dan "Jelasin langkah ini" masing-masing dihitung 1. |
| 64 | Briefing | Satu ringkasan AI per hari untuk semua member, ditambah bagian personal tanpa AI (watchlist dan garapan). |
| 65 | Bentuk Coach | Form profil, lalu rencana 3 sampai 5 proyek dengan tombol "Mulai garap", lalu chat lanjutan. |
| 66 | Penyimpanan | Profil farming disimpan sampai diubah atau dihapus member. Thread dan pesan dihapus otomatis setelah 30 hari. Cuma pemiliknya yang bisa baca. |
| 67 | Tanya AI | Tombol "Tanya AI" di halaman project membuka Coach dengan konteks project itu. |
| 68 | Lokasi Briefing | Kotak di atas `/airdrops`, khusus member, digabung dengan panel perubahan T7. |
| 69 | Mode belajar | Level di profil (Pemula, Menengah, Pro) dan tombol "Jelasin langkah ini". Materi artikel dan kuis keamanan gak masuk. |
| 70 | Gaya bahasa | Jawaban AI ikut aturan gaya humanizer yang sama dengan teks web (§7), dicek otomatis, dan dinilai owner (G13). |
| 71 | Form profil | 7 isian (§5.1), termasuk tujuan dan "udah punya wallet". Modal berupa pilihan, dan "Gratis aja" itu jawaban yang sah. |

## 3. Cakupan

Masuk:
- Halaman `/coach` (khusus member): form profil, rencana, chat lanjutan, riwayat 30 hari.
- Tombol "Tanya AI" dan "Jelasin langkah ini" di halaman project (khusus member).
- Briefing pagi di atas `/airdrops` (khusus member).
- Migrasi `0017_coach_briefing.sql`, langkah pipeline `briefing` dan pembersihan Coach, paket bersama `packages/llm`.
- Label "Segera" di landing untuk Morning briefing dan Farming Coach dicabut setelah fitur live.

Gak masuk:
- Materi belajar berupa artikel dan kuis keamanan (#69).
- Notifikasi push, email, atau Telegram. Briefing cuma kelihatan waktu member buka web.
- Briefing AI per member.
- Akses Coach untuk pengunjung.

## 4. Arsitektur

### 4.1 Paket `packages/llm` (baru)

Adapter model yang sekarang ada di `pipeline/src/llm` (Claude lewat `@anthropic-ai/sdk`, endpoint OpenAI-compatible
dengan streaming, rantai fallback, circuit breaker, `callStructured`) dipindah ke paket workspace baru
`@saf/llm`. Paket ini boleh pakai jaringan (beda dengan `@saf/core` yang murni). Pipeline dan web sama-sama
mengimpornya, jadi aturan fallback dan penanganan error gak bercabang dua. Pindahnya murni refaktor: semua test
pipeline yang ada harus tetap lulus tanpa diubah maknanya.

Tambahan di paket ini: fungsi streaming untuk chat (`streamChat` yang mengembalikan potongan teks), dipakai Coach.

### 4.2 Coach jalan di server web (Vercel)

- Route handler Next.js (`app/api/coach/...`, runtime Node) memanggil model dengan streaming. Browser gak pernah
  memanggil provider AI langsung dan gak pernah melihat key.
- Env server-only di Vercel: `ANTHROPIC_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `NVIDIA_API_KEY`. Gak ada yang pakai
  awalan `NEXT_PUBLIC_`. Service role key tetap gak boleh ada di web.
- Semua akses database dari route memakai sesi member (anon key + cookie), lewat RLS dan fungsi RPC di §4.4.
- [UNKNOWN] Batas durasi fungsi Vercel Hobby untuk respons streaming. Diukur di awal implementasi. Kalau gak cukup,
  rencana awal dibuat lebih pendek (maks 3 proyek) dan `max_tokens` dikecilkan, bukan pindah arsitektur.

### 4.3 Briefing jalan di pipeline

Langkah baru `briefing` setelah curation (dan sebelum logos) di job harian. Satu panggilan AI per hari. Hasilnya
disimpan di tabel `briefings`. Web cuma membaca.

### 4.4 Data (`0017_coach_briefing.sql`)

Semua tabel: RLS aktif, `revoke all` dari anon dan authenticated, lalu grant seperlunya. Anon gak punya akses apa pun ke
tabel di bawah. Migrasi gak memakai DROP atau UPDATE massal (connector Supabase menolak keduanya).

`coach_profiles`, satu baris per member:
- `user_id` (pk, ke auth.users, on delete cascade), `level` (`beginner`/`intermediate`/`pro`), `capital_band`
  (`free`/`gas_only`/`up_to_100`/`up_to_1000`/`over_1000`), `wallet_count` (1 sampai 10, null kalau `has_wallet` false),
  `has_wallet` boolean, `minutes_per_day` (15/30/60/120), `goal` (`quick`/`long_term`/`learn`), `chains` text[] (maks 10,
  tiap nama maks 40 karakter), `updated_at`.
- Pemilik bisa select, insert, update, dan delete barisnya sendiri. Check constraint menjaga semua nilai di atas.

`coach_threads`:
- `id`, `user_id`, `project_id` (null, atau project yang dibuka lewat "Tanya AI"), `plan` jsonb (rencana yang sudah
  lolos validasi, null untuk thread tanpa rencana), `created_at`.
- Pemilik bisa select dan delete. Insert cuma lewat RPC.

`coach_messages`:
- `id`, `thread_id` (on delete cascade), `user_id`, `role` (`user`/`assistant`), `kind` (`plan`/`chat`/`explain_step`),
  `content` text (maks 4000 karakter), `model` text null, `input_tokens` dan `output_tokens` int null, `created_at`.
- Pemilik cuma bisa select. Tulis cuma lewat RPC.

RPC (security definer, `search_path = ''`, execute cuma untuk authenticated, semua cek `auth.uid()`):
- `coach_begin(p_thread_id, p_kind, p_content)`: mengunci dan menghitung jatah, lalu menyisipkan pesan user dan
  mengembalikan id-nya. Jatah dihitung dari pesan user hari ini (tanggal WIB, Asia/Jakarta) yang sudah punya balasan, atau
  yang dibuat kurang dari 2 menit lalu. Pesan yang gagal dijawab otomatis gak dihitung setelah 2 menit, jadi gak perlu
  RPC "kembalikan jatah" yang bisa disalahgunakan. Pesan ke-21 ditolak dengan kode `P0001` dan pesan `quota`.
- `coach_finish(p_user_message_id, p_content, p_model, p_in, p_out)`: menyisipkan balasan untuk pesan user milik
  pemanggil yang belum punya balasan. Member secara teori bisa memanggilnya langsung untuk menulis "balasan" palsu di
  thread-nya sendiri. Itu cuma memengaruhi data dia sendiri dan gak menambah jatah, jadi diterima dan dicatat.
- `coach_save_plan(p_thread_id, p_plan)`: menyimpan rencana yang sudah divalidasi server ke thread milik pemanggil.

`briefings`:
- `day` date (pk), `items` jsonb, `model` text null, `ai` boolean (false kalau versi tanpa AI), `created_at`.
- Authenticated cuma select. Pipeline (service role) yang menulis.

Pembersihan: langkah `purge` di pipeline menghapus `coach_threads` (dan pesannya lewat cascade) yang umurnya lebih dari
30 hari, dan `briefings` yang umurnya lebih dari 30 hari.

## 5. Alur dan tampilan

### 5.1 Form profil (`/coach`, kunjungan pertama atau "Ubah profil")

| Isian | Bentuk | Wajib | Dipakai untuk |
|---|---|---|---|
| Level | Pemula / Menengah / Pro | ya | Gaya penjelasan. Pemula gak pernah dapet project berisiko Tinggi atau Kritis. |
| Modal yang siap dipakai | Gratis aja ($0) / Buat gas aja (< $10) / $10 sampai 100 / $100 sampai 1.000 / > $1.000 | ya | Filter tag modal (§5.2). |
| Udah punya wallet? | Udah / Belum | ya | Kalau belum, rencana diawali "Langkah 0: bikin wallet dulu, lalu simpan seed phrase-nya di kertas, jangan di HP" dari glosarium, dan isian jumlah wallet disembunyikan. |
| Jumlah wallet | 1 sampai 10 | ya kalau punya wallet | Kalau lebih dari 3, Coach mengingatkan risiko dianggap sybil. |
| Waktu per hari | 15 / 30 / 60 / 120+ menit | ya | Jumlah estimasi effort harian di rencana gak boleh lewat angka ini. |
| Tujuan | Cuan cepat / Jangka panjang / Belajar dulu | ya | Cuan cepat mengutamakan claim atau TGE yang dekat. Jangka panjang mengutamakan points dan early. Belajar dulu mengutamakan langkah sedikit dan modal gratis. |
| Chain favorit | pilih beberapa dari daftar chain di list | tidak | Project di chain itu didahulukan, yang lain gak dibuang. |

Keterangan untuk Pemula di bawah isian modal: "Banyak airdrop bisa digarap tanpa modal. Pilih 'Gratis aja' kalau belum
mau keluar uang sama sekali." Email, alamat wallet, dan saldo gak pernah diminta. Semua isian dicek ulang di server.

### 5.2 Rencana

Kandidat dihitung di server sebelum AI dipanggil, jadi AI cuma memilih dan menjelaskan dari daftar yang sudah lolos kurasi:
- Cuma project dengan curation terbaru `passed` dan tab `live_now` atau `early_bets`.
- Filter modal:

| Pilihan | Yang boleh |
|---|---|
| Gratis aja | tag Gratis |
| Buat gas aja | Gratis, plus Butuh $ dengan minimum disebut dan ≤ $10 |
| $10 ke atas | Gratis, plus Butuh $ dengan minimum ≤ batas atas pilihan |
| Modal belum jelas | gak pernah untuk Pemula; untuk Menengah dan Pro boleh dengan label "modal belum jelas, cek sumbernya" |

- Pemula: risiko Tinggi dan Kritis dibuang.
- Maksimal 25 kandidat diurutkan (worth, lalu sinyal, lalu chain favorit, lalu deadline terdekat untuk tujuan "Cuan
  cepat").

AI menjawab JSON: 3 sampai 5 rekomendasi, masing-masing `project_id`, 1 sampai 3 alasan berkutipan, `minutes_per_day`,
catatan modal. Tampilan: card yang sama dengan list baru (logo, nama, risiko, modal), alasan, estimasi menit, tombol
"Mulai garap" (aksi `startFarming` yang sudah ada, #38). Untuk Pemula ada pengingat keamanan di atas rencana. Project
dengan tag Gratis dapet catatan "mungkin tetap butuh sedikit gas kalau di mainnet" (data kita gak membedakan
mainnet dan testnet).

### 5.3 Chat lanjutan

Di bawah rencana. Menampilkan "Sisa X/20 pesan hari ini" dan disclaimer "Bukan nasihat keuangan. Tetap DYOR."
Jawaban mengalir (streaming), dirender sebagai teks biasa. Nama project dari daftar kandidat jadi link internal ke
`/projects/{slug}`, dibuat server, bukan dari teks AI.

### 5.4 Halaman project

- "Tanya AI": membuka `/coach` dengan thread baru yang berkonteks project itu (kandidat = project itu saja, dan cuma
  kalau lolos kurasi; kalau gak lolos, Coach menjelaskan alasan publik gak lolosnya dari data kurasi dan gak
  menyarankan untuk digarap).
- "Jelasin langkah ini": tombol kecil di tiap langkah. Jawaban muncul di bawah langkah itu. Sumbernya teks langkah
  itu sendiri (yang sudah lolos grounding) plus glosarium (§8).
- Pengunjung melihat kotak "Member only" seperti bagian AI lain.

### 5.5 Riwayat

Daftar thread 30 hari terakhir, terbaru dulu. Member bisa menghapus thread sendiri.

### 5.6 Briefing pagi

Kotak "Briefing pagi · {tanggal}" di atas `/airdrops` untuk member:
- Bagian AI: maksimal 5 poin, tiap poin link ke project-nya.
- Bagian personal tanpa AI: perubahan project di watchlist (feed T7) dan deadline garapan terdekat.
- Bisa diciutkan, status diingat di browser (localStorage, dibungkus try/catch).
- Kalau briefing hari ini belum ada, tampilkan yang terbaru dengan label tanggalnya. Kalau gak ada sama sekali, bagian
  AI disembunyikan.

### 5.7 Keadaan khusus

- Jatah habis: "Jatah 20 pesan hari ini habis, reset jam 00.00 WIB."
- Semua model gagal: "Coach lagi gak bisa jawab, coba lagi sebentar." Pesan itu otomatis gak dihitung setelah 2 menit.
- Kandidat kosong (misal modal Gratis aja dan gak ada project Gratis): pesan jujur tanpa memanggil AI, dan gak
  memotong jatah.

## 6. Pengaman AI

Berlaku untuk rencana, chat, "Jelasin langkah ini", dan Briefing.

Konteks yang dikirim ke model cuma data yang sudah lolos pipeline: field publik dan member project kandidat, kutipan
yang terbukti ada di sumber, langkah yang sudah lolos grounding (`tasks.text_id`), poin verdict yang sudah disaring,
glosarium (§8), dan profil member. Teks mentah halaman web gak pernah dikirim. Instruksi sistem menandai semua konteks
itu sebagai data, bukan perintah. Email, user id, dan alamat wallet gak pernah masuk prompt.

Validasi rencana dan Briefing (di server untuk Coach, di pipeline untuk Briefing):
- `project_id` harus ada di daftar kandidat. Kalau gak ada, rekomendasi atau poin itu dibuang.
- Tiap kutipan harus ada di konteks (`quoteInSource`). Kalau gak ada, alasan itu dibuang.
- Teks bebas (bukan kutipan) ditolak kalau memuat host atau URL, `@handle`, alamat `0x` atau base58, angka yang gak ada
  di konteks, atau ajakan memberi seed phrase, private key, atau transfer dana. Aturannya memakai pemeriksa yang sama
  dengan `stepTranslationGrounded` (FX9) supaya gak ada dua versi.
- Setelah dibersihkan, rencana tanpa rekomendasi tersisa menampilkan "Coach belum bisa bikin rencana, coba lagi", dan
  Briefing tanpa poin tersisa jatuh ke versi tanpa AI (daftar perubahan apa adanya).

Validasi chat dan "Jelasin langkah ini":
- Teks biasa, gak ada HTML atau markdown link.
- Potongan yang memuat URL luar, alamat wallet, atau ajakan seed phrase/private key/transfer diganti
  "[dihapus: info sensitif]". Yang dicatat cuma jumlah kejadian, bukan isinya.
- Topik dikunci ke airdrop di daftar kandidat, istilah di glosarium, dan cara pakai AirdropIQ. Selain itu Coach menolak
  dengan sopan.

Model selalu menerima `stop_reason` yang dicek: `refusal` dan `max_tokens` dianggap gagal dan pindah ke model berikutnya
(sama dengan analyze).

## 7. Gaya bahasa (#70)

Instruksi sistem memuat aturan gaya yang sama dengan teks web (Plan 6 Global Constraints, versi humanizer 2026-10-10):
- Santai, menyapa "kamu", istilah crypto Inggris yang umum boleh (claim, gas, bridge, points).
- Panjang kalimat bervariasi: campur kalimat pendek yang tegas dengan yang lebih panjang.
- Kata terlarang: delve, testament, realm, crucial, multifaceted, in conclusion, furthermore, krusial, esensial,
  komprehensif, holistik, inovatif, revolusioner, seamless, "selain itu", "lebih lanjut", "kesimpulannya", "di era",
  "mari kita", "tak hanya … tetapi juga". Gak ada em dash.
- Pemula: kalimat pendek, satu ide per kalimat, istilah dijelaskan memakai glosarium.

Pemeriksaan otomatis memakai daftar yang sama dengan `copy-style.test.ts`:
- Em dash diganti koma.
- Kata terlarang di Briefing: tulis ulang sekali, kalau masih ada pakai versi tanpa AI.
- Kata terlarang di chat Coach: diganti padanan biasa dari tabel tetap (jatah gak dipotong untuk tulis ulang).

## 8. Glosarium (dipakai Coach untuk penjelasan istilah)

| Istilah | Penjelasan |
|---|---|
| Wallet | Dompet crypto. Tempat aset kamu disimpan, dan "kunci" untuk masuk ke aplikasi crypto. |
| Seed phrase | 12 atau 24 kata kunci utama wallet. Siapa pun yang tahu kata-kata ini bisa mengambil semua isi wallet. Jangan pernah dibagi ke siapa pun, termasuk admin atau "support". |
| Private key | Kunci rahasia wallet, sama bahayanya dengan seed phrase kalau bocor. |
| Gas fee | Biaya kecil untuk menjalankan transaksi di blockchain. Dibayar pakai koin jaringannya, misalnya ETH di Ethereum. |
| Mainnet | Jaringan asli. Transaksi di sini pakai uang beneran. |
| Testnet | Jaringan uji coba. Koinnya gratis dan gak punya nilai, cocok buat latihan. |
| Bridge | Memindahkan aset dari satu jaringan ke jaringan lain. Pakai cuma link bridge resmi. |
| Swap | Menukar satu token dengan token lain. |
| Points | Poin dari project untuk aktivitas kamu. Sering jadi dasar pembagian airdrop, tapi gak ada jaminan nilainya. |
| TGE | Token Generation Event, saat token project pertama kali dirilis. |
| Claim | Mengambil jatah airdrop. Cuma lewat link claim yang statusnya official di AirdropIQ. |
| Snapshot | Saat project mencatat siapa saja yang memenuhi syarat. Aktivitas setelah snapshot biasanya gak dihitung. |
| Sybil | Satu orang pakai banyak wallet untuk pura-pura jadi banyak orang. Project sering mencoret wallet seperti ini dari airdrop. |
| Testnet faucet | Situs resmi yang membagi koin testnet gratis untuk latihan. |
| Phishing | Situs atau pesan palsu yang meniru project asli untuk mencuri isi wallet. Cek domain sebelum connect wallet. |
| Connect wallet | Menghubungkan wallet ke aplikasi. Lakukan cuma di situs resmi, dan jangan pernah menyetujui transaksi yang gak kamu mengerti. |

## 9. Biaya dan batasan

Estimasi [INFERENCE], dengan harga Sonnet 5.5 dari dokumentasi ($2 per juta token input, $10 per juta token output):
- Konteks Coach sekitar 10 ribu sampai 30 ribu token. Satu pesan sekitar $0,01 sampai $0,05.
- Prompt caching (khusus Claude): instruksi tetap dan glosarium jadi blok bersama untuk semua member. Profil dan kandidat
  jadi blok per member. Chat lanjutan memakai cache otomatis. Baca cache dibayar sekitar 0,1x harga input, tulis cache
  1,25x (TTL 5 menit). Minimal prefix yang bisa di-cache di Sonnet 5.5 adalah 512 token. Token cache dicatat per pesan
  supaya hit rate bisa diukur.
- Batas atas: 20 pesan × jumlah member aktif × hari. Contoh 10 member aktif penuh sebulan sekitar $60 sampai $300.
  [UNKNOWN] Pemakaian nyata.
- Briefing: satu panggilan per hari, di bawah $0,05.
- Setelah credit Claude habis (27 Oktober), rantai pindah ke freellm/NVIDIA. [UNKNOWN] Seberapa turun kualitasnya.

G14 (kapasitas provider): sebelum dibuka, ukur waktu respons dan tingkat gagal rantai fallback untuk 20 permintaan
contoh. Kalau rantai cadangan gagal lebih dari 20%, jatah diturunkan atau Coach diberi label "terbatas" saat Claude
gak tersedia.

## 10. Pengujian

TDD seperti Plan 4 sampai 8. Semua test memakai model tiruan, tanpa panggilan API asli.
- pgTAP: jatah 20 dan reset 00:00 WIB, ganti zona waktu profil gak mengubah hitungan; hapus thread gak mengembalikan jatah; pesan gagal gak dihitung setelah 2 menit; member A gak bisa membaca atau
  menulis thread member B; anon gak punya akses apa pun; `coach_finish` cuma untuk pesan milik pemanggil yang belum
  dibalas; briefings cuma bisa dibaca authenticated.
- Pengaman: project di luar kandidat dibuang; kutipan palsu dibuang; URL luar, alamat `0x`, dan ajakan seed phrase
  disensor; topik di luar airdrop ditolak; kata terlarang dan em dash dibersihkan; Pemula gak pernah dapet risiko
  Tinggi atau Kritis; filter modal sesuai tabel §5.2.
- Fallback: `refusal`, `max_tokens`, credit habis, dan semua model gagal.
- Refaktor `packages/llm`: semua test pipeline yang ada tetap lulus.
- e2e: isi form → rencana → "Mulai garap" → muncul di tracker; "Tanya AI"; "Jelasin langkah ini"; jatah habis; Briefing
  tampil untuk member dan gak tampil untuk pengunjung; 360 px tanpa scroll ke samping.
- Review owner sebelum dibuka (G13): minimal 20 jawaban Coach dan 5 Briefing.

## 11. Deploy

1. Migrasi 0017 lewat connector Supabase (cuma create, grant, revoke).
2. Env Vercel: `ANTHROPIC_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `NVIDIA_API_KEY` (server-only). Owner menambahkan.
3. Merge ke main, web deploy.
4. Uji G14 dan review G13, lalu label "Segera" di landing dicabut.
