# Plan 7: Keanggotaan Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member cuma bisa ada karena owner menambahkannya satu per satu: gak ada signup, gak ada email (digest, reset
password, konfirmasi), dan semua data cuma bisa dibaca user yang login — di UI **dan** di database.

**Architecture:**
- Hapus tahap `notify` + Brevo + modul digest, tabel `notification_log`, fungsi unsubscribe, kolom digest di `profiles`.
- Hapus halaman signup, lupa password, update password, callback email, dan template email.
- Kunci akses: RLS tabel/view tampilan diganti dari `anon, authenticated` jadi `authenticated` saja; semua route kecuali
  landing (`/`) dan `/login` wajib login; list pindah ke `/airdrops`.
- Runbook owner: tambah user, reset password, hapus user, matikan signup di Supabase.

**Tech Stack:** sama dengan Plan 1–3.

**Spec:** `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` (keputusan #31–#34, §7, §8);
`docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (§8 digest dan §9 akun dinyatakan diganti).

**Urutan eksekusi:** plan ini dikerjakan **sebelum** Plan 4–6 (lebih kecil, dan menghapus kode yang kalau gak dihapus
akan ikut diterjemahkan/diubah di plan berikutnya). Nomor migrasi plan ini `0007`; Plan 4–6 memakai `0008`–`0011`.

## Prasyarat (owner, di Supabase Dashboard project `smart-airdrop-finder`)

- Authentication → Sign In / Providers: **matikan "Allow new users to sign up"**. Tanpa ini, signup tetap bisa lewat
  API dengan anon key walaupun halamannya dihapus.
- Authentication → Sign In / Providers → Email: **matikan "Secure password change"** (gak ada email untuk reautentikasi).
- Tambah user lewat Authentication → Users → Add user → Create new user, centang **Auto Confirm User**.

## Global Constraints

- Gak ada kode yang mengirim email. Gak ada dependensi ke Brevo, `BREVO_API_KEY`, `EMAIL_FROM`, `SITE_URL` (pipeline).
- Anon (belum login) gak bisa membaca **satu pun** tabel/view data airdrop lewat API: `projects`, `evidence`,
  `deadlines`, `tasks`, `links`, `risk_assessments`, `pipeline_runs`, `project_list`, `project_chains`, dan tabel baru
  di Plan 5–6 (`project_signals`, `ai_analyses`, `curations`, `curated_list`).
- Route publik cuma: `/` (landing), `/login`, aset statis. Selain itu redirect ke `/login?next=<path>` (aturan `next`
  yang ada tetap: `safe-next.ts`).
- Data user yang ada (`profiles`, `watchlist`, `wallets`, cache cek wallet) gak dihapus.
- Hapus akun sendiri (`delete_my_account`) tetap ada.
- Teks UI baru sudah Bahasa Indonesia (glosarium Plan 6); halaman lama yang belum diterjemahkan dibiarkan untuk Plan 6.
- Migrasi `0007_manual_membership.sql`; migrasi lama gak diubah.

## Review Focus

1. **Anon memanggil REST langsung** (`/rest/v1/project_list` dengan anon key) → 0 baris / permission denied. Test pgTAP
   di Task 3.
2. **User login membuka link lama `/projects/<slug>` atau `/?status=live`** → tetap jalan (list di `/airdrops`, `/`
   redirect ke `/airdrops` untuk user login dengan query dipertahankan). Test e2e di Task 3.
3. **Link email lama** (`/auth/callback?...`, `/unsubscribe?token=...`) → 404, bukan error 500. Test e2e di Task 2.
4. **Run harian dengan secret Brevo masih terpasang** → gak membaca/memakainya, run sukses. Test di Task 1.
5. **Sesi kedaluwarsa di tengah jalan** → redirect ke `/login?next=…`, bukan halaman kosong. Test e2e di Task 3.

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

### Task 3: Kunci akses data (RLS authenticated-only + route guard + landing)

**Files:**
- Modify: `supabase/migrations/0007_manual_membership.sql` (bagian B)
- Modify: `apps/web/lib/routes.ts` (daftar publik, bukan daftar terlindungi), `apps/web/lib/supabase/proxy.ts`
- Move: list `apps/web/app/(public)/page.tsx` → `apps/web/app/(app)/airdrops/page.tsx`; detail
  `apps/web/app/(public)/projects/[slug]/` → `apps/web/app/(app)/projects/[slug]/`
- Create: `apps/web/app/page.tsx` (landing: nama produk, satu paragraf positioning "Airdrop paling cuan, yang udah dicek
  aman, dan ada buktinya.", tombol "Masuk"; user login → redirect ke `/airdrops` dengan query dipertahankan)
- Test: `supabase/tests/web_views.test.sql` (assertion anon diubah), `supabase/tests/manual_membership.test.sql`,
  `apps/web/test/routes.test.ts`, e2e `projects.spec.ts`, `pagination.spec.ts`, `auth.spec.ts`

**Interfaces:**
- Migrasi bagian B: untuk tiap tabel tampilan (`projects`, `evidence`, `deadlines`, `tasks`, `links`, `risk_assessments`,
  `pipeline_runs`): `drop policy "public read"` lalu `create policy "member read" ... for select to authenticated using (true)`;
  `revoke select on <tabel> from anon`. View `project_list`, `project_chains`: `revoke select ... from anon`.
- `PUBLIC_PATHS = ["/", "/login"]`; `isPublicPath(pathname): boolean`. Proxy: path non-publik tanpa user →
  `/login?next=…`; `/login` dengan user → `/airdrops`.
- Link internal yang menunjuk `/` sebagai list diganti ke `/airdrops` (header, pagination, filter form action).

- [ ] **Step 1: Test yang gagal**

```sql
-- manual_membership.test.sql (as anon)
select is_empty($$ select 1 from public.projects $$, 'anon cannot read projects');
select throws_ok($$ select 1 from public.project_list $$, '42501', null, 'anon cannot read project_list');
-- as authenticated: project_list readable
```

```ts
it("treats only the landing and login pages as public", () => {
  expect(isPublicPath("/")).toBe(true); expect(isPublicPath("/login")).toBe(true);
  expect(isPublicPath("/airdrops")).toBe(false); expect(isPublicPath("/projects/ink")).toBe(false);
});
```

e2e: anonim ke `/airdrops` dan `/projects/<slug>` → `/login?next=…`; anonim ke `/` lihat landing + "Masuk"; user login
ke `/` → `/airdrops`; `/?status=live` untuk user login → `/airdrops?status=live`.
- [ ] **Step 2:** pgTAP + test → FAIL.
- [ ] **Step 3:** migrasi bagian B, route guard, pindah halaman, landing.
- [ ] **Step 4:** pgTAP (semua), `pnpm -r test`, typecheck, e2e → PASS.
- [ ] **Step 5:** commit `git commit -m "feat(web): members-only access in RLS and routing, landing page"`

---

### Task 4: Runbook owner + update spec v1

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
- Di produksi (setelah migrasi `0007` di-apply dan deploy): request REST anon ke `project_list` ditolak, `/airdrops`
  tanpa login redirect ke `/login`, owner bisa menambah user lewat Dashboard lalu user itu bisa login.
- Owner sudah mematikan signup dan secure password change di Supabase Dashboard.
