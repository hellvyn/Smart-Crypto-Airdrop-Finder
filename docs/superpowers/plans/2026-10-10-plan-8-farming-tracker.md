# Plan 8: Tracker "Garapan saya" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member bisa menandai project yang sedang digarap, mencentang task harian/mingguan hari ini, dan melihat
konsistensinya sebagai heatmap 52 minggu + streak, semuanya privat.

**Architecture:**
- Tiga tabel milik user (`farming_projects`, `farming_tasks`, `farming_checks`) dengan RLS pemilik-saja; centang lewat
  fungsi `SECURITY DEFINER` yang menghitung tanggal lokal di server.
- Hitungan heatmap, streak, dan status mingguan = fungsi murni di `@saf/core`.
- Server actions di `apps/web/app/(app)/garapan/actions.ts`; `startFarming` dipakai juga oleh AI Coach nanti (spec #38).

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, Postgres/pgTAP, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` §14 (keputusan #35–#38)

**Bergantung ke:** Plan 7 (akses member-only, halaman di `(app)`), Plan 4 Task 5 (`tasks.cadence`, `tasks.position`).
**Urutan:** 7 → 4 → **8** → 5 → 6. Migrasi `0010_farming.sql`.

## Global Constraints

- Privat: baris tracker cuma bisa dibaca/diubah pemiliknya (`user_id = (select auth.uid())`). Anon gak punya akses.
- Hari = tanggal lokal `profiles.timezone` (IANA, sudah divalidasi `isValidTimezone`). Centang/uncentang cuma untuk
  hari ini; klien gak pernah mengirim tanggal.
- Warna heatmap 4 tingkat dari persen task Harian aktif yang dicentang: `0` = 0%, `1` = 1–49%, `2` = 50–99%,
  `3` = 100%; hari tanpa task Harian aktif = `null` (abu).
- Streak = hari berturut-turut level `3`, berakhir hari ini atau kemarin (kalau hari ini belum `3`).
- Mingguan = minggu ISO (Senin–Minggu) di zona waktu member.
- Batas: 50 project aktif per member, 30 task aktif per project (pelanggaran → error `23514`, pesan Bahasa Indonesia di UI).
- Teks UI Bahasa Indonesia (gaya "kamu"): "Mulai garap", "Berhenti garap", "Garapan saya", "Hari ini", "Mingguan",
  "Minggu ini sudah", "Tambah task", "Ambil ulang langkah dari sumber", "Streak: {n} hari", heatmap tooltip
  "{tanggal}: {selesai}/{total} task harian".
- Task awal cuma dari langkah `cadence` `daily`/`weekly`. Langkah `once` gak masuk tracker.

## Review Focus

1. **Member ganti zona waktu di Settings** → hari yang sudah lewat gak berubah warnanya (centang menyimpan tanggal
   lokal saat dicentang). Test di Task 1 dan 2.
2. **Project tanpa langkah Harian dari sumber** → tetap bisa digarap; kartu menampilkan "Belum ada task harian. Tambah
   task sendiri." Test di Task 4.
3. **Task diarsipkan di tengah tahun** → hari sebelum diarsipkan tetap memperhitungkan task itu, hari sesudahnya gak.
   Test di Task 2.
4. **Dua tab mencentang bersamaan** → toggle idempoten per (task, hari); gak ada baris ganda. Test di Task 1.
5. **Project dihapus dari database (cascade)** → tracker-nya ikut hilang tanpa error di `/garapan`. Test di Task 1.

---

### Task 1: Migrasi `0010_farming.sql` + RLS + fungsi

**Files:**
- Create: `supabase/migrations/0010_farming.sql`, `supabase/tests/farming.test.sql`

**Interfaces:**
- Tabel:
  - `farming_projects (user_id uuid fk auth.users cascade, project_id uuid fk projects cascade, started_at timestamptz not null default now(), archived_at timestamptz, primary key (user_id, project_id))`
  - `farming_tasks (id uuid pk, user_id uuid fk auth.users cascade, project_id uuid, text text not null check (char_length(text) between 1 and 200), cadence text not null check (cadence in ('daily','weekly')), origin text not null check (origin in ('source','custom')), position integer not null default 0, created_at timestamptz not null default now(), archived_at timestamptz, foreign key (user_id, project_id) references farming_projects on delete cascade)`
  - `farming_checks (task_id uuid fk farming_tasks cascade, user_id uuid not null, day date not null, checked_at timestamptz not null default now(), primary key (task_id, day))`
- RLS on semua; policy select/insert/update/delete `to authenticated using/with check (user_id = (select auth.uid()))`.
  `farming_checks`: select + delete milik sendiri; **insert hanya lewat fungsi** (gak ada grant insert ke authenticated).
- Fungsi (semua `security definer`, `set search_path = ''`, execute cuma untuk authenticated):
  - `farming_today() returns date` — `(now() at time zone coalesce(p.timezone,'UTC'))::date` untuk profil pemanggil.
  - `toggle_farming_check(p_task_id uuid, p_done boolean) returns boolean` — task harus milik pemanggil dan gak
    diarsipkan; `p_done` true → insert `(task, farming_today())` `on conflict do nothing`; false → delete baris hari ini.
    Mengembalikan state akhir.
  - Trigger batas: insert `farming_projects` aktif ke-51 → `23514`; insert `farming_tasks` aktif ke-31 untuk project
    yang sama → `23514` (advisory lock per user seperti `enforce_wallet_limit`).

- [ ] **Step 1: Test pgTAP yang gagal** — user A gak bisa select/insert tracker user B; anon ditolak; `toggle_farming_check`
  dua kali dengan `true` → satu baris; dengan `profiles.timezone = 'Asia/Jakarta'`, tanggal yang ditulis sama
  dengan `(now() at time zone 'Asia/Jakarta')::date`;
  task milik user lain → `42501`; task diarsipkan → `22023`; project ke-51 → `23514`; hapus `projects` → baris tracker
  ikut terhapus.
- [ ] **Step 2:** `npx -y supabase@2.120.0 db reset && npx -y supabase@2.120.0 test db` → FAIL.
- [ ] **Step 3:** tulis migrasi.
- [ ] **Step 4:** pgTAP lulus (semua file).
- [ ] **Step 5:** commit `git commit -m "feat(db): private farming tracker tables and today-only check function"`

---

### Task 2: Hitungan heatmap, streak, mingguan (core)

**Files:**
- Create: `packages/core/src/farming/tracker.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/farming.test.ts`

**Interfaces:**
- `type HeatLevel = 0 | 1 | 2 | 3 | null`
- `interface TrackerTask { id: string; cadence: "daily" | "weekly"; createdDay: string; archivedDay: string | null }`
  (`createdDay`/`archivedDay` = tanggal lokal `YYYY-MM-DD`; task aktif di hari `d` kalau `createdDay <= d` dan
  (`archivedDay === null` atau `d < archivedDay`))
- `buildHeatmap(tasks: TrackerTask[], checks: { taskId: string; day: string }[], today: string, weeks = 52): { day: string; level: HeatLevel; done: number; total: number }[]`
  — kolom minggu Senin–Minggu, berakhir di minggu yang memuat `today`; hari setelah `today` gak dikembalikan.
- `streak(heat: { day: string; level: HeatLevel }[], today: string): number`
- `weeklyDone(tasks: TrackerTask[], checks: { taskId: string; day: string }[], today: string): Record<string, boolean>` (per task weekly)
- `localDay(now: Date, timeZone: string): string` (pakai `Intl.DateTimeFormat`, gak butuh `@types/node`)

- [ ] **Step 1: Test yang gagal**

```ts
it("grades a day by the share of active daily tasks checked", () => {
  const tasks = [daily("a", "2026-10-01"), daily("b", "2026-10-01"), daily("c", "2026-10-01")];
  const heat = buildHeatmap(tasks, [{ taskId: "a", day: "2026-10-09" }, { taskId: "b", day: "2026-10-09" }, { taskId: "c", day: "2026-10-09" },
    { taskId: "a", day: "2026-10-10" }], "2026-10-10");
  expect(at(heat, "2026-10-09")).toMatchObject({ level: 3, done: 3, total: 3 });
  expect(at(heat, "2026-10-10")).toMatchObject({ level: 1, done: 1, total: 3 });
  expect(at(heat, "2026-09-30")).toMatchObject({ level: null, total: 0 }); // before any task existed
});
it("counts an archived task only before it was archived", () => {
  const heat = buildHeatmap([daily("a", "2026-10-01"), { ...daily("b", "2026-10-01"), archivedDay: "2026-10-05" }], [{ taskId: "a", day: "2026-10-06" }], "2026-10-10");
  expect(at(heat, "2026-10-04")!.total).toBe(2); expect(at(heat, "2026-10-06")).toMatchObject({ total: 1, level: 3 });
});
it("ends the streak today or yesterday", () => {
  expect(streak(levels({ "2026-10-08": 3, "2026-10-09": 3, "2026-10-10": 1 }), "2026-10-10")).toBe(2);
  expect(streak(levels({ "2026-10-09": 3, "2026-10-10": 3 }), "2026-10-10")).toBe(2);
  expect(streak(levels({ "2026-10-08": 3 }), "2026-10-10")).toBe(0);
});
it("marks weekly tasks done within the ISO week", () => {
  expect(weeklyDone([weekly("w", "2026-09-01")], [{ taskId: "w", day: "2026-10-05" }], "2026-10-10")).toEqual({ w: true }); // Mon 5 Oct
  expect(weeklyDone([weekly("w", "2026-09-01")], [{ taskId: "w", day: "2026-10-04" }], "2026-10-10")).toEqual({ w: false }); // Sun 4 Oct
});
it("computes the local day in a time zone", () => {
  expect(localDay(new Date("2026-10-10T18:30:00Z"), "Asia/Jakarta")).toBe("2026-10-11");
});
```

- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter @saf/core exec vitest run` lulus.
- [ ] **Step 5:** commit `git commit -m "feat(core): farming heatmap, streak and weekly status"`

---

### Task 3: Server actions + query

**Files:**
- Create: `apps/web/lib/farming.ts`, `apps/web/app/(app)/garapan/actions.ts`
- Test: `apps/web/test/farming.test.ts`

**Interfaces:**
- `lib/farming.ts`:
  - `startFarming(db, projectId: string): Promise<void>` — upsert `farming_projects` (hapus `archived_at` kalau ada), lalu
    snapshot langkah sumber: `tasks` project dengan `cadence in ('daily','weekly')`, teks dari analisis AI `steps_id`
    kalau ada (setelah Plan 5; sebelum itu teks `tasks.description`), dedup teks (case-insensitive), `origin = 'source'`.
  - `stopFarming(db, projectId)` — set `archived_at = now()`.
  - `addCustomTask(db, projectId, text: string, cadence: "daily" | "weekly")`, `archiveTask(db, taskId)`.
  - `refreshFromSource(db, projectId): Promise<{ added: number; archived: number }>` — tambah langkah sumber baru (teks
    belum ada), arsipkan task `origin = 'source'` yang teksnya sudah gak ada di sumber.
  - `setCheck(db, taskId, done: boolean): Promise<boolean>` → RPC `toggle_farming_check`.
  - `getFarmingBoard(db, now: Date): Promise<FarmingCard[]>` — per project aktif: nama, slug, deadline terdekat, task
    aktif (urut `position`), `checkedToday`, `heatmap` (dari `buildHeatmap`, 52 minggu), `streak`, `weeklyDone`. Tanggal
    lokal dari `profiles.timezone` + `localDay`.
  - `isFarming(db, projectId): Promise<boolean>`.
- `actions.ts` (semua `requireUser`, validasi `isUuid`, `revalidatePath("/garapan")`): `submitStartFarming`,
  `submitStopFarming`, `submitAddTask`, `submitArchiveTask`, `submitRefresh`, `submitCheck` (form action, kirim state
  yang diinginkan seperti `submitWatch`). `startFarmingAction(projectId)` diekspor untuk dipakai AI Coach (spec #38).

- [ ] **Step 1: Test yang gagal** (mock Supabase client seperti test watchlist yang ada) — `startFarming` cuma
  mengambil langkah daily/weekly dan dedup teks; `refreshFromSource` menambah 1 dan mengarsipkan 1 pada skenario yang
  disiapkan; `addCustomTask` menolak teks kosong / > 200 karakter sebelum ke DB.
- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter web test && pnpm --filter web typecheck` lulus.
- [ ] **Step 5:** commit `git commit -m "feat(web): farming tracker actions and board query"`

---

### Task 4: UI "Garapan saya" + tombol di halaman project

**Files:**
- Create: `apps/web/app/(app)/garapan/page.tsx`, `apps/web/components/farming/FarmingCard.tsx`,
  `apps/web/components/farming/Heatmap.tsx`, `apps/web/components/farming/FarmButton.tsx`
- Modify: `apps/web/components/site-header.tsx` (link "Garapan saya"), `apps/web/components/ProjectDetailView.tsx`
  (tombol di sebelah Watch), CSS global
- Test: `apps/web/test/components/farming/*.test.tsx`, `apps/web/e2e/farming.spec.ts`

**Interfaces:**
- `Heatmap({ cells, label })`: grid 7 baris × 52–53 kolom, warna dari `level` (4 tingkat + abu), label bulan di atas,
  `aria-label`/`title` per sel sesuai teks Global Constraints; elemen grafis bukan satu-satunya informasi (ada
  ringkasan "Streak: {n} hari" dan "{x} dari {y} task hari ini").
- `FarmingCard`: nama project (link ke detail), deadline terdekat, checklist Harian (checkbox form → `submitCheck`),
  Mingguan dengan "Minggu ini sudah", form "Tambah task", tombol "Ambil ulang langkah dari sumber", "Berhenti garap",
  heatmap.
- Kosong: "Kamu belum menggarap project apa pun. Buka sebuah airdrop dan klik Mulai garap."

- [ ] **Step 1: Test yang gagal** — komponen: `Heatmap` merender 364–371 sel dengan kelas level yang benar dan tooltip;
  `FarmingCard` tanpa task harian menampilkan "Belum ada task harian. Tambah task sendiri."; e2e: login → buka project →
  "Mulai garap" → `/garapan` menampilkan kartu; centang satu task → sel hari ini naik level dan teks "1 dari N task
  hari ini"; uncentang → turun; "Berhenti garap" → kartu hilang; user lain gak melihat apa pun di `/garapan`.
- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter web test && pnpm --filter web e2e` lulus.
- [ ] **Step 5:** commit `git commit -m "feat(web): Garapan saya page with daily checklist and heatmap"`

---

## Selesai kalau

- Semua test, typecheck, pgTAP, e2e lulus.
- Di produksi: member bisa mulai garap, mencentang task hari ini, melihat heatmap dan streak; member lain gak bisa
  melihatnya (dicek lewat dua akun).
