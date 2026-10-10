# Plan 3: Email Digest Harian — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setelah pipeline harian selesai, tiap user yang aktifin digest dapat **maksimal satu email** berisi deadline 48 jam di
watchlist-nya, perubahan status atau risiko, dan (opsional) airdrop baru. Kirimnya tetap di dalam kuota harian provider.

**Architecture:**
- Logika digest dan alokasi kuota berupa fungsi murni di `@saf/core`.
- Step `notify` di pipeline ngumpulin data per user lewat repository, render email, dan kirim lewat interface `EmailSender`
  (implementasi awal: Brevo).
- Berhenti langganan pakai token acak per profil, lewat fungsi SQL `SECURITY DEFINER`.

**Tech Stack:** sama dengan Plan 1 dan 2. Brevo Transactional API (`POST https://api.brevo.com/v3/smtp/email`).

**Spec:** `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (§8, §9)

**Bergantung ke:**
- Plan 1: `runDaily`, `PipelineRepo`, tabel `project_changes`, `deadlines`, `risk_assessments`
- Plan 2: tabel `profiles` (kolom `digest_enabled`, `new_airdrops_opt_in`, `timezone`, `unsubscribe_token`), dan `watchlist`

## Prasyarat (owner)

- Spec §12 #6: verifikasi limit dan syarat Brevo dari halaman resmi.
- Bikin akun Brevo, verifikasi domain pengirim, lalu simpan secret `BREVO_API_KEY`, `EMAIL_FROM`, dan `SITE_URL`.

## Global Constraints

- Maksimal **1 email digest per user per hari** (tanggal UTC). Digest gak dikirim kalau isinya kosong.
- Deadline yang masuk digest:
  - Tanggal antara hari ini (UTC) sampai **+48 jam**
  - `kind ∈ {claim, snapshot, campaign_end, withdraw_funds}`
  - `precision ∈ {exact, approximate}`
- Urutan bagian digest:
  1. Deadline 48 jam
  2. Perubahan status atau level risiko sejak digest terakhir
  3. Airdrop baru hari ini (cuma kalau `new_airdrops_opt_in`)
- Kuota: `emailDailyLimit` default **300** (Brevo Free), `reserveRatio` **0.2** buat email auth. Budget digest =
  `floor(300 × 0.8)` = **240** dikurangi digest yang udah terkirim hari itu.
- Prioritas kalau kuota gak cukup: ada deadline (0) → ada perubahan risiko (1) → sisanya (2).
- Cuma kirim ke email yang **sudah terverifikasi**.
- Log dan `RunStats` cuma berisi angka. **Gak boleh** ada email atau user ID di log.
- Tiap email punya link berhenti langganan. Copy email bahasa Inggris.
- Teks dari sumber (nama project, teks deadline) **wajib di-escape** di HTML email.

## Review Focus

1. **Pemindai link di email client** (Outlook/Gmail safe-links) buka URL berhenti langganan secara otomatis. GET gak boleh langsung
   unsubscribe: GET cuma nampilin tombol, aksinya lewat POST. Dites di Task 5.
2. **Nama project dari hasil scraping berisi HTML** (`<img src=x onerror=…>`) → harus di-escape di email. Dites di Task 3.
3. **Job diulang di hari yang sama** setelah sebagian email terkirim → user yang udah dapat gak dikirim lagi. Dites di Task 4.
4. **User yang belum verifikasi email** gak pernah dikirimi digest. Dites di Task 4.
5. **Deadline "hari ini" yang jamnya udah lewat:** tetap masuk digest kalau tanggalnya hari ini UTC, karena presisi kita cuma
   tanggal. Copy-nya nulis "today". Dites di Task 2.

---

## File Structure

```
supabase/migrations/0003_notifications.sql   notification_log, unsubscribe_digest(token)
supabase/tests/notifications.test.sql
packages/core/src/notify/digest.ts           buildDigest
packages/core/src/notify/quota.ts            allocateQuota
packages/core/src/notify/render.ts           renderDigestEmail
pipeline/src/notify/email-sender.ts          EmailSender + BrevoSender
pipeline/src/steps/notify.ts                 notifyStep
pipeline/src/store/repo.ts                   (modify) metode notifikasi
apps/web/app/unsubscribe/page.tsx + actions.ts
docs/ops/email.md                            setting SMTP Supabase Auth
```

---

### Task 1: Skema notifikasi + fungsi berhenti langganan

**Files:**
- Create: `supabase/migrations/0003_notifications.sql`
- Test: `supabase/tests/notifications.test.sql`

**Interfaces:**
- Produces:
  - Tabel `notification_log(id, user_id → auth.users on delete cascade, kind text check ('digest'), ref_date date, sent_at timestamptz, unique(user_id, kind, ref_date))`.
    RLS aktif, tanpa policy (cuma service role).
  - Fungsi `public.unsubscribe_digest(token uuid) returns boolean`, `SECURITY DEFINER`, boleh dipanggil `anon`. Set
    `digest_enabled = false` di profil yang `unsubscribe_token`-nya cocok. Return `true` kalau ada baris yang berubah.

- [ ] **Step 1: Tulis test pgTAP yang gagal:**
  - Token valid → `true` dan `digest_enabled = false`
  - Token acak → `false`
  - Insert `notification_log` dobel (user, kind, tanggal sama) → error unique violation
  - Role `anon` gak bisa `select` dari `notification_log`
- [ ] **Step 2: Jalankan `supabase db reset && supabase test db`.** Expected: FAIL
- [ ] **Step 3: Tulis migrasi.**
- [ ] **Step 4: Jalankan lagi.** Expected: PASS
- [ ] **Step 5: Commit** `feat(db): notification log and digest unsubscribe`

### Task 2: `buildDigest` + `allocateQuota`

**Files:**
- Create: `packages/core/src/notify/digest.ts`, `packages/core/src/notify/quota.ts`
- Test: `packages/core/test/digest.test.ts`, `packages/core/test/quota.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DigestProject { id: string; slug: string; name: string; status: Status; riskLevel: RiskLevel | null }
export interface DigestInput {
  now: Date;
  watched: DigestProject[];
  deadlines: { projectId: string; kind: DeadlineKind; date: string; precision: DatePrecision; text: string }[];
  changes: { projectId: string; field: "status" | "risk_level"; oldValue: string | null; newValue: string; changedAt: Date }[];
  newProjects: DigestProject[] | null;        // null = user gak opt-in
}
export interface Digest {
  deadlinesSoon: { project: DigestProject; kind: DeadlineKind; date: string; precision: DatePrecision; isToday: boolean }[];
  changes: { project: DigestProject; field: "status" | "risk_level"; oldValue: string | null; newValue: string }[];
  newProjects: DigestProject[];
  priority: 0 | 1 | 2;
}
export function buildDigest(input: DigestInput): Digest | null;
export function allocateQuota(candidates: { key: string; priority: 0 | 1 | 2 }[],
  opts: { dailyLimit: number; reserveRatio: number; sentToday: number }): { send: string[]; skipped: number };
```

- [ ] **Step 1: Tulis test yang gagal.** Pakai `now = 2026-10-10T23:30Z`:
  - Deadline `claim`, `exact`, `2026-10-12` → masuk
  - `2026-10-13` → gak masuk
  - `2026-10-10` → masuk dengan `isToday:true`
  - `2026-10-09` → gak masuk
  - Deadline `tge` atau presisi `quarter` → gak masuk
  - Deadline milik project yang gak di-watch → gak masuk
  - Ada deadline → `priority 0`. Cuma perubahan `risk_level` → `1`. Cuma perubahan `status` atau project baru → `2`
  - Semua bagian kosong → `null`
  - `newProjects: null` → bagian project baru kosong
  - `allocateQuota` 300 kandidat, `dailyLimit 300`, `reserveRatio 0.2`, `sentToday 0` → `send.length 240`, `skipped 60`, dan semua
    kandidat priority 0 masuk lebih dulu (urutan dalam prioritas yang sama tetap)
  - `sentToday 240` → `send: []`
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.** Perbandingan tanggal pakai string `YYYY-MM-DD` di UTC.
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(core): digest builder and email quota allocation`

### Task 3: Render email

**Files:**
- Create: `packages/core/src/notify/render.ts`
- Test: `packages/core/test/render.test.ts`

**Interfaces:**
- Consumes: `Digest` (Task 2)
- Produces: `renderDigestEmail(d: Digest, opts: { siteUrl: string; unsubscribeUrl: string }): { subject: string; text: string; html: string }`

**Copy (exact):**
- Subject:
  - Kalau ada deadline: `` `Airdrop digest: ${n} deadline${n === 1 ? "" : "s"} in the next 48h` ``
  - Selain itu: `"Airdrop digest: updates on your watchlist"`
- Judul bagian: `"Deadlines in the next 48 hours"`, `"Status and risk changes"`, `"New airdrops today"`
- Deadline hari ini ditulis `"today"`. Presisi `approximate` dikasih awalan `"around "`.
- Footer: `"You get this email because daily digest is on. Unsubscribe: <unsubscribeUrl>"`
- Tiap project link ke `${siteUrl}/projects/${slug}`. Level risiko pakai label yang sama dengan web (`Low`/`Medium`/`High`/
  `Critical`/`Insufficient data`). Gak pernah ada kata "safe".

- [ ] **Step 1: Tulis test yang gagal:**
  - 2 deadline → subject `"Airdrop digest: 2 deadlines in the next 48h"`
  - Nama project `<img src=x onerror=alert(1)>` → `html` mengandung `&lt;img` dan **gak** mengandung `<img src=x`
  - `text` dan `html` sama-sama mengandung `unsubscribeUrl`
  - Deadline `approximate` → mengandung `"around "`
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi** (HTML tabel inline sederhana, tanpa library template). **Jalankan
  lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(core): digest email rendering`

### Task 4: Pengirim email + step `notify` di pipeline

**Files:**
- Create: `pipeline/src/notify/email-sender.ts`, `pipeline/src/steps/notify.ts`
- Modify: `pipeline/src/store/repo.ts`, `memory-repo.ts`, `supabase-repo.ts` (tambah metode di bawah), `pipeline/src/run.ts`
  (panggil `notifyStep` setelah score), `pipeline/src/config.ts`
- Modify: `.github/workflows/daily.yml` (env `BREVO_API_KEY`, `EMAIL_FROM`, `SITE_URL`)
- Test: `pipeline/test/notify.test.ts`, `pipeline/test/email-sender.test.ts`

**Interfaces:**
- Consumes: `buildDigest`, `allocateQuota`, `renderDigestEmail` (Task 2–3)
- Produces:

```ts
export interface EmailSender { send(m: { to: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; status: number }> }
export class BrevoSender implements EmailSender { constructor(deps: { fetch: typeof fetch; apiKey: string; from: { email: string; name: string } }) }
// tambahan di PipelineRepo:
listDigestRecipients(): Promise<{ userId: string; email: string; newAirdropsOptIn: boolean; unsubscribeToken: string; lastDigestAt: Date | null }[]>;  // digest_enabled + email terverifikasi
getDigestContext(userId: string, since: Date | null, now: Date): Promise<Omit<DigestInput, "now" | "newProjects">>;
listNewProjects(sinceHours: number, now: Date): Promise<DigestProject[]>;
countDigestsSent(refDate: string): Promise<number>;
hasDigest(userId: string, refDate: string): Promise<boolean>;
logDigest(userId: string, refDate: string, at: Date): Promise<void>;
// config:
email: { enabled: boolean; dailyLimit: number; reserveRatio: number; siteUrl: string };   // enabled = BREVO_API_KEY ada
export function notifyStep(deps: { repo: PipelineRepo; sender: EmailSender; now: () => Date }, cfg: PipelineConfig["email"]): Promise<RunStats>;
// counter: digests_sent, digests_empty, digests_skipped_quota, digests_failed, digests_already_sent
```

**Detail:**
- `BrevoSender` kirim `POST https://api.brevo.com/v3/smtp/email` dengan header `api-key` dan body
  `{sender, to:[{email}], subject, htmlContent, textContent}`. Sukses = HTTP 201.
- Di `SupabaseRepo`, email diambil lewat `auth.admin.listUsers` (dipaginasi). Cuma user dengan `email_confirmed_at` gak null.
- `notifyStep` jalan begini:
  1. Ambil penerima, buang yang `hasDigest` hari ini
  2. `buildDigest` per user
  3. `allocateQuota`
  4. Kirim satu per satu, maksimal 5 request paralel
  5. `logDigest` **cuma setelah** `ok`
- Kalau satu pengiriman gagal, counter `digests_failed` naik dan loop lanjut. Gak ada retry di run yang sama.
- `unsubscribeUrl = ${siteUrl}/unsubscribe?token=${unsubscribeToken}`

- [ ] **Step 1: Tulis test yang gagal.** Pakai `MemoryRepo` + fake sender:
  - 3 user, satu tanpa isi digest → `digests_sent 2, digests_empty 1`
  - `notifyStep` jalan dua kali di hari yang sama → total pengiriman tetap 2, `digests_already_sent 2` di run kedua
  - Sender gagal buat 1 user → `digests_failed 1`, user itu gak di-log, sehingga besok bisa dikirim lagi
  - `dailyLimit 2`, `reserveRatio 0`, 3 penerima → `digests_skipped_quota 1`
  - User yang belum verifikasi email gak ada di `listDigestRecipients` (dites di `MemoryRepo` lewat flag `emailConfirmed:false`)
  - `JSON.stringify(stats)` gak mengandung `@`
  - `BrevoSender`: fetch palsu nerima body yang bener dan header `api-key`. HTTP 201 → `ok:true`, HTTP 400 → `ok:false`
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.** Panggil `notifyStep` di `runDaily` cuma kalau `cfg.email.enabled`. Counter-nya digabung ke `RunStats`.
- [ ] **Step 4: Jalankan `pnpm test && pnpm typecheck`.** Expected: PASS
- [ ] **Step 5: Commit** `feat(pipeline): daily email digest via brevo`

### Task 5: Halaman berhenti langganan

**Files:**
- Create: `apps/web/app/unsubscribe/page.tsx`, `apps/web/app/unsubscribe/actions.ts`
- Test: `apps/web/e2e/unsubscribe.spec.ts`

**Interfaces:**
- Consumes: `unsubscribe_digest(token)` (Task 1)
- Produces:
  - GET `/unsubscribe?token=…` nampilin tombol "Unsubscribe from daily digest". **GET gak ngubah data apa pun.**
  - Server action `unsubscribe(token: string): Promise<"done" | "invalid">`

- [ ] **Step 1: Tulis test e2e yang gagal:**
  - Buka URL dengan token valid → `digest_enabled` masih `true` di DB
  - Klik tombol → teks "You are unsubscribed." dan `digest_enabled = false`
  - Token acak → teks "This link is invalid or already used."
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(web): unsubscribe page`

### Task 6: Email auth Supabase lewat SMTP yang sama + verifikasi end-to-end

**Files:**
- Create: `docs/ops/email.md`

**Interfaces:**
- Produces: dokumen langkah setting SMTP custom Supabase Auth (host/port/user dari Brevo, sender = `EMAIL_FROM`), dan catatan bahwa
  email auth makan dari kuota yang sama, yang ditutup oleh `reserveRatio 0.2`.

- [ ] **Step 1: Tulis `docs/ops/email.md`** berisi:
  - Nilai yang harus diisi di Supabase Dashboard → Authentication → SMTP
  - Cara ngecek kuota terpakai di Brevo
  - Kapan harus naikin tier: `digests_skipped_quota > 0` selama 3 hari berturut-turut
- [ ] **Step 2: Verifikasi manual di project Supabase asli:**
  - Signup akun uji → email verifikasi datang dari pengirim Brevo
  - Watch satu project yang punya deadline ≤ 48 jam → jalankan `workflow_dispatch`
  - Expected: satu email digest masuk dengan deadline itu, dan `RunStats` di log nunjukin `digests_sent ≥ 1`
- [ ] **Step 3: Commit** `docs: email operations guide`
