# Plan 6: Web Kurasi + Bahasa Indonesia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web sepenuhnya Bahasa Indonesia; list cuma menampilkan airdrop yang lolos kurasi dalam tiga tab
(termasuk "Ended" untuk yang berakhir setelah lolos, keputusan #40);
halaman project menampilkan keputusan AI, keamanan, effort, langkah, dan alasan masuk list, dengan label yang jujur
(terverifikasi vs diklaim vs analisis AI); project yang gak lolos diberi peringatan dan `noindex`. Web publik untuk
pengunjung; level worth it, urutan "paling worth it", AI verdict, dan estimasi effort khusus member (#45); status link klaim (#42),
"Dicek" (#44), dan rekam jejak (#43) tampil untuk semua.

**Architecture:**
- Semua teks UI dipusatkan di modul copy (`apps/web/lib/copy.ts`) + label di `lib/view.ts`; pesan alasan risiko dan
  kurasi di `@saf/core` diterjemahkan di sumbernya.
- Dua view SQL (security_invoker): `public_list` (anon + authenticated, tanpa `worth_level`) dan `curated_list`
  (authenticated saja, dengan `worth_level`), keduanya di atas `project_list` + curation terbaru + ringkasan sinyal.
  Halaman memilih view dari sesi; pemisahan dijaga RLS/grant Plan 5, bukan cuma UI.
- **Desain visual:** sistem desain C "Sertifikat inspeksi" (spec §16) dibangun di Plan 7 Task 3 (`apps/web/components/ui/*`,
  token di `app/globals.css`). Semua komponen di plan ini memakai komponen itu: `Stamp`, `Ticket`, `Tag`, `LinkStatus`,
  `MemberOnly`, `WorthBadge`, `TabBar`, `HazardBlock`, `SectionCard`.
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
  | rekam jejak (#43) | judul "Track record kami"; tiga cap: "{listed}" "Token listing", "{noToken}" "Ended tanpa token", "{riskRaised}" "Belakangan jadi risky"; catatan "Dari {total} airdrop yang lolos sebelum token listing dan sekarang udah ended." |
  | urutan | pengunjung "Baru dicek"; member "Paling worth it"; tab `ended` "Baru ended" |
  | bagian halaman project | "01 · AI verdict", "02 · Sumber yang beda cerita", "03 · Step garap", "04 · Security check", "05 · Estimasi effort", "06 · Kenapa lolos"; samping "Ringkasan", "Update terbaru" |
  | navigasi & akun | "Airdrop", "Kenapa AirdropIQ", "Track record", "Garapan saya", "Watchlist", "Login", "← Balik ke list" |
  | footer | "Not financial advice. Tetap DYOR sebelum connect wallet." |
  | sub-filter modal (#52) | label "Modal:"; pilihan "Semua" / "Gratis" / "Butuh $" (+ " · {n}"); tag baris "Gratis" / "Butuh ${x}+" / "Butuh $" / "Modal belum jelas" |
  | security check (#53) | badge "Re-check tiap pagi · terakhir {jam} WIB"; strip "Lapis cek" / "Source dibaca" / "Link dicek" / "Red flag"; badge "Wajib lolos" + "Satu aja gagal jalan, project ini gak bakal tampil. Bukan dianggap lolos."; kartu "Cek 01"…"Cek 04": "Minta seed phrase / bayar dulu", "Domain tiruan", "Umur domain", "Database phishing"; judul "Advanced check": "Riwayat hack", "Cross-check antar source", "AI baca halaman claim"; sumber "Scanner AirdropIQ", "Database AirdropIQ", "RDAP registry", "GoPlus Security", "DefiLlama Hacks", "Analisis AI" |
  | advanced check pengunjung (#54) | cap "Member only"; catatan "Hasil lengkapnya buat member. Kalau ada yang ketemu masalah, tetap kami tampilin ke semua orang." |
  | hasil garapan (#51) | "Dapet berapa dari airdrop ini?", "Gak dapet", "Hasil kamu", "Total hasil garapan", "Boleh dipakai anonim buat rata-rata hasil member", "Rata-rata member yang garap {project}: ≈ ${x} (dari {n} member yang mau berbagi)" |
  Sumber kebenaran teks: mockup `docs/design/airdropiq-c/*.dc.html` (spec §16). Kalau glosarium dan mockup beda,
  glosarium yang dipakai.
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
   detail tetap terbuka dengan peringatan "Gak masuk list: belum dinilai". Test di Task 3 dan 6.
2. **Analisis AI belum ada / gagal** → bagian "AI verdict" menampilkan "Analisis AI belum tersedia", halaman lain
   tetap lengkap. Test di Task 5.
3. **Teks hasil AI berisi markup/HTML atau URL** → dirender sebagai teks biasa (React escaping), URL gak jadi link. Test
   di Task 5.
4. **Tab kosong** → pesan kosong + angka ringkasan, bukan halaman kosong. Test di Task 4.
5. **Parameter `?tab=` gak dikenal** → default "Live sekarang", gak error 500. Test di Task 4.
6. **Project berakhir setelah lolos kurasi** (#40) → pindah ke tab "Ended", halaman detailnya tanpa banner
   "Gak masuk list" dan tanpa `noindex`, perubahannya tampil sebagai "Udah ended". Test di Task 4, 6, 7.
7. **Pengunjung membuka `?sort=worth` atau `?worth=high`** → parameter diabaikan (urut "Baru dicek"), gak error dan
   gak membocorkan urutan worth it. Test di Task 4.
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
    yang curation terbarunya (`computed_at desc, seq desc`) `passed = true`, `capital` (`free` | `deposit` | `unknown`)
    dan `capital_min_usd` (numeric | null) dari evidence terbaru per dokumen: ada `low`/`high` → `deposit`; semua
    yang menyebut `none` → `free`; gak ada → `unknown`; angka = `min(capital_min_usd)` (#52). **Tanpa** `worth_level`. `grant select` ke
    anon dan authenticated (#45).
  - `curated_list` = `public_list` + `worth_level`; `grant select` ke **authenticated saja**.
- Produces (TS):
  - `listCurated(db, tab: Tab, f: ListFilters & { worth?: WorthLevel[]; capital?: CapitalFilter }, page: number, member: boolean): Promise<CuratedPage>`;
    `CapitalFilter = "all" | "free" | "deposit"`; `CuratedPage` mendapat `capitalCounts: { all; free; deposit }`
    (dihitung dari tab yang sama setelah filter lain, sebelum filter modal);
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
  - `parseCapital(v: string | undefined): CapitalFilter` (default `all`) dan
    `capitalLabel(capital: "free" | "deposit" | "unknown", minUsd: number | null): string` (teks glosarium #52;
    angka diformat `id-ID` tanpa desimal, mis. "Butuh $1.000+").

- [ ] **Step 1: Test yang gagal** — pgTAP: project dengan curation terbaru `passed=false` gak muncul walau yang lama
  `passed=true`; project tanpa curation gak muncul; anon bisa select `public_list` tapi gak punya kolom `worth_level`
  dan ditolak di `curated_list` (`42501`); authenticated bisa keduanya. Vitest: `parseTab("x") === "live_now"`,
  `parseTab("ended") === "ended"`; `parseCapital("x") === "all"`; `capitalLabel("deposit", 1000)` =
  "Butuh $1.000+", `capitalLabel("deposit", null)` = "Butuh $"; pgTAP: project dengan evidence `none`
  dari satu dokumen dan `high` dari dokumen lain → `capital = 'deposit'`; `checkedLabel` untuk 0/1/3 hari dan > 48 jam; `getTrackRecord` → `null` saat
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
- Baris: nama, status, Worth it (member saja), risiko, "{k}/4 cek keamanan kunci jalan", "Dicek …" (#44), badge
  sinyal (`VC: Paradigm ✓` hanya untuk `vc_backer` verified; "Menurut AlphaDrops: …" untuk `reported_backer`; `TVL $45
  jt`; `Terdaftar di CoinGecko`; `Sumber kurasi`), badge "Claim open · link dicek" kalau `claim_open_checked`,
  deadline terdekat.
- Filter: status, risiko, chain (yang ada) + Worth it (member saja). Tab lewat `?tab=live_now|early_bets|ended`,
  filter lain dipertahankan.
- Sub-filter modal (#52, publik): baris "Modal:" tepat di bawah `TabBar`, pilihan lewat `?modal=all|free|deposit`
  dengan jumlah dari `capitalCounts`; ganti tab mempertahankan `?modal`. "Modal belum jelas" cuma muncul di "Semua".
  Tiap baris punya tag `capitalLabel` (komponen `Tag`: free = `verified`, deposit = `plain` isian `--member-fill`,
  unknown = `reported`). Di 360 px pilihan membungkus ke baris baru, gak scroll ke samping. Pengunjung melihat label urutan "Baru dicek".
- Rekam jejak (#43): kalimat glosarium di atas list kalau `getTrackRecord` gak `null`; juga dipasang di landing Plan 7.
- **Desain visual:** sebelum task ini dikerjakan, sistem desain (warna, tipografi, kartu/baris, state) yang disetujui
  owner ditambahkan sebagai Global Constraint plan ini; komponen task ini dan Task 5 mengikutinya.
- Baris di tab "Ended": status "Berakhir" + "Ended {tanggal}" (dari `ended_on`) menggantikan deadline terdekat.
- Kosong: "Belum ada airdrop yang lolos kurasi di tab ini." + ringkasan.

- [ ] **Step 1: Test yang gagal** — e2e: seed 1 project lolos `live_now`, 1 lolos `early_bets`, 1 lolos `ended`, 1 gagal →
  tab default cuma menampilkan yang `live_now`; klik "Early" menampilkan yang speculative; klik "Ended"
  menampilkan yang berakhir dengan "Ended {tanggal}"; yang gagal gak ada di tab mana pun;
  `?tab=xyz` menampilkan tab default; `?modal=free` cuma menampilkan project `free` dan tetap ada setelah klik tab
  "Early"; tag "Modal belum jelas" gak muncul di `?modal=deposit`; ringkasan "4 dicek" dan "3 lolos"; sebagai pengunjung gak ada
  teks "Worth it" dan `?sort=worth&worth=high` diabaikan; sebagai member "Worth it" tampil; tiap baris punya "Dicek".
  Komponen: `SignalBadges` gak pernah merender "✓" untuk `claimed_backer`/`reported_backer`.
- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter web test && pnpm --filter web e2e` lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): curated list with tabs, worth and signal badges"`

---

### Task 5: Halaman project baru

**Files:**
- Modify: `apps/web/app/(public)/projects/[slug]/page.tsx`, `apps/web/components/ProjectDetailView.tsx`,
  `apps/web/lib/queries.ts` (`getProjectDetail` diperluas), `packages/core/src/risk/assess.ts` (detail cek, #53),
  `pipeline/src/run.ts` (mengisi `officialDomainCount` dan jumlah dokumen ke input assess)
- Create: `supabase/migrations/0013_member_checks.sql`, `supabase/tests/member_checks.test.sql` (#54)
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
  pakai `steps`; dikelompokkan Daily/Weekly/Sekali) → Keamanan (alasan risiko + flag scam AI + status cek tiap
  link) → Effort (estimasi AI disandingkan dengan `source_rating` sumber, mis. "airdrops.io: Easy") → Update terbaru →
  Kenapa masuk list (sinyal + label sumber). Bagian Progress per wallet, Timeline perubahan, dan Tanya AI **belum**
  ada di sub-proyek ini (sub-proyek checklist, #3, #4).
- Teks AI dirender sebagai teks biasa; `source_url` jadi `ExternalLink` hanya kalau URL itu salah satu URL dokumen
  sumber project.
- **Publik vs member (#45):** pengunjung melihat Kepala ("Dicek …", tanpa level worth it), Kontradiksi, Langkah (dari
  `tasks.text_id`, jatuh ke `tasks.text`), Keamanan, Update terbaru, Kenapa masuk list. Bagian Keputusan AI dan Effort
  untuk pengunjung = kotak berjudul sama berisi "Member only" saja (tanpa tombol, #46); data `analyst` gak pernah
  di-query untuk pengunjung.
- **Security check (#53), persis mockup `CProject.dc.html` bagian 04:**
  - Core: `RiskCheck` jadi `{ id; ran: boolean; detail?: Record<string, string | number | null> }`. `assess` mengisi:
    `dangerous_asks` `{ sources }`, `lookalike` `{ compared }` (jumlah domain official di DB), `domain_age`
    `{ domain, ageDays }` (domain official utama), `phishing_list` `{ checked, hits }` (jumlah domain + link yang
    dicek GoPlus), `hack_history` `{ count }`, `corroboration` `{ sources }`. Gak ada perubahan skema DB (`checks`
    sudah jsonb).
  - `SafetyBox`: strip angka (Lapis cek = jumlah cek `ran` + AI scam kalau ada + cek link kalau ada link; Source
    dibaca; Link dicek dari `link_checks`; Red flag = alasan risiko severity ≥ medium + flag scam AI), 4 kartu wajib
    lolos, lalu "Advanced check" yang cuma berisi cek dengan `ran = true`. Tanggal daftar domain = `computed_at` −
    `ageDays`. Baris lama tanpa `detail` → kartu tetap tampil tanpa kalimat detail (gak ngarang angka).
  - **Advanced check khusus member (#54):** migrasi 0013: `revoke select (checks) on risk_assessments from anon`
    (grant kolom lain tetap); view `public_risk_checks` (security definer, owner postgres, `grant select` ke anon)
    per project dari assessment terbaru: `key_checks` = entri `dangerous_asks`/`lookalike`/`domain_age`/
    `phishing_list` lengkap dengan `detail`; `advanced_checks` = entri lain cuma `{ id, ran, flagged }`, `flagged` =
    ada alasan risiko yang berasal dari cek itu. `getProjectDetail` untuk pengunjung baca view ini, member baca tabel.
    `SafetyBox` pengunjung: baris advanced dengan `flagged = false` → cap "Member only"; `flagged = true` → baris
    merujuk ke peringatan risiko yang publik. Halaman lama yang baca `checks` (`coverageLine`) dipindah ke view.
- **Link (#42):** tiap link di Langkah dan Keamanan menampilkan status dari `link_checks` (glosarium); `phishing` →
  teks peringatan, bukan `<a>`; `different_domain` → link + peringatan. Kepala menampilkan "Claim open · link dicek"
  kalau `claim_open_checked`.

- [ ] **Step 1: Test yang gagal** — komponen: `AiDecision` dengan `analyst = null` → "Analisis AI belum tersedia";
  poin berisi `<b>x</b>` dirender sebagai teks; `WhyListed` menulis "Klaim project, belum verified" untuk
  `claimed_backer`; `StepsList` mengelompokkan cadence; pgTAP: anon `select checks from risk_assessments` → `42501`,
  anon bisa baca `public_risk_checks` tapi `advanced_checks` gak punya key `detail`; e2e pengunjung: tiga baris
  Advanced check berisi "Member only" dan gak ada teks "0 kasus"; member: "0 kasus" tampil; `SafetyBox` gak merender `token_security` dengan `ran = false`,
  merender kartu tanpa `detail` tanpa kalimat detail, dan "Red flag" = 0 kalau gak ada alasan ≥ medium; core:
  `assess` mengisi `domain_age.detail.ageDays` sama dengan input RDAP; `LinkStatus` dengan `phishing` gak merender `<a>`. e2e: halaman
  project lolos sebagai member menampilkan bagian dalam urutan di atas dan label "Analisis AI"; sebagai pengunjung
  bagian Keputusan AI dan Effort berisi "Member only", gak ada teks verdict ("Garap"/"Pantau"/"Skip"), dan gak ada
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
- Banner paling atas: "Gak masuk list: {alasan}" — alasan = pesan `fail` pertama dari curation terbaru, atau
  "belum dinilai" kalau gak ada curation.
- Watchlist: item yang curation terbarunya gagal (atau belum ada) diberi label yang sama.
- Curation terbaru `passed = true` dengan `tab = ended` **bukan** gagal: tanpa banner, tanpa `noindex`; kepala halaman
  menampilkan status "Berakhir" + "Ended {tanggal}".

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
- Teks: "Keluar dari list", "Masuk list", "Status berubah: {lama} → {baru}" (perubahan ke `ended`
  ditulis "Udah ended"), "Risiko berubah:
  {lama} → {baru}", "Deadline {jenis} dalam 48 jam ({tanggal})". Tombol "Tandai sudah dibaca" → `markChangesSeen`
  set `changes_seen_at = now()`.
- Ditampilkan di atas list `/airdrops` dan di watchlist; disembunyikan kalau kosong.

- [ ] **Step 1: Test yang gagal** — pgTAP: user A gak bisa membaca `project_changes` project yang cuma ada di watchlist
  user B; anon gak bisa sama sekali. e2e: project di watchlist berubah `curated` true→false → muncul "Keluar dari
  list"; project di watchlist berubah status live→ended → muncul "Udah ended" (bukan "Keluar dari list");
  setelah "Tandai sudah dibaca" hilang.
- [ ] **Step 2–4:** gagal → implementasi → pgTAP + test + e2e lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): changes since last visit for watched projects"`

---

### Task 8: Hasil garapan (#51)

**Files:**
- Modify: `supabase/migrations/0012_curated_list.sql` (tabel + fungsi di bawah), `apps/web/lib/farming.ts`,
  `apps/web/app/(app)/garapan/actions.ts`, `apps/web/components/farming/FarmingCard.tsx`, `apps/web/app/(app)/garapan/page.tsx`
- Create: `apps/web/lib/prices.ts`, `apps/web/components/farming/ResultBox.tsx`, `supabase/tests/farming_results.test.sql`
- Test: `apps/web/test/prices.test.ts`, `apps/web/test/components/farming/ResultBox.test.tsx`, e2e `farming.spec.ts`

**Interfaces:**
- SQL: `farming_results (user_id uuid, project_id uuid, amount numeric null check (amount > 0 and amount <= 1e15),
  no_reward boolean not null default false, claimed_on date null, usd_at_claim numeric null, share_anonymous boolean not
  null default false, updated_at timestamptz not null default now(), primary key (user_id, project_id), foreign key
  (user_id, project_id) references farming_projects on delete cascade, check (no_reward or amount is not null))`. RLS
  pemilik saja (select/insert/update/delete `user_id = (select auth.uid())`); anon gak punya akses.
- SQL: `farming_result_stats(p_project_id uuid) returns table (contributors integer, avg_usd numeric)` security definer,
  `set search_path = ''`, execute cuma `authenticated`: menghitung baris `share_anonymous` dengan `usd_at_claim` (yang
  `no_reward` dihitung $0); `avg_usd` = null kalau `contributors < 5`. Gak pernah mengembalikan `user_id` atau jumlah per
  orang.
- `lib/prices.ts`: `geckoIdFor(db, projectId): Promise<string | null>` dari `project_signals` `coingecko_listed`;
  `priceOn(geckoId, day): Promise<number | null>` (CoinGecko history, server-side, cache Next 24 jam) dan
  `priceNow(geckoId): Promise<number | null>` (cache 1 jam). Error, 429, atau tanpa key → `null`, gak throw. [UNKNOWN:
  batas API gratis CoinGecko dicek saat implementasi; kalau butuh key, `COINGECKO_API_KEY` server-side saja.]
- `actions.ts`: `submitResult(projectId, { amount, claimedOn, noReward, shareAnonymous })` cuma untuk project yang
  ended (curation `tab = 'ended'` atau status `ended`); validasi angka > 0, tanggal gak di masa depan; `usd_at_claim` =
  `amount × priceOn` kalau ada.
- UI persis mockup `CGarapan.dc.html`: "Dapet berapa dari airdrop ini?" (Jumlah token, Tanggal claim, "Simpan", "Gak
  dapet"); "Hasil kamu" ({jumlah} {simbol}, "≈ ${x} waktu claim ({tanggal}) · sekarang ≈ ${y}", link "Ubah", checkbox
  "Boleh dipakai anonim buat rata-rata hasil member"); harga gak ketemu → "Harga belum ketemu, jumlah token tetap
  tersimpan."; ringkasan atas "Total hasil garapan" (jumlah `usd_at_claim`); rata-rata cuma kalau stats gak null.

- [ ] **Step 1: Test yang gagal** — pgTAP: user A gak bisa baca/ubah hasil user B; `farming_result_stats` dengan 4
  kontributor → `avg_usd` null, dengan 5 → angka; baris `share_anonymous = false` gak dihitung; amount 0 ditolak
  `23514`. Vitest: `priceOn` dengan fetch 429 → `null`; `submitResult` menolak project yang belum ended dan tanggal
  besok. Komponen: `ResultBox` tanpa harga menampilkan teks "Harga belum ketemu". e2e: project ended → isi 1250 →
  "Hasil kamu" tampil dan "Total hasil garapan" bertambah.
- [ ] **Step 2–4:** gagal → implementasi → pgTAP + `pnpm --filter web test && pnpm --filter web e2e` lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): record airdrop results with USD value and opt-in anonymous average"`

---

## Selesai kalau

- `pnpm -r test`, typecheck, pgTAP, dan seluruh e2e lulus dengan teks Bahasa Indonesia.
- Di produksi (setelah satu run dengan Plan 5): tab "Live sekarang" cuma berisi project lolos kurasi, ringkasan
  angka sesuai `pipeline_runs.stats`, halaman project lolos menampilkan Analisis AI berlabel.
- Akses tetap khusus member (Plan 7).
