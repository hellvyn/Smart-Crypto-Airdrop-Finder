# Plan 7: Keanggotaan Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member cuma bisa ada karena owner menambahkannya satu per satu: gak ada signup, gak ada email (digest, reset
password, konfirmasi). Web **publik** untuk pengunjung (landing + list + halaman project, keputusan #45); fitur akun
(watchlist, wallet, pengaturan, nanti Garapan saya) khusus member. Data khusus member (level worth it, AI verdict, estimasi effort)
dikunci di Plan 5–6.

**Architecture:**
- Hapus tahap `notify` + Brevo + modul digest, tabel `notification_log`, fungsi unsubscribe, kolom digest di `profiles`.
- Hapus halaman signup, lupa password, update password, callback email, dan template email.
- Akses (#45, menggantikan rencana "semua khusus member" #33): tabel/view tampilan v1 tetap bisa dibaca publik (RLS
  sekarang); route akun tetap wajib login; list pindah ke `/airdrops`, `/` jadi landing publik.
- Runbook owner: tambah user, reset password, hapus user, matikan signup di Supabase.

**Tech Stack:** sama dengan Plan 1–3.

**Spec:** `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` (keputusan #31, #32, #34, #45–#49, §7, §8,
§15.5, §16);
`docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (§8 digest dan §9 akun dinyatakan diganti).

**Urutan eksekusi:** plan ini dikerjakan **sebelum** Plan 4–6 (lebih kecil, dan menghapus kode yang kalau gak dihapus
akan ikut diterjemahkan/diubah di plan berikutnya). Nomor migrasi plan ini `0007`. Urutan eksekusi semua plan: 7 → 4 → 8 → 5 → 6 (migrasi `0008`–`0012`).

## Prasyarat (owner, di Supabase Dashboard project `smart-airdrop-finder`)

- Authentication → Sign In / Providers: **matikan "Allow new users to sign up"**. Tanpa ini, signup tetap bisa lewat
  API dengan anon key walaupun halamannya dihapus.
- Authentication → Sign In / Providers → Email: **matikan "Secure password change"** (gak ada email untuk reautentikasi).
- Tambah user lewat Authentication → Users → Add user → Create new user, centang **Auto Confirm User**.

## Global Constraints

- Gak ada kode yang mengirim email. Gak ada dependensi ke Brevo, `BREVO_API_KEY`, `EMAIL_FROM`, `SITE_URL` (pipeline).
- Tabel/view data airdrop v1 tetap baca publik (gak ada perubahan RLS di plan ini). Pembagian kolom/baris khusus member
  ada di Plan 5 (`curations`, `ai_analyses`) dan Plan 6 (`public_list` vs `curated_list`), spec §15.5.
- Route publik: `/` (landing), `/airdrops`, `/projects/<slug>`, `/login`, aset statis. Route akun (`/watchlist`,
  `/wallets`, `/settings`, dan `/garapan` dari Plan 8) redirect ke `/login?next=<path>` kalau belum login (aturan `next`
  yang ada tetap: `safe-next.ts`).
- Gak ada tombol/link pendaftaran di mana pun (#46).
- Data user yang ada (`profiles`, `watchlist`, `wallets`, cache cek wallet) gak dihapus.
- Hapus akun sendiri (`delete_my_account`) tetap ada.
- Teks UI baru sudah Bahasa Indonesia sesuai glosarium dan aturan gaya tulisan di Plan 6 (Global Constraints); halaman
  lama yang belum diterjemahkan dibiarkan untuk Plan 6.
- Nama produk **AirdropIQ** (#47) dan sistem desain C "Sertifikat inspeksi" (#48, spec §16) mulai dipakai di plan ini.
- Migrasi `0007_manual_membership.sql`; migrasi lama gak diubah.

## Review Focus

1. **Anon memanggil REST langsung ke tabel user** (`/rest/v1/watchlist`, `wallets`, `profiles` dengan anon key) → 0
   baris. Test pgTAP di Task 4 (RLS yang ada, dikunci sebagai regresi).
2. **Link lama `/?status=live`** (bookmark list v1) → redirect ke `/airdrops?status=live` untuk siapa saja; `/` tanpa
   query = landing. Test e2e di Task 4.
3. **Link email lama** (`/auth/callback?...`, `/unsubscribe?token=...`) → 404, bukan error 500. Test e2e di Task 2.
4. **Run harian dengan secret Brevo masih terpasang** → gak membaca/memakainya, run sukses. Test di Task 1.
5. **Sesi kedaluwarsa di tengah jalan** → redirect ke `/login?next=…`, bukan halaman kosong. Test e2e di Task 4.
6. **Layar HP 360 px** → header, landing, list, dan kartu gak kepotong atau scroll ke samping (kecuali tabel di dalam
   kotak scroll-nya sendiri). Test e2e viewport 360×740 di Task 3.

---

### Task 1: Hapus digest dari pipeline dan core

**Files:**
- Delete: `pipeline/src/steps/notify.ts`, `pipeline/src/notify/email-sender.ts`, `packages/core/src/notify/` (digest, quota,
  render), test terkait (`pipeline/test/notify.test.ts`, `pipeline/test/email-sender.test.ts`, test core notify)
- Modify: `pipeline/src/run.ts` (tahap notify + `STEP.notify` dihapus; nomor step lain tetap), `pipeline/src/main.ts`,
  `pipeline/src/config.ts` (`EmailConfig`, `loadEmailEnv`, `parseEmailFrom`, `DEFAULT_SENDER_NAME` dihapus),
  `pipeline/src/store/repo.ts` + memory + supabase (method digest dihapus: `listDigestRecipients`, `getDigestContext`,
  `listNewProjects`, `countDigestsSent`, `hasDigest`, `logDigest`, `DuplicateDigestError`), `packages/core/src/index.ts`,
  `pipeline/src/stats.ts` (`runExitCode` gak lagi menyebut `digests_failed`)
- Modify: `.github/workflows/daily.yml` (env `BREVO_API_KEY`, `EMAIL_FROM`, `SITE_URL` dihapus)
- Modify: `docs/ops/pipeline.md`; Delete: `docs/ops/email.md`
- Test: `pipeline/test/run.test.ts`, `pipeline/test/config.test.ts`, `pipeline/test/stats.test.ts`

- [ ] **Step 1: Test yang gagal**

```ts
it("runs without any email settings and reports no digest counters", async () => {
  const stats = await runDaily(deps, defaultConfig);
  expect(Object.keys(stats).some((k) => k.startsWith("digests_"))).toBe(false);
});
it("ignores Brevo variables left in the environment", async () => {
  // main(): env with BREVO_API_KEY set → exit code 0 on a clean fake run, no network call to api.brevo.com
});
```

- [ ] **Step 2:** `pnpm --filter pipeline exec vitest run` → FAIL.
- [ ] **Step 3:** hapus kode + rapikan import.
- [ ] **Step 4:** `pnpm -r test && pnpm -r typecheck` → PASS; `grep -rniE "brevo|digest" pipeline/src packages/core/src` → kosong.
- [ ] **Step 5:** commit `git commit -m "refactor: remove email digest (members are managed manually)"`

---

### Task 2: Hapus signup, lupa password, callback email, unsubscribe + migrasi

**Files:**
- Delete: `apps/web/app/(auth)/signup/`, `apps/web/app/(auth)/reset-password/`, `apps/web/app/(auth)/update-password/`,
  `apps/web/app/auth/callback/`, `apps/web/lib/auth-callback.ts`, `apps/web/app/unsubscribe/`, `supabase/templates/`,
  e2e `apps/web/e2e/unsubscribe.spec.ts`, unit test terkait
- Modify: `apps/web/app/(auth)/actions.ts` (cuma `logIn` + `logOut`), `apps/web/app/(auth)/login/page.tsx` (hapus link
  "Sign up" dan "Forgot your password?"; tambah teks "Belum punya akses? Hubungi admin."), `apps/web/components/site-header.tsx`,
  `apps/web/app/(app)/settings/page.tsx` + `actions.ts` + `lib/settings.ts` (toggle digest & opsi airdrop baru dihapus),
  `supabase/config.toml` (`enable_signup = false`, `secure_password_change = false`, `enable_confirmations` tetap false),
  `apps/web/e2e/support/*` (pembuatan user test tetap lewat `auth.admin.createUser` dengan `email_confirm: true`)
- Create: `supabase/migrations/0007_manual_membership.sql` (bagian A: `drop function public.unsubscribe_digest(uuid)`,
  `drop table public.notification_log`, `alter table public.profiles drop column digest_enabled, drop column new_airdrops_opt_in, drop column unsubscribe_token`)
- Test: `supabase/tests/notifications.test.sql` dihapus; `supabase/tests/manual_membership.test.sql` (baru)

- [ ] **Step 1: Test yang gagal** — pgTAP: `notification_log` gak ada, `unsubscribe_digest` gak ada, kolom digest di
  `profiles` gak ada, `profiles` + RLS-nya yang lain tetap. e2e: `/signup`, `/reset-password`, `/update-password`,
  `/auth/callback`, `/unsubscribe` → 404; halaman login gak punya link daftar/lupa password.
- [ ] **Step 2:** `npx -y supabase@2.120.0 db reset && npx -y supabase@2.120.0 test db` + `pnpm --filter web e2e` → FAIL.
- [ ] **Step 3:** hapus + migrasi bagian A + config.
- [ ] **Step 4:** pgTAP, `pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter web e2e` → PASS.
- [ ] **Step 5:** commit `git commit -m "refactor(web): remove signup, password reset, email callback and unsubscribe"`

---

### Task 3: Sistem desain C "Sertifikat inspeksi" + brand AirdropIQ

**Files:**
- Modify: `apps/web/app/globals.css` (token + kelas dasar; hapus tema gelap `prefers-color-scheme`, desain C cuma terang
  di versi ini), `apps/web/app/layout.tsx` (`next/font/google`: Barlow 400/500/600/700 + Barlow Condensed 600/800;
  `<html lang="id">`; metadata title "AirdropIQ" dan description "Airdrop yang udah dicek, lengkap dengan source-nya."),
  `apps/web/components/site-header.tsx` (strip hazard 10 px di atas, logo kotak "IQ" + "AirdropIQ", nav huruf kapital,
  tombol "Login" hitam; link akun cuma untuk user login)
- Create: `apps/web/components/ui/` berisi `Stamp.tsx`, `HazardBar.tsx`, `HazardBlock.tsx`, `Ticket.tsx`, `Tag.tsx`,
  `LinkStatus.tsx`, `MemberOnly.tsx`, `WorthBadge.tsx`, `TabBar.tsx`, `SectionCard.tsx`, `Button.tsx`, `index.ts`
- Create: `docs/design/airdropiq-c/README.md` (cara pakai komponen; mockup acuan ada di folder ini)
- Test: `apps/web/test/components/ui/*.test.tsx`, e2e `apps/web/e2e/layout.spec.ts`

**Interfaces (nilai persis dari spec §16):**
- Token CSS di `:root`: `--ground #F7F7F2`, `--surface #FFFFFF`, `--ink #111111`, `--ink-2 #2B2B28`, `--muted #3D3D3A`,
  `--line-soft #CFCFC8`, `--accent #FF5A1F` (isian saja; teks oranye kecil pakai `--accent-text #C2410C`),
  `--pass #1F7A45`, `--ended #55554F`, `--caution #B45309`, `--warn-fill #FFD7C2`, `--member-fill #FFF1EA`;
  `--hazard: repeating-linear-gradient(-45deg, var(--ink) 0 14px, var(--accent) 14px 28px)`. Sudut 0 di semua
  komponen. Garis 2 px (kartu, tiket), 3 px (header, kontainer utama, tombol), putus-putus 2 px (Member only).
- `Stamp({ top: string; bottom: string; tone: "pass" | "ended" | "caution"; size: "sm" | "md" | "lg"; rotate: number })`:
  lingkaran bergaris (sm 58 px/3 px, md 92 px/4 px, lg 150 px/5 px), teks atas Barlow Condensed 800, rotasi derajat dari
  prop (dibatasi −10..10). `aria-label` = `${top} ${bottom}`.
- `HazardBar()` strip 10 px; `HazardBlock({ children })` bingkai strip hazard 8 px berisi panel putih.
- `Ticket({ href, children })` baris/kartu putih bergaris 2 px, grid 5 kolom di ≥ 960 px, 1 kolom di bawahnya.
- `Tag({ tone: "verified" | "reported" | "plain" | "claimOpen" | "warn", children })`: verified = garis `--pass`;
  reported = putus-putus; claimOpen = isian hitam teks terang; warn = isian `--warn-fill`.
- `LinkStatus({ status: "official" | "different_domain" | "phishing" | "unchecked"; url: string })`: `phishing` merender
  `HazardBlock` berisi teks glosarium, **tanpa** `<a>`; lainnya `ExternalLink` + `Tag`.
- `MemberOnly({ title })` kotak putus-putus berisi "Member only", tanpa tombol.
- `WorthBadge({ level })`: high = isian `--accent` + garis hitam, medium = putih + garis hitam, low = teks `--ended`.
- `TabBar({ tabs: { label: string; count?: number; href: string; active: boolean }[] })`: tab aktif isian hitam + garis
  bawah oranye 4 px; target sentuh ≥ 44 px.
- `SectionCard({ number?: string; title: string; badge?: string; children })` judul "01 · …" Barlow Condensed huruf kapital.
- `Button({ variant: "primary" | "secondary" | "dark" })`: primary isian oranye + garis 3 px hitam; huruf kapital.

- [ ] **Step 1: Test yang gagal** — komponen: `LinkStatus` status `phishing` gak punya elemen `a`; `Stamp` rotasi 30
  dibatasi jadi 10; `MemberOnly` gak punya `button`/`a`; `TabBar` aktif punya `aria-current="page"`. e2e `layout.spec.ts`:
  `<html lang="id">`, judul tab "AirdropIQ", header punya "AirdropIQ" dan "Login" untuk pengunjung, dan di viewport
  360×740 `document.documentElement.scrollWidth <= 360`.
- [ ] **Step 2:** test → FAIL.
- [ ] **Step 3:** token, font, komponen, header. Halaman lama tetap jalan (boleh belum memakai komponen baru).
- [ ] **Step 4:** `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web e2e` → PASS.
- [ ] **Step 5:** commit `git commit -m "feat(web): AirdropIQ brand and design system C components"`

---

### Task 4: Landing publik, list di `/airdrops`, route akun tetap terlindungi

**Files:**
- Modify: `apps/web/lib/routes.ts` (`PROTECTED_PREFIXES` tetap `["/watchlist", "/wallets", "/settings"]`; Plan 8
  menambah `/garapan`), `apps/web/lib/supabase/proxy.ts` (`/?<query>` → `/airdrops?<query>`)
- Move: list `apps/web/app/(public)/page.tsx` → `apps/web/app/(public)/airdrops/page.tsx` (detail
  `apps/web/app/(public)/projects/[slug]/` tetap di tempatnya)
- Create: `apps/web/app/(public)/page.tsx`, landing persis mockup `docs/design/airdropiq-c/CLanding.dc.html`
  (komponen Task 3, teks dari glosarium Plan 6):
  - Hero: "Airdrop yang worth it digarap, udah kami cek duluan." + paragraf "Kami udah terlalu sering lihat orang kena
    link claim palsu di grup Telegram. Makanya aturannya simpel. Airdrop yang gak lolos 4 security check gak bakal tampil
    di sini, se-hype apa pun." + tombol "Lihat airdrop" (`/airdrops`) dan "Kenapa AirdropIQ" (`#kenapa`). Kotak "Update
    hari ini" (angka disembunyikan sampai Plan 6 menyediakan `getRunSummary`) dengan cap "LOLOS 4/4 CEK".
  - `#kenapa`: badge "Re-check tiap pagi, 06.00 WIB", judul "Tiap hari semua airdrop kami cek ulang dari nol.", cap besar,
    dua paragraf persis mockup.
  - Track record: blok dipasang tapi **gak dirender** sampai Plan 6 Task 4 menyambungkan `getTrackRecord` (≥ 10).
  - "Apa bedanya gratis sama member?" (judul di tengah): tabel 12 baris persis mockup (6 gratis, 6 member only), tanpa
    harga dan tanpa tombol daftar (#46).
  - Footer: "© 2026 AirdropIQ" + "Not financial advice. Tetap DYOR sebelum connect wallet."
- Create: `supabase/tests/manual_membership.test.sql`
- Test: `apps/web/test/routes.test.ts`, e2e `projects.spec.ts`, `pagination.spec.ts`, `auth.spec.ts`

**Interfaces:**
- Gak ada perubahan RLS tabel tampilan (#45). pgTAP mengunci regresi: anon gak bisa membaca `watchlist`, `wallets`,
  `profiles`, dan bisa membaca `project_list`.
- `isProtectedPath` tetap; `/login` dengan user → `/airdrops`.
- Link internal yang menunjuk `/` sebagai list diganti ke `/airdrops` (header, pagination, filter form action, link
  "kembali" di halaman project).

- [ ] **Step 1: Test yang gagal**

```sql
-- manual_membership.test.sql (as anon)
select is_empty($$ select 1 from public.watchlist $$, 'anon cannot read watchlists');
select isnt_empty($$ select 1 from public.project_list $$, 'anon can read the public list');
```

```ts
it("keeps the list and project pages public and account pages protected", () => {
  expect(isProtectedPath("/airdrops")).toBe(false); expect(isProtectedPath("/projects/ink")).toBe(false);
  expect(isProtectedPath("/watchlist")).toBe(true);
});
```

e2e: anonim ke `/airdrops` dan `/projects/<slug>` → halaman tampil; anonim ke `/watchlist` → `/login?next=…`; anonim ke
`/` lihat landing + "Lihat airdrop" + "Login" + tabel "Apa bedanya gratis sama member?" dan gak ada teks "Daftar";
`/?status=live` → `/airdrops?status=live`.
- [ ] **Step 2:** pgTAP + test → FAIL.
- [ ] **Step 3:** pindah halaman, landing, redirect query lama, ganti link internal.
- [ ] **Step 4:** pgTAP (semua), `pnpm -r test`, typecheck, e2e → PASS.
- [ ] **Step 5:** commit `git commit -m "feat(web): public landing, list at /airdrops, account pages stay protected"`

---

### Task 5: Runbook owner + update spec v1

**Files:**
- Modify: `docs/ops/web.md` (bagian baru "Kelola member": tambah user dengan Auto Confirm, reset password lewat
  Dashboard → Users → Send/Reset atau set password manual, hapus user, matikan signup, matikan secure password change;
  hapus bagian SMTP/Confirm email/template), `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (catatan di
  §8 dan §9: "Diganti keputusan #31–#34, lihat spec kurasi"), `docs/ops/pipeline.md` (secret yang dipakai)

- [ ] **Step 1:** tulis runbook; **Step 2:** `grep -rniE "brevo|digest|signup|sign up|reset-password" docs/ops` cuma
  menemukan catatan "dihapus"; **Step 3:** commit `git commit -m "docs(ops): manual membership runbook"`

---

## Selesai kalau

- Semua test, typecheck, pgTAP, e2e lulus.
- Di produksi (setelah migrasi `0007` di-apply dan deploy): `/` landing, `/airdrops` terbuka untuk pengunjung,
  `/watchlist` tanpa login redirect ke `/login`, owner bisa menambah user lewat Dashboard lalu user itu bisa login.
- Owner sudah mematikan signup dan secure password change di Supabase Dashboard.
