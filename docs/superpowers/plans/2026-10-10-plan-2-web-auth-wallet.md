# Plan 2: Web Dashboard, Akun & Cek Wallet EVM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web dashboard publik buat lihat airdrop + risiko. User yang login bisa kelola watchlist, wallet EVM, settings, dan cek aktivitas
wallet on-demand.

**Architecture:**
- Next.js (App Router) di `apps/web` baca Supabase pakai anon key + `@supabase/ssr`, dikunci RLS.
- Satu-satunya API route yang manggil jaringan luar adalah `POST /api/wallet-activity`. Route ini manggil `ChainAdapter` EVM
  (Blockscout), dengan cache dan rate limit di Postgres.
- Hapus akun lewat fungsi SQL `SECURITY DEFINER`, supaya web gak perlu service role key.

**Tech Stack:**
- Next.js (versi stabil terbaru saat implementasi, App Router), React, `@supabase/ssr`, `@supabase/supabase-js`
- Vitest + Testing Library, Playwright (pakai Chromium yang sudah ada), pgTAP lewat `supabase test db`

**Spec:** `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (§7, §9, §10)

**Bergantung ke:** Plan 1 selesai: `@saf/core` (`ChainAdapter`, `ActivitySummary`, `isEvmAddress`, `RiskLevel`, `Status`), dan
migrasi `0001_pipeline.sql`.

## Prasyarat (owner)

- Spec §12 #2: pilih host web dulu. Vercel Hobby **cuma buat dev**. Plan ini gak bergantung ke host tertentu.
- Spec §12 #8: verifikasi instance Blockscout buat chain EVM selain Ethereum. Chain yang belum terverifikasi gak masuk config.

## Global Constraints

- UI copy bahasa Inggris.
- Web **cuma** pegang `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Service role key gak boleh ada di `apps/web`.
- Cache cek wallet **6 jam** per alamat + chain. Batas **10 cek per user per jam**.
- UI selalu pakai istilah "wallet activity", **gak pernah** "eligible".
- Sistem gak pernah ngirim alamat wallet ke checker pihak ketiga.
- Provider error atau kena limit → tampilkan "Data unavailable, try again later.", **jangan** tampilkan angka nol.
- Chain bukan EVM → tampilkan "Chain not supported yet."
- Banner data basi kalau run sukses terakhir > **36 jam** lalu.
- Status `unknown` ditampilkan sebagai "Unconfirmed".
- Level risiko ditampilkan sebagai `Low` / `Medium` / `High` / `Critical` / `Insufficient data`, **tanpa angka**. Label "SAFE" gak
  boleh muncul di mana pun.
- Urutan default daftar airdrop: deadline terdekat (yang presisinya `exact`/`approximate`), lalu `last_seen` terbaru.

## Review Focus

1. **Alamat wallet campuran huruf besar-kecil** (checksum) dan huruf kecil dianggap wallet yang sama, jadi gak bikin entri dobel
   atau cache miss. Dites di Task 5.
2. **User nyoba baca atau hapus wallet milik user lain** lewat ID langsung → ditolak oleh RLS. Dites di Task 1 (pgTAP) dan Task 6.
3. **Wallet tanpa transaksi sama sekali:** `txCount 0`, `firstTxAt null`. Harus ditampilkan sebagai "No activity on <chain>", beda
   dengan error. Dites di Task 6.
4. **Project yang chain-nya kosong** (umum di hasil Telegram): tombol cek wallet gak tampil, diganti teks "Chain unknown". Dites di
   Task 3.
5. **Hapus akun** ikut hapus wallet, watchlist, dan request cek di DB. Dites di Task 1 (pgTAP).

---

## File Structure

```
supabase/migrations/0002_users.sql     profiles, watchlist, wallets, wallet_checks, wallet_check_requests, RLS, trigger, delete_my_account()
supabase/tests/users_rls.test.sql      pgTAP
apps/web/
  lib/supabase/{server,client}.ts      factory client @supabase/ssr
  lib/queries.ts                       listProjects, getProjectDetail, getLastRun, getWatchlist, getWallets
  lib/view.ts                          sortProjects, isStale, statusLabel, riskLabel, formatDeadline
  lib/chains/config.ts                 EVM_CHAINS + chainIdFromName
  lib/chains/evm-blockscout.ts         BlockscoutAdapter implements ChainAdapter
  lib/wallet-activity.ts               getWalletActivity (cache + rate limit)
  app/(public)/page.tsx                daftar airdrop
  app/(public)/projects/[slug]/page.tsx
  app/(auth)/{login,signup,reset-password,update-password}/page.tsx, app/auth/callback/route.ts
  app/(app)/{watchlist,wallets,settings}/page.tsx + actions.ts
  app/api/wallet-activity/route.ts
  components/{RiskBadge,StatusBadge,StaleBanner,ProjectRow,WalletActivity}.tsx
  test/*.test.ts(x), e2e/*.spec.ts
```

---

### Task 1: Skema user + RLS + hapus akun

**Files:**
- Create: `supabase/migrations/0002_users.sql`
- Test: `supabase/tests/users_rls.test.sql`

**Interfaces:**
- Produces tabel:
  - `profiles(user_id pk → auth.users, plan text default 'free', digest_enabled bool default true, new_airdrops_opt_in bool default false, timezone text default 'UTC', unsubscribe_token uuid default gen_random_uuid() unique)`
  - `watchlist(user_id, project_id, created_at, pk(user_id, project_id))`
  - `wallets(id uuid, user_id, address text, chain_family text check ('evm'), label text, unique(user_id, address))`. Alamat
    disimpan **lowercase**.
  - `wallet_checks(address, chain, result jsonb, checked_at, pk(address, chain))`
  - `wallet_check_requests(user_id, created_at)`
- Produces fungsi:
  - Trigger `on_auth_user_created` → insert `profiles`
  - `public.delete_my_account()`: `SECURITY DEFINER`, hapus dari `auth.users where id = auth.uid()`. Cascade ke semua tabel di atas.
    `wallet_checks` dibersihin buat alamat yang gak dimiliki user lain.
- RLS:
  - `profiles`, `watchlist`, `wallets`, `wallet_check_requests`: `user_id = auth.uid()` buat semua operasi.
  - `wallet_checks`: gak ada akses langsung. Cuma lewat dua fungsi `SECURITY DEFINER` yang ngecek wallet-nya milik `auth.uid()`:
    - `get_wallet_check(p_wallet_id uuid, p_chain text) returns table(result jsonb, checked_at timestamptz)`
    - `save_wallet_check(p_wallet_id uuid, p_chain text, p_result jsonb) returns void`

- [ ] **Step 1: Tulis test pgTAP yang gagal:**
  - User A gak bisa `select` wallet milik user B
  - User A gak bisa `insert` watchlist dengan `user_id` B
  - Bikin user → baris `profiles` otomatis ada
  - `delete_my_account()` sebagai A → wallet, watchlist, profile, dan request milik A habis, data B utuh
- [ ] **Step 2: Jalankan `supabase db reset && supabase test db`.** Expected: FAIL
- [ ] **Step 3: Tulis migrasi.**
- [ ] **Step 4: Jalankan `supabase db reset && supabase test db`.** Expected: PASS
- [ ] **Step 5: Commit** `feat(db): user tables, RLS and self-service account deletion`

### Task 2: Scaffold Next.js + auth email/password

**Files:**
- Create: `apps/web` (Next.js App Router, TypeScript), `apps/web/lib/supabase/{server,client}.ts`, `apps/web/middleware.ts`
- Create: `app/(auth)/{login,signup,reset-password,update-password}/page.tsx`, `app/auth/callback/route.ts`
- Test: `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Produces:
  - `createServerClient(): SupabaseClient` dan `createBrowserClient(): SupabaseClient`
  - `requireUser(): Promise<User>` (redirect ke `/login` kalau belum login)
  - Halaman di `(app)` wajib login

- [ ] **Step 1: Tulis test e2e Playwright yang gagal.** Jalan ke Supabase lokal (`supabase start`), email dibaca dari inbox lokal
  (Mailpit/Inbucket bawaan Supabase CLI):
  - Signup → link verifikasi di email lokal → login berhasil, header nampilin email user
  - Reset password → link → set password baru → login pakai password baru berhasil
  - Buka `/watchlist` tanpa login → redirect ke `/login`
- [ ] **Step 2: Jalankan `pnpm --filter web e2e`.** Expected: FAIL
- [ ] **Step 3: Implementasi** pakai `@supabase/ssr` (cookie session) dan form server action. Pesan error dari Supabase ditampilkan
  apa adanya.
- [ ] **Step 4: Jalankan e2e.** Expected: PASS
- [ ] **Step 5: Tambah job `e2e` di `ci.yml`:** `supabase start`, `pnpm --filter web build`, Playwright pakai Chromium di
  `PLAYWRIGHT_BROWSERS_PATH`.
- [ ] **Step 6: Commit** `feat(web): next.js app with supabase email/password auth`

### Task 3: Daftar airdrop + halaman detail

**Files:**
- Create: `apps/web/lib/queries.ts`, `apps/web/lib/view.ts`
- Create: `components/{RiskBadge,StatusBadge,StaleBanner,ProjectRow}.tsx`, `app/(public)/page.tsx`,
  `app/(public)/projects/[slug]/page.tsx`
- Test: `apps/web/test/view.test.ts`, `apps/web/test/components.test.tsx`

**Interfaces:**
- Consumes: tabel publik dari Plan 1 (`projects`, `risk_assessments`, `deadlines`, `tasks`, `links`, `evidence`, `pipeline_runs`)
- Produces:

```ts
export interface ProjectListItem { slug: string; name: string; status: Status; riskLevel: RiskLevel | null; chains: string[];
  nextDeadline: { date: string; kind: string; precision: string } | null; lastSeen: string }
export interface ListFilters { status?: Status[]; risk?: RiskLevel[]; chain?: string }
export function listProjects(db: SupabaseClient, f: ListFilters): Promise<ProjectListItem[]>;
export interface ProjectDetail extends ProjectListItem { tokenSymbol: string | null; conflict: boolean;
  risk: { level: RiskLevel; reasons: RiskReason[]; checks: RiskCheck[]; computedAt: string } | null;
  deadlines: { kind: DeadlineKind; date: string | null; precision: DatePrecision; text: string }[];
  tasks: string[]; links: { url: string; kind: string }[];
  evidence: { field: string; value: string; quote: string; sourceUrl: string; at: string }[] }
export function getProjectDetail(db: SupabaseClient, slug: string): Promise<ProjectDetail | null>;
export function getLastSuccessfulRunAt(db: SupabaseClient): Promise<Date | null>;
export function sortProjects(items: ProjectListItem[]): ProjectListItem[];
export function isStale(lastRunAt: Date | null, now: Date): boolean;   // > 36 jam atau null
export function statusLabel(s: Status): string;   // unknown → "Unconfirmed"
export function riskLabel(l: RiskLevel | null): string;  // null → "Not assessed", insufficient_data → "Insufficient data"
```

- [ ] **Step 1: Tulis test yang gagal:**
  - `isStale(now - 37h, now) === true`, `isStale(now - 35h, now) === false`, `isStale(null, now) === true`
  - `statusLabel("unknown") === "Unconfirmed"`
  - `sortProjects`: item dengan deadline `exact` lebih dekat ada di depan. Deadline `quarter` dianggap gak punya deadline.
    Seri → `lastSeen` terbaru
  - `<RiskBadge level="high" />` render teks "High", dan teks render gak mengandung "safe" (case-insensitive) di level mana pun
  - Detail project dengan `chains: []` → nampilin "Chain unknown" dan gak ada tombol cek wallet
  - Detail dengan `conflict:true` → nampilin dua kutipan evidence yang bertentangan + label "Conflicting sources"
  - Detail nampilin cakupan cek, misalnya "4/8 checks ran"
- [ ] **Step 2: Jalankan `pnpm --filter web test`.** Expected: FAIL
- [ ] **Step 3: Implementasi.**
  - Filter status, risk, dan chain lewat query string.
  - `StaleBanner` muncul kalau `isStale`.
  - Link ke checker resmi (link jenis `claim`) selalu dirender di sebelah `RiskBadge`.
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(web): airdrop list and project detail pages`

### Task 4: Watchlist

**Files:**
- Create: `app/(app)/watchlist/page.tsx`, `app/(app)/watchlist/actions.ts`; tombol Watch/Unwatch di halaman detail
- Test: `apps/web/e2e/watchlist.spec.ts`

**Interfaces:**
- Produces: server action `toggleWatch(projectId: string): Promise<{ watching: boolean }>`, dan `getWatchlist(db): Promise<ProjectListItem[]>`

- [ ] **Step 1: Tulis test e2e yang gagal.** Seed project lewat SQL:
  - Login → Watch di detail → muncul di `/watchlist`
  - Unwatch → hilang
  - Klik Watch dua kali cepat → tetap satu baris (pk mencegah duplikat)
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(web): watchlist`

### Task 5: Kelola wallet

**Files:**
- Create: `app/(app)/wallets/page.tsx`, `app/(app)/wallets/actions.ts`
- Test: `apps/web/test/wallet-actions.test.ts`

**Interfaces:**
- Consumes: `isEvmAddress` (`@saf/core`)
- Produces:
  - `addWallet(input: { address: string; label?: string }): Promise<{ ok: true } | { ok: false; error: "invalid_address" | "duplicate" }>`
  - `deleteWallet(id: string): Promise<void>`

- [ ] **Step 1: Tulis test yang gagal** (DB di-mock di level client):
  - Alamat `"0xABC…"` (checksum) disimpan sebagai lowercase
  - Nambah lagi alamat yang sama dalam huruf kecil → `duplicate`
  - `"0x123"` → `invalid_address`
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(web): wallet management`

### Task 6: Adapter Blockscout + API cek aktivitas wallet

**Files:**
- Create: `apps/web/lib/chains/config.ts`, `apps/web/lib/chains/evm-blockscout.ts`, `apps/web/lib/wallet-activity.ts`,
  `app/api/wallet-activity/route.ts`, `components/WalletActivity.tsx`
- Test: `apps/web/test/blockscout.test.ts`, `apps/web/test/wallet-activity.test.ts`

**Interfaces:**
- Consumes: `ChainAdapter`, `ActivitySummary`, `isEvmAddress` (`@saf/core`)
- Produces:

```ts
export const EVM_CHAINS: Record<string, { blockscoutBase: string }>;  // awal: { ethereum: { blockscoutBase: "https://eth.blockscout.com" } }
export function chainIdFromName(name: string): string | null;          // "Ethereum"/"ETH"/"ethereum mainnet" → "ethereum"; selain EVM → null
export class BlockscoutAdapter implements ChainAdapter { constructor(fetchImpl: typeof fetch) }
export type WalletActivityResult =
  | { kind: "ok"; summary: ActivitySummary; cached: boolean }
  | { kind: "rate_limited" } | { kind: "unavailable" } | { kind: "chain_not_supported" } | { kind: "not_owner" };
export function getWalletActivity(db: SupabaseClient, adapter: ChainAdapter, walletId: string, chainName: string, now: Date): Promise<WalletActivityResult>;
```

**`BlockscoutAdapter.getActivity`:**
1. `GET {base}/api/v2/addresses/{addr}/counters` → `txCount` dari `transactions_count`
2. `GET {base}/api?module=account&action=txlist&address={addr}&sort=asc&page=1&offset=1` → `firstTxAt`
3. `GET …&sort=desc&page=1&offset=1000` → `lastTxAt` + jumlah bulan unik. `exact` = `true` kalau hasilnya < 1000 item

HTTP ≠ 200 atau `status` Etherscan `"0"` dengan pesan selain "No transactions found" → throw.

**Route `POST /api/wallet-activity` body `{walletId, chain}`:**
- `401` kalau belum login
- Petakan hasil: `ok` → 200, `rate_limited` → 429, `unavailable` → 503, `chain_not_supported` → 422, `not_owner` → 404

**`getWalletActivity`:**
- Cek kepemilikan → `chainIdFromName` → cache lewat RPC `get_wallet_check` < 6 jam → hitung `wallet_check_requests` 1 jam terakhir. Kalau ≥ 10,
  return `rate_limited`. Cache hit gak dihitung sebagai request.
- Kalau gak kena cache: panggil adapter, simpan pakai RPC `save_wallet_check`, catat request. Error adapter → `unavailable` (gak di-cache).

- [ ] **Step 1: Tulis test yang gagal.** Pakai fetch palsu dan DB palsu:
  - Counters `{transactions_count:"142"}` + txlist → `txCount 142`, tanggal pertama dan terakhir benar, `activeMonths.exact === true`
  - Alamat tanpa transaksi (`"No transactions found"`) → `{txCount:0, firstTxAt:null}`. `WalletActivity` nampilin
    "No activity on Ethereum"
  - HTTP 502 → `unavailable`. Komponen nampilin "Data unavailable, try again later." dan **gak** nampilin "0"
  - `chainIdFromName("Sui")` → `null` → `chain_not_supported`
  - Cache 5 jam lalu → `cached:true`, fetch gak dipanggil
  - Cache 7 jam lalu → fetch dipanggil
  - Request ke-11 dalam 1 jam → `rate_limited`
  - `walletId` milik user lain → `not_owner`
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Verifikasi manual** pakai satu alamat Ethereum publik di dev server. Expected: angka sesuai yang tampil di
  `eth.blockscout.com`.
- [ ] **Step 6: Commit** `feat(web): on-demand EVM wallet activity via blockscout`

### Task 7: Settings + hapus akun

**Files:**
- Create: `app/(app)/settings/page.tsx`, `app/(app)/settings/actions.ts`
- Test: `apps/web/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `delete_my_account()` (Task 1)
- Produces:
  - `updateSettings(input: { digestEnabled: boolean; newAirdropsOptIn: boolean; timezone: string }): Promise<void>`. Timezone
    divalidasi pakai `Intl.supportedValuesOf("timeZone")`.
  - `deleteAccount(): Promise<never>`. Manggil RPC `delete_my_account`, sign out, redirect ke `/`.

- [ ] **Step 1: Tulis test e2e yang gagal:**
  - Matiin digest → reload → masih mati
  - Timezone `"Mars/Base"` → muncul error
  - Hapus akun (pakai dialog konfirmasi) → login lagi pakai kredensial lama gagal
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(web): settings and account deletion`
