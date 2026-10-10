# Plan 6: Web Kurasi + Bahasa Indonesia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web sepenuhnya Bahasa Indonesia; list cuma menampilkan airdrop yang lolos kurasi dalam tiga tab
(termasuk "Sudah berakhir" untuk yang berakhir setelah lolos, keputusan #40);
halaman project menampilkan keputusan AI, keamanan, effort, langkah, dan alasan masuk list, dengan label yang jujur
(terverifikasi vs diklaim vs analisis AI); project yang gak lolos diberi peringatan dan `noindex`. Web publik untuk
pengunjung; Kelayakan, urutan "paling cuan", Keputusan AI, dan effort khusus member (#45); status link klaim (#42),
"Dicek" (#44), dan rekam jejak (#43) tampil untuk semua.

**Architecture:**
- Semua teks UI dipusatkan di modul copy (`apps/web/lib/copy.ts`) + label di `lib/view.ts`; pesan alasan risiko dan
  kurasi di `@saf/core` diterjemahkan di sumbernya.
- Dua view SQL (security_invoker): `public_list` (anon + authenticated, tanpa `worth_level`) dan `curated_list`
  (authenticated saja, dengan `worth_level`), keduanya di atas `project_list` + curation terbaru + ringkasan sinyal.
  Halaman memilih view dari sesi; pemisahan dijaga RLS/grant Plan 5, bukan cuma UI.
- **Desain visual** (UI/UX lebih baik dari AlphaDrops) disusun terpisah dan disetujui owner dulu; komponen di plan ini
  mengikuti sistem desain itu begitu ada (lihat catatan di Task 4).
- Halaman tetap server components; data dari query baru di `lib/queries.ts`.

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, Vitest, Playwright, pgTAP (sama dengan Plan 2).

**Spec:** `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` (rev. 3: §7, §8, §15, keputusan #27–#29,
#40–#46)

**Bergantung ke:** Plan 7 (route publik `(public)/airdrops` dan `(public)/projects`, gak ada digest/signup), Plan 5 (`curations`, `project_signals`, `ai_analyses`, `curate` reasons, stats kurasi), Plan 4
(`tasks.cadence`, evidence v3).

## Global Constraints

- **Bahasa:** semua teks yang dilihat pengguna Bahasa Indonesia, gaya santai-sopan dengan "kamu" (bukan "lo/gue",
  bukan "Anda"). `<html lang="id">`. Format tanggal `id-ID`, zona UTC ditulis "UTC".
- **Glosarium (dipakai persis, juga di test):**
  | Konsep | Teks |
  |---|---|
  | tab `live_now` / `early_bets` / `ended` | "Bisa digarap sekarang" / "Peluang awal" / "Sudah berakhir" |
  | tanggal berakhir (tab `ended`) | "Berakhir {tanggal}" |
  | worth `high`/`medium`/`low`/`insufficient_data` | "Layak banget" / "Layak" / "Kurang layak" / "Data belum cukup" |
  | label worth | "Kelayakan" |
  | risiko `low`/`medium`/`high`/`critical`/`insufficient_data` | "Rendah" / "Sedang" / "Tinggi" / "Kritis" / "Data belum cukup" |
  | status `live`/`announced`/`speculative`/`ended`/`unknown` | "Berjalan" / "Diumumkan" / "Spekulatif" / "Berakhir" / "Belum pasti" |
  | verdict `garap`/`pantau`/`skip` | "Garap" / "Pantau" / "Lewati" |
  | label sumber | "Data terverifikasi", "Diklaim project, belum terverifikasi", "Analisis AI" |
  | ringkasan list | "{N} airdrop dicek hari ini · {M} lolos kurasi" |
  | cakupan cek | "{k}/4 cek keamanan kunci jalan" |
  | peringatan gak lolos | "Tidak masuk daftar kurasi: {alasan}" |
  | status kedaluwarsa | "Berakhir (deadline lewat)" |
  | cadence `daily`/`weekly`/`once` | "Harian" / "Mingguan" / "Sekali" |
  | bagian khusus member (#46) | "Khusus member" (tanpa tombol/link daftar) |
  | waktu cek (#44) | "Dicek hari ini" / "Dicek kemarin" / "Dicek {n} hari lalu"; > 48 jam: "Belum dicek ulang sejak {tanggal}"; dibekukan: "Cek terakhir {tanggal}" |
  | status link (#42) `official`/`different_domain`/`phishing`/`unchecked` | "✓ Domain resmi" / "⚠ Domain beda dari situs resmi" / "Link disembunyikan: terdeteksi phishing" / "Belum dicek" |
  | badge klaim (#42) | "Klaim terbuka · link dicek" |
  | backer laporan (#41) | "Menurut AlphaDrops: {investor} (lead), …" |
  | rekam jejak (#43) | "Dari {total} airdrop yang lolos kurasi sebelum tokennya diperdagangkan dan sudah berakhir: {listed} punya token diperdagangkan, {noToken} berakhir tanpa token, {riskRaised} belakangan berisiko tinggi." |
  | urutan publik | "Terbaru dicek" |
- Gak pernah ada teks "aman", "safe", "dijamin", atau "pasti untung".
- **Gaya tulisan (owner, 2026-10-10, ditulis ulang dengan skill humanizer):**
  - Kata terlarang di teks yang dilihat pengguna: delve, testament, realm, crucial, multifaceted, in conclusion,
    furthermore, krusial, esensial, komprehensif, holistik, inovatif, revolusioner, seamless, "selain itu", "lebih
    lanjut", "kesimpulannya", "di era", "mari kita", "tak hanya … tetapi juga". **Gak ada em dash (—)**, termasuk di
    `<title>`; pakai koma, titik, atau "·".
  - Variasi panjang kalimat: campur kalimat sangat pendek dan tegas dengan kalimat yang lebih panjang. Paragraf gak
    boleh berisi kalimat yang panjang dan bobotnya sama rata.
  - Gak terlalu baku: boleh campur istilah Inggris yang umum dipakai orang crypto Indonesia (worth it, claim, source,
    effort, verified, ended, live, early, track record, DYOR, cross-check, step), tapi kalimatnya tetap kalimat
    Indonesia. Hindari Inggris yang dipaksakan atau gaya "which is, literally".
  - Nada santai, bahasa sehari-hari yang wajar ("udah", "gak", "kamu"), boleh opini "kami" dan detail spesifik
    (mis. "06.00 WIB", "grup Telegram atau DM"). Gak ada angka atau klaim yang dikarang.
  - Hindari pola tiga serangkai, kalimat "bukan X, tapi Y", slogan bertiga, dan kartu/kalimat yang strukturnya kembar.
  - Tanda kutip lurus ("…"), bukan kutip miring.
  - Test: `apps/web/test/copy-style.test.ts` memindai `lib/copy.ts` dan glosarium: gagal kalau ada kata terlarang atau
    karakter `—`. Ditambahkan di Task 2.
- Badge "terverifikasi" cuma untuk sinyal `verified = true`. `claimed_backer` selalu tampil sebagai klaim.
- Semua link keluar lewat `ExternalLink` (rel noopener noreferrer nofollow) dan URL yang sudah dibersihkan referral.
- Anon key saja di web; service role gak pernah masuk `apps/web`.
- Migrasi baru: `0012_curated_list.sql`.

## Review Focus

1. **Project tanpa baris `curations` sama sekali** (run belum jalan setelah deploy) → gak muncul di list, halaman
   detail tetap terbuka dengan peringatan "Tidak masuk daftar kurasi: belum dinilai". Test di Task 3 dan 6.
2. **Analisis AI belum ada / gagal** → bagian "Keputusan AI" menampilkan "Analisis AI belum tersedia", halaman lain
   tetap lengkap. Test di Task 5.
3. **Teks hasil AI berisi markup/HTML atau URL** → dirender sebagai teks biasa (React escaping), URL gak jadi link. Test
   di Task 5.
4. **Tab kosong** → pesan kosong + angka ringkasan, bukan halaman kosong. Test di Task 4.
5. **Parameter `?tab=` gak dikenal** → default "Bisa digarap sekarang", gak error 500. Test di Task 4.
6. **Project berakhir setelah lolos kurasi** (#40) → pindah ke tab "Sudah berakhir", halaman detailnya tanpa banner
   "Tidak masuk daftar kurasi" dan tanpa `noindex`, perubahannya tampil sebagai "Sudah berakhir". Test di Task 4, 6, 7.
7. **Pengunjung membuka `?sort=worth` atau `?worth=high`** → parameter diabaikan (urut "Terbaru dicek"), gak error dan
   gak membocorkan urutan Kelayakan. Test di Task 4.
8. **Link klaim berstatus `phishing`** → dirender sebagai teks peringatan, bukan `<a>`, di halaman project mana pun.
   Test di Task 5.

---

### Task 1: Teks Bahasa Indonesia di `@saf/core` (alasan risiko dan kurasi)

**Files:**
- Modify: `packages/core/src/risk/assess.ts`, `packages/core/src/risk/dangerous-asks.ts`, `packages/core/src/curate/*.ts`
  (pesan alasan)
- Test: test core yang ada (assertion pesan diperbarui)

**Interfaces:**
- Kode alasan (`code`) gak berubah; cuma `message`. Contoh wajib:
  - `single_source`: "Baru 1 sumber yang menyebut project ini dan belum ada akun sosial resmi yang ditemukan."
  - `speculative`: "Belum ada pengumuman airdrop; ini spekulasi berdasarkan sinyal onchain."
  - `hack_history`: "Project ini punya {n} catatan hack."
  - `insufficient_checks` (kurasi): "Cek keamanan kunci belum lengkap: {daftar cek}."

- [ ] **Step 1:** ubah assertion test yang ada ke teks baru (gagal) → **Step 2:** `pnpm --filter @saf/core exec vitest run` FAIL →
  **Step 3:** terjemahkan → **Step 4:** PASS + `grep -rniE "\b(safe|aman)\b" packages/core/src` cuma menemukan
  kata dalam teks peringatan/negasi yang disengaja → **Step 5:** commit
  `git commit -m "feat(i18n): Indonesian risk and curation copy"`

---

### Task 2: UI yang ada ke Bahasa Indonesia

**Files:**
- Create: `apps/web/lib/copy.ts` (semua string halaman, dikelompokkan per halaman)
- Modify: `apps/web/app/layout.tsx` (`lang="id"`, metadata), semua `app/**/page.tsx`, `components/*.tsx`,
  `lib/view.ts` (label status/risiko/deadline/presisi/cek sesuai glosarium), `lib/auth.ts` / `components/auth-form.tsx`
  (pemetaan pesan error login Supabase ke Bahasa Indonesia; pesan yang gak dikenali → "Terjadi kesalahan. Coba lagi.")
- Modify: `apps/web/e2e/*.spec.ts`, `apps/web/test/**` (assertion teks)
- Test: unit + e2e yang ada

**Interfaces:**
- `copy.ts` mengekspor objek per area (`list`, `detail`, `auth`, `watchlist`, `wallets`, `settings`, `unsubscribe`,
  `header`, `landing`, `errors`) dengan string dan fungsi kecil untuk teks berangka (mis. `list.summary(n, m)`).
- Pemetaan error auth minimal (cuma login yang tersisa setelah Plan 7): invalid login credentials, rate limit,
  error jaringan.

- [ ] **Step 1:** ubah assertion unit + e2e ke Bahasa Indonesia (gagal) → **Step 2:** `pnpm --filter web test` FAIL →
  **Step 3:** pindahkan string ke `copy.ts` dan terjemahkan → **Step 4:**
  `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web e2e` PASS, dan
  `grep -rnE ">[A-Z][a-z]+ [a-z]+" apps/web/app apps/web/components` gak menemukan kalimat bahasa Inggris yang tampil
  (sisa yang sah dicatat di laporan task) → **Step 5:** commit `git commit -m "feat(i18n): Indonesian web UI"`

---

### Task 3: View `public_list` + `curated_list` + query

**Files:**
- Create: `supabase/migrations/0012_curated_list.sql`, `supabase/tests/curated_list.test.sql`
- Modify: `apps/web/lib/queries.ts`, `apps/web/lib/view.ts`, `apps/web/lib/farming.ts` (Plan 8: `getFarmingBoard` mengisi
  `endedOn` di `heatmapRange` dari `ended_on` curation terbaru project)
- Test: `apps/web/test/queries.test.ts` (atau file test query yang ada), test `getFarmingBoard` yang ada

**Interfaces:**
- Produces (SQL):
  - `public_list` (security_invoker) = kolom `project_list` + `tab`, `ended_on`, `checked_at` (`computed_at` curation
    terbaru), `signals` (jsonb array `{kind, value, verified}` dari `project_signals`), `claim_open_checked` (boolean:
    ada deadline `claim` ≥ hari ini dan semua link `claim` project berstatus `official` di `link_checks`), cuma baris
    yang curation terbarunya (`computed_at desc, seq desc`) `passed = true`. **Tanpa** `worth_level`. `grant select` ke
    anon dan authenticated (#45).
  - `curated_list` = `public_list` + `worth_level`; `grant select` ke **authenticated saja**.
- Produces (TS):
  - `listCurated(db, tab: Tab, f: ListFilters & { worth?: WorthLevel[] }, page: number, member: boolean): Promise<CuratedPage>`;
    member: dari `curated_list`, urutan worth (`high`→`insufficient_data`), sinyal terkuat (vc_backer → tvl →
    coingecko_listed → curated_source), deadline terdekat, `last_seen` desc. Pengunjung: dari `public_list`, urutan
    `checked_at` desc lalu nama, filter `worth` diabaikan. Tab `ended` (keduanya): `ended_on` desc, lalu nama; tanpa
    batas umur (#40).
  - `checkedLabel(checkedAt: Date, now: Date, frozen: boolean): string` — teks glosarium #44.
  - `getTrackRecord(db): Promise<{ total; listed; noToken; riskRaised } | null>` dari `pipeline_runs` sukses terakhir
    (`stats.track_record_*`); `null` kalau `total < 10` (#43).
  - `getRunSummary(db): Promise<{ checked: number; passed: number; at: Date } | null>` dari `pipeline_runs` sukses terakhir
    (`stats.curation_checked`, `stats.curation_passed`).
  - `parseTab(v: string | undefined): Tab` (`live_now` | `early_bets` | `ended`, default `live_now`).

- [ ] **Step 1: Test yang gagal** — pgTAP: project dengan curation terbaru `passed=false` gak muncul walau yang lama
  `passed=true`; project tanpa curation gak muncul; anon bisa select `public_list` tapi gak punya kolom `worth_level`
  dan ditolak di `curated_list` (`42501`); authenticated bisa keduanya. Vitest: `parseTab("x") === "live_now"`,
  `parseTab("ended") === "ended"`; `checkedLabel` untuk 0/1/3 hari dan > 48 jam; `getTrackRecord` → `null` saat
  `total = 9`; urutan
  `listCurated` sesuai aturan (mock rows), termasuk tab `ended` urut `ended_on` terbaru dulu; `getFarmingBoard` untuk
  project dengan `ended_on` memberi `range.endKind = "ended"`.
- [ ] **Step 2–4:** gagal → implementasi → pgTAP + `pnpm --filter web test` lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): curated_list view and queries"`

---

### Task 4: Halaman list: tiga tab, badge, ringkasan

**Files:**
- Modify: `apps/web/app/(public)/airdrops/page.tsx`, `apps/web/components/ProjectRow.tsx`
- Create: `apps/web/components/SignalBadges.tsx`, `apps/web/components/WorthBadge.tsx`, `apps/web/components/TabNav.tsx`
- Test: `apps/web/test/components/*.test.tsx`, `apps/web/e2e/projects.spec.ts`

**Interfaces:**
- Consumes: Task 3.
- Baris: nama, status, Kelayakan (member saja), risiko, "{k}/4 cek keamanan kunci jalan", "Dicek …" (#44), badge
  sinyal (`VC: Paradigm ✓` hanya untuk `vc_backer` verified; "Menurut AlphaDrops: …" untuk `reported_backer`; `TVL $45
  jt`; `Terdaftar di CoinGecko`; `Sumber kurasi`), badge "Klaim terbuka · link dicek" kalau `claim_open_checked`,
  deadline terdekat.
- Filter: status, risiko, chain (yang ada) + Kelayakan (member saja). Tab lewat `?tab=live_now|early_bets|ended`,
  filter lain dipertahankan. Pengunjung melihat label urutan "Terbaru dicek".
- Rekam jejak (#43): kalimat glosarium di atas list kalau `getTrackRecord` gak `null`; juga dipasang di landing Plan 7.
- **Desain visual:** sebelum task ini dikerjakan, sistem desain (warna, tipografi, kartu/baris, state) yang disetujui
  owner ditambahkan sebagai Global Constraint plan ini; komponen task ini dan Task 5 mengikutinya.
- Baris di tab "Sudah berakhir": status "Berakhir" + "Berakhir {tanggal}" (dari `ended_on`) menggantikan deadline terdekat.
- Kosong: "Belum ada airdrop yang lolos kurasi di tab ini." + ringkasan.

- [ ] **Step 1: Test yang gagal** — e2e: seed 1 project lolos `live_now`, 1 lolos `early_bets`, 1 lolos `ended`, 1 gagal →
  tab default cuma menampilkan yang `live_now`; klik "Peluang awal" menampilkan yang speculative; klik "Sudah berakhir"
  menampilkan yang berakhir dengan "Berakhir {tanggal}"; yang gagal gak ada di tab mana pun;
  `?tab=xyz` menampilkan tab default; ringkasan "4 airdrop dicek hari ini · 3 lolos kurasi"; sebagai pengunjung gak ada
  teks "Kelayakan" dan `?sort=worth&worth=high` diabaikan; sebagai member "Kelayakan" tampil; tiap baris punya "Dicek".
  Komponen: `SignalBadges` gak pernah merender "✓" untuk `claimed_backer`/`reported_backer`.
- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter web test && pnpm --filter web e2e` lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): curated list with tabs, worth and signal badges"`

---

### Task 5: Halaman project baru

**Files:**
- Modify: `apps/web/app/(public)/projects/[slug]/page.tsx`, `apps/web/components/ProjectDetailView.tsx`,
  `apps/web/lib/queries.ts` (`getProjectDetail` diperluas)
- Create: `apps/web/components/detail/AiDecision.tsx`, `Contradictions.tsx`, `StepsList.tsx`, `EffortBox.tsx`,
  `WhyListed.tsx`, `SafetyBox.tsx`, `LatestUpdate.tsx`
- Test: `apps/web/test/components/detail/*.test.tsx`, `apps/web/e2e/projects.spec.ts`

**Interfaces:**
- `ProjectDetail` mendapat: `curation: { passed; worthLevel; tab; reasons } | null`, `signals`, `analyst` (hasil
  `ai_analyses` kind `analyst` terbaru, atau null), `scamFlags`, `contradictions`, `steps` (`{ text, cadence }[]`
  dari `tasks` urut `position`), `facts` (evidence v3: key_parameter, source_rating, latest_update, claimed_backer,
  capital_required).
- Urutan bagian sesuai spec §7.2 untuk yang datanya tersedia di sub-proyek ini: Kepala → Keputusan AI (label "Analisis
  AI", verdict, keyakinan, poin + link sumber) → Kontradiksi → Langkah (pakai `analyst.steps_id` kalau ada, kalau gak
  pakai `steps`; dikelompokkan Harian/Mingguan/Sekali) → Keamanan (alasan risiko + flag scam AI + status cek tiap
  link) → Effort (estimasi AI disandingkan dengan `source_rating` sumber, mis. "airdrops.io: Easy") → Update terbaru →
  Kenapa masuk list (sinyal + label sumber). Bagian Progress per wallet, Timeline perubahan, dan Tanya AI **belum**
  ada di sub-proyek ini (sub-proyek checklist, #3, #4).
- Teks AI dirender sebagai teks biasa; `source_url` jadi `ExternalLink` hanya kalau URL itu salah satu URL dokumen
  sumber project.
- **Publik vs member (#45):** pengunjung melihat Kepala ("Dicek …", tanpa Kelayakan), Kontradiksi, Langkah (dari
  `tasks.text_id`, jatuh ke `tasks.text`), Keamanan, Update terbaru, Kenapa masuk list. Bagian Keputusan AI dan Effort
  untuk pengunjung = kotak berjudul sama berisi "Khusus member" saja (tanpa tombol, #46); data `analyst` gak pernah
  di-query untuk pengunjung.
- **Link (#42):** tiap link di Langkah dan Keamanan menampilkan status dari `link_checks` (glosarium); `phishing` →
  teks peringatan, bukan `<a>`; `different_domain` → link + peringatan. Kepala menampilkan "Klaim terbuka · link dicek"
  kalau `claim_open_checked`.

- [ ] **Step 1: Test yang gagal** — komponen: `AiDecision` dengan `analyst = null` → "Analisis AI belum tersedia";
  poin berisi `<b>x</b>` dirender sebagai teks; `WhyListed` menulis "Diklaim project, belum terverifikasi" untuk
  `claimed_backer`; `StepsList` mengelompokkan cadence; `LinkStatus` dengan `phishing` gak merender `<a>`. e2e: halaman
  project lolos sebagai member menampilkan bagian dalam urutan di atas dan label "Analisis AI"; sebagai pengunjung
  bagian Keputusan AI dan Effort berisi "Khusus member", gak ada teks verdict ("Garap"/"Pantau"/"Lewati"), dan gak ada
  teks "Daftar".
- [ ] **Step 2–4:** gagal → implementasi → test + e2e lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): project page with AI decision, safety, effort, steps and why-listed"`

---

### Task 6: Project yang gak lolos: peringatan, `noindex`, watchlist

**Files:**
- Modify: `apps/web/app/(public)/projects/[slug]/page.tsx` (`generateMetadata` → `robots: { index: false }` kalau gak
  lolos), `ProjectDetailView.tsx`, `apps/web/app/(app)/watchlist/page.tsx`, `apps/web/lib/watchlist.ts`
- Create: `apps/web/components/NotCuratedBanner.tsx`
- Test: komponen + `apps/web/e2e/projects.spec.ts`, `apps/web/e2e/watchlist.spec.ts`

**Interfaces:**
- Banner paling atas: "Tidak masuk daftar kurasi: {alasan}" — alasan = pesan `fail` pertama dari curation terbaru, atau
  "belum dinilai" kalau gak ada curation.
- Watchlist: item yang curation terbarunya gagal (atau belum ada) diberi label yang sama.
- Curation terbaru `passed = true` dengan `tab = ended` **bukan** gagal: tanpa banner, tanpa `noindex`; kepala halaman
  menampilkan status "Berakhir" + "Berakhir {tanggal}".

- [ ] **Step 1: Test yang gagal** — e2e: halaman project gagal kurasi punya banner dan `<meta name="robots"
  content="noindex">`; project lolos gak punya keduanya (termasuk yang lolos di tab `ended`); watchlist menampilkan label pada item yang gagal.
- [ ] **Step 2–4:** gagal → implementasi → lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): not-curated warning, noindex and watchlist label"`

---

### Task 7: "Perubahan sejak kunjungan terakhir" (pengganti email)

**Files:**
- Modify: `supabase/migrations/0012_curated_list.sql` (tambah `profiles.changes_seen_at timestamptz` + `grant update (changes_seen_at) on profiles to authenticated`)
- Create: `apps/web/components/ChangesSinceLastVisit.tsx`, `apps/web/app/(public)/airdrops/actions.ts` (`markChangesSeen`)
- Modify: `apps/web/lib/queries.ts`, `apps/web/app/(public)/airdrops/page.tsx`, `apps/web/app/(app)/watchlist/page.tsx`
- Test: komponen, `supabase/tests/curated_list.test.sql`, e2e `watchlist.spec.ts`

**Interfaces:**
- `listChangesSince(db, since: Date | null, now: Date): Promise<ChangeItem[]>` — untuk project di watchlist user:
  `project_changes` (`status`, `risk_level`, `curated`) setelah `since` (atau 7 hari terakhir kalau `null`), plus
  deadline `claim`/`snapshot`/`campaign_end` dalam 48 jam (exact/approximate). Maksimal 20 item, terbaru dulu.
  `project_changes` perlu baca member: policy `for select to authenticated` hanya untuk `project_id` yang ada di
  watchlist user (pakai `exists (select 1 from watchlist w where w.user_id = auth.uid() and w.project_id = project_changes.project_id)`).
- Teks: "Keluar dari daftar kurasi", "Masuk daftar kurasi", "Status berubah: {lama} → {baru}" (perubahan ke `ended`
  ditulis "Sudah berakhir"), "Risiko berubah:
  {lama} → {baru}", "Deadline {jenis} dalam 48 jam ({tanggal})". Tombol "Tandai sudah dibaca" → `markChangesSeen`
  set `changes_seen_at = now()`.
- Ditampilkan di atas list `/airdrops` dan di watchlist; disembunyikan kalau kosong.

- [ ] **Step 1: Test yang gagal** — pgTAP: user A gak bisa membaca `project_changes` project yang cuma ada di watchlist
  user B; anon gak bisa sama sekali. e2e: project di watchlist berubah `curated` true→false → muncul "Keluar dari daftar
  kurasi"; project di watchlist berubah status live→ended → muncul "Sudah berakhir" (bukan "Keluar dari daftar kurasi");
  setelah "Tandai sudah dibaca" hilang.
- [ ] **Step 2–4:** gagal → implementasi → pgTAP + test + e2e lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): changes since last visit for watched projects"`

---

## Selesai kalau

- `pnpm -r test`, typecheck, pgTAP, dan seluruh e2e lulus dengan teks Bahasa Indonesia.
- Di produksi (setelah satu run dengan Plan 5): tab "Bisa digarap sekarang" cuma berisi project lolos kurasi, ringkasan
  angka sesuai `pipeline_runs.stats`, halaman project lolos menampilkan Analisis AI berlabel.
- Akses tetap khusus member (Plan 7).
