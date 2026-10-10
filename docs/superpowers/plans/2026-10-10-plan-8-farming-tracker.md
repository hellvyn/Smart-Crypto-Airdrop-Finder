# Plan 8: Tracker "Garapan saya" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member bisa menandai project yang sedang digarap, mencentang task harian/mingguan hari ini, dan melihat
konsistensinya sebagai heatmap sepanjang masa garap (sampai snapshot/akhir kampanye) + streak, semuanya privat.

**Architecture:**
- Tiga tabel milik user (`farming_projects`, `farming_tasks`, `farming_checks`) dengan RLS pemilik-saja; centang lewat
  fungsi `SECURITY DEFINER` yang menghitung tanggal lokal di server.
- Hitungan heatmap, streak, dan status mingguan = fungsi murni di `@saf/core`.
- Server actions di `apps/web/app/(app)/garapan/actions.ts`; `startFarming` dipakai juga oleh AI Coach nanti (spec #38).

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, Postgres/pgTAP, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` §14 (keputusan #35–#39)

**Bergantung ke:** Plan 7 (route akun terlindungi di `(app)`, halaman project publik), Plan 4 Task 5 (`tasks.cadence`, `tasks.position`).
**Urutan:** 7 → 4 → **8** → 5 → 6. Migrasi `0010_farming.sql`.

## Global Constraints

- Privat: baris tracker cuma bisa dibaca/diubah pemiliknya (`user_id = (select auth.uid())`). Anon gak punya akses.
- Hari = tanggal lokal `profiles.timezone` (IANA, sudah divalidasi `isValidTimezone`). Centang/uncentang cuma untuk
  hari ini; klien gak pernah mengirim tanggal.
- Warna heatmap 4 tingkat dari persen task Harian aktif yang dicentang: `0` = 0%, `1` = 1–49%, `2` = 50–99%,
  `3` = 100%; hari tanpa task Harian aktif = `null` (abu).
- Streak = hari berturut-turut level `3`, berakhir hari ini atau kemarin (kalau hari ini belum `3`).
- Mockup acuan: `docs/design/airdropiq-c/CGarapan.dc.html`.
- Rentang heatmap (spec #39): `start` = tanggal lokal `farming_projects.started_at`; `end` = deadline `snapshot` /
  `campaign_end` (presisi `exact`/`approximate`) paling awal yang ≥ `start`; tanpa deadline `end` =
  `start + 364 hari` (1 tahun). Maksimal 364 hari: kalau lebih, `start` dimajukan ke `end − 363 hari`.
  Hari > `today` = sel `upcoming`. Project yang sudah berakhir (spec #40): kalau `endedOn` (tanggal berakhir dari
  curation) ≥ `start` dan lebih awal dari `end`, `end = endedOn` dan `endKind = "ended"`.
- Mingguan = minggu ISO (Senin–Minggu) di zona waktu member.
- Batas: 50 project aktif per member, 30 task aktif per project (pelanggaran → error `23514`, pesan Bahasa Indonesia di UI).
- Teks UI (gaya "kamu", campur istilah Inggris yang umum, aturan gaya tulisan Plan 6): "Mulai garap", "Berhenti garap",
  "Garapan saya", "Hari ini", "Weekly", "Minggu ini udah", "Tambah task", "Ambil ulang step dari source", "Streak: {n}
  hari", "Sisa {n} hari sampai snapshot", "Sisa {n} hari sampai akhir campaign", "Ended {tanggal}", heatmap tooltip
  "{tanggal}: {selesai}/{total} daily task". Label cadence "Daily" / "Weekly".
- **Desain C (spec §16, komponen Plan 7 Task 3):** kartu project = `Ticket`/`SectionCard` bergaris 2 px tanpa sudut
  bulat; tombol "Mulai garap" = `Button` primary. Warna sel heatmap: `null` `#E8E8E2`, level `0` `#FFFFFF` bergaris
  `#CFCFC8`, `1` `#BFE3CC`, `2` `#5FAE80`, `3` `#1F7A45`; sel `upcoming` bergaris putus-putus `#CFCFC8` tanpa isi. Level
  dibedakan juga dari terang-gelapnya (bukan cuma warna) dan tooltip.
- Task awal dari **semua** langkah source (keputusan #50): `once` tampil sebagai **"Task utama"** di atas "Hari ini",
  dicentang sekali (gak terikat hari, gak masuk heatmap, persen harian, atau streak), progres "{x}/{y} selesai";
  `daily`/`weekly` seperti sebelumnya.
- Task buatan member tetap ada (#37), tapi tampil sebagai link teks kecil "+ Tambah task sendiri" di bawah checklist,
  bukan tombol utama.

## Review Focus

1. **Member ganti zona waktu di Settings** → hari yang sudah lewat gak berubah warnanya (centang menyimpan tanggal
   lokal saat dicentang). Test di Task 1 dan 2.
2. **Project tanpa langkah Harian dari sumber** → tetap bisa digarap; kartu menampilkan "Belum ada daily task. Tambah
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
  - `farming_tasks (id uuid pk, user_id uuid fk auth.users cascade, project_id uuid, text text not null check (char_length(text) between 1 and 200), cadence text not null check (cadence in ('once','daily','weekly')), origin text not null check (origin in ('source','custom')), position integer not null default 0, created_at timestamptz not null default now(), archived_at timestamptz, foreign key (user_id, project_id) references farming_projects on delete cascade)`
  - `farming_checks (task_id uuid fk farming_tasks cascade, user_id uuid not null, day date not null, checked_at timestamptz not null default now(), primary key (task_id, day))`
- RLS on semua; policy select/insert/update/delete `to authenticated using/with check (user_id = (select auth.uid()))`.
  `farming_checks`: select + delete milik sendiri; **insert hanya lewat fungsi** (gak ada grant insert ke authenticated).
- Fungsi (semua `security definer`, `set search_path = ''`, execute cuma untuk authenticated):
  - `farming_today() returns date` — `(now() at time zone coalesce(p.timezone,'UTC'))::date` untuk profil pemanggil.
  - `toggle_farming_check(p_task_id uuid, p_done boolean) returns boolean` — task harus milik pemanggil dan gak
    diarsipkan; `p_done` true → insert `(task, farming_today())` `on conflict do nothing`; false → delete baris hari ini.
    Task `once`: true → insert hari ini kalau belum ada baris sama sekali untuk task itu; false → delete **semua** baris
    task itu (selesai sekali, gak terikat tanggal). Mengembalikan state akhir.
  - Trigger batas: insert `farming_projects` aktif ke-51 → `23514`; insert `farming_tasks` aktif ke-31 untuk project
    yang sama → `23514` (advisory lock per user seperti `enforce_wallet_limit`).

- [ ] **Step 1: Test pgTAP yang gagal** — user A gak bisa select/insert tracker user B; anon ditolak; `toggle_farming_check`
  dua kali dengan `true` → satu baris; task `once` dicentang di dua hari berbeda tetap satu baris dan uncentang
  menghapusnya; dengan `profiles.timezone = 'Asia/Jakarta'`, tanggal yang ditulis sama
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
- `interface TrackerTask { id: string; cadence: "once" | "daily" | "weekly"; createdDay: string; archivedDay: string | null }`
  (`buildHeatmap`, `streak`, dan `weeklyDone` mengabaikan task `once`)
- `mainProgress(tasks: TrackerTask[], checks: { taskId: string; day: string }[]): { done: number; total: number }` — task
  `once` aktif; selesai kalau punya baris check apa pun.
  (`createdDay`/`archivedDay` = tanggal lokal `YYYY-MM-DD`; task aktif di hari `d` kalau `createdDay <= d` dan
  (`archivedDay === null` atau `d < archivedDay`))
- `heatmapRange(startedDay: string, deadlines: { kind: DeadlineKind; date: string | null; precision: DatePrecision }[], today: string, endedOn: string | null = null): { start: string; end: string; endKind: "snapshot" | "campaign_end" | "ended" | null }`
  — aturan rentang di Global Constraints.
- `buildHeatmap(tasks: TrackerTask[], checks: { taskId: string; day: string }[], range: { start: string; end: string }, today: string): { day: string; level: HeatLevel; done: number; total: number; upcoming: boolean }[]`
  — satu sel per hari dari `start` sampai `end`; hari > `today` → `upcoming: true`, `level: null`.
- `daysLeft(range, today): number | null` — hari dari `today` sampai `end` (inklusif), `null` kalau `endKind` null atau
  `end` < `today`.
- `streak(heat: { day: string; level: HeatLevel }[], today: string): number`
- `weeklyDone(tasks: TrackerTask[], checks: { taskId: string; day: string }[], today: string): Record<string, boolean>` (per task weekly)
- `localDay(now: Date, timeZone: string): string` (pakai `Intl.DateTimeFormat`, gak butuh `@types/node`)

- [ ] **Step 1: Test yang gagal**

```ts
it("grades a day by the share of active daily tasks checked", () => {
  const tasks = [daily("a", "2026-10-01"), daily("b", "2026-10-01"), daily("c", "2026-10-01")];
  const heat = buildHeatmap(tasks, [{ taskId: "a", day: "2026-10-09" }, { taskId: "b", day: "2026-10-09" }, { taskId: "c", day: "2026-10-09" },
    { taskId: "a", day: "2026-10-10" }], { start: "2026-09-28", end: "2026-10-20" }, "2026-10-10");
  expect(at(heat, "2026-10-09")).toMatchObject({ level: 3, done: 3, total: 3 });
  expect(at(heat, "2026-10-10")).toMatchObject({ level: 1, done: 1, total: 3 });
  expect(at(heat, "2026-09-30")).toMatchObject({ level: null, total: 0 }); // before any task existed
  expect(at(heat, "2026-10-15")).toMatchObject({ upcoming: true, level: null });
  expect(heat.at(-1)!.day).toBe("2026-10-20");
});
it("spans from the start day to the earliest snapshot or campaign end", () => {
  expect(heatmapRange("2026-10-01", [{ kind: "campaign_end", date: "2026-11-30", precision: "exact" },
    { kind: "snapshot", date: "2026-11-15", precision: "approximate" }, { kind: "tge", date: "2026-10-20", precision: "exact" }], "2026-10-10"))
    .toEqual({ start: "2026-10-01", end: "2026-11-15", endKind: "snapshot" });
});
it("spans one year without an end date and caps at 364 days", () => {
  expect(heatmapRange("2026-10-08", [], "2026-10-10")).toEqual({ start: "2026-10-08", end: "2027-10-07", endKind: null });
  expect(heatmapRange("2025-01-01", [{ kind: "campaign_end", date: "2026-12-31", precision: "exact" }], "2026-10-10").start).toBe("2026-01-02");
});
it("stops at the day the project ended", () => {
  expect(heatmapRange("2026-10-01", [{ kind: "campaign_end", date: "2026-11-30", precision: "exact" }], "2026-10-10", "2026-10-07"))
    .toEqual({ start: "2026-10-01", end: "2026-10-07", endKind: "ended" });
  expect(heatmapRange("2026-10-08", [], "2026-10-10", "2026-10-01").endKind).toBeNull(); // ended before start: ignored
});
it("counts days left until the end", () => {
  expect(daysLeft({ start: "2026-10-01", end: "2026-10-20", endKind: "snapshot" }, "2026-10-10")).toBe(11);
});
it("counts an archived task only before it was archived", () => {
  const heat = buildHeatmap([daily("a", "2026-10-01"), { ...daily("b", "2026-10-01"), archivedDay: "2026-10-05" }], [{ taskId: "a", day: "2026-10-06" }], { start: "2026-10-01", end: "2026-10-31" }, "2026-10-10");
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
  - `startFarming(db, projectId: string): Promise<void>` — **bukan upsert**: grant kolom di `0010` cuma kasih insert
    `(user_id, project_id)` dan update `archived_at` (`started_at` selalu `now()` server), jadi upsert supabase-js →
    `42501`. Baca baris `farming_projects` milik user untuk project itu: gak ada → `insert({ user_id, project_id })`
    (`23505` dari tab lain yang menang duluan dianggap sukses); ada dan diarsipkan → `update({ archived_at: null })`;
    ada dan aktif → gak diubah. `23514` (batas 50 project aktif) diteruskan sebagai error. Lalu
    snapshot langkah sumber: `tasks` project dengan `cadence in ('once','daily','weekly')`, teks dari analisis AI `steps_id`
    kalau ada (setelah Plan 5; sebelum itu teks `tasks.description`), dedup teks (case-insensitive), `origin = 'source'`.
  - `stopFarming(db, projectId)` — set `archived_at = now()`.
  - `addCustomTask(db, projectId, text: string, cadence: "once" | "daily" | "weekly")`, `archiveTask(db, taskId)`.
  - `refreshFromSource(db, projectId): Promise<{ added: number; archived: number }>` — tambah langkah sumber baru (teks
    belum ada), arsipkan task `origin = 'source'` yang teksnya sudah gak ada di sumber.
  - `setCheck(db, taskId, done: boolean): Promise<boolean>` → RPC `toggle_farming_check`.
  - `getFarmingBoard(db, now: Date): Promise<FarmingCard[]>` — per project aktif: nama, slug, deadline terdekat, task
    aktif (urut `position`), `checkedToday`, `range` (dari `heatmapRange` dengan deadline project; `endedOn = null` di plan ini karena tabel `curations` baru
    dibuat di Plan 5, disambungkan di Plan 6 Task 3), `heatmap` (`buildHeatmap` atas rentang itu),
    `daysLeft`, `streak`, `weeklyDone`, `mainProgress`. Tanggal
    lokal dari `profiles.timezone` + `localDay`.
  - `isFarming(db, projectId): Promise<boolean>`.
- `actions.ts` (semua `requireUser`, validasi `isUuid`, `revalidatePath("/garapan")`): `submitStartFarming`,
  `submitStopFarming`, `submitAddTask`, `submitArchiveTask`, `submitRefresh`, `submitCheck` (form action, kirim state
  yang diinginkan seperti `submitWatch`). `startFarmingAction(projectId)` diekspor untuk dipakai AI Coach (spec #38).

- [ ] **Step 1: Test yang gagal** (mock Supabase client seperti test watchlist yang ada) — `startFarming` mengambil
  langkah once/daily/weekly dan dedup teks; `refreshFromSource` menambah 1 dan mengarsipkan 1 pada skenario yang
  disiapkan; `addCustomTask` menolak teks kosong / > 200 karakter sebelum ke DB.
- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter web test && pnpm --filter web typecheck` lulus.
- [ ] **Step 5:** commit `git commit -m "feat(web): farming tracker actions and board query"`

---

### Task 4: UI "Garapan saya" + tombol di halaman project

**Files:**
- Create: `apps/web/app/(app)/garapan/page.tsx`, `apps/web/components/farming/FarmingCard.tsx`,
  `apps/web/components/farming/Heatmap.tsx`, `apps/web/components/farming/FarmButton.tsx`
- Modify: `apps/web/components/site-header.tsx` (link "Garapan saya", cuma untuk user login),
  `apps/web/components/ProjectDetailView.tsx` (tombol di sebelah Watch, cuma untuk user login; halaman project publik
  sejak Plan 7), `apps/web/lib/routes.ts` (`PROTECTED_PREFIXES` + `"/garapan"`), CSS global
- Test: `apps/web/test/components/farming/*.test.tsx`, `apps/web/e2e/farming.spec.ts`

**Interfaces:**
- `Heatmap({ cells, label })`: grid 7 baris × jumlah minggu rentang (1–53 kolom), warna dari `level` (4 tingkat + abu),
  sel `upcoming` bergaris tanpa warna, label bulan di atas,
  `aria-label`/`title` per sel sesuai teks Global Constraints; elemen grafis bukan satu-satunya informasi (ada
  ringkasan "Streak: {n} hari", "{x} dari {y} task hari ini", dan "Sisa {n} hari sampai snapshot" / "Sisa {n} hari sampai
  akhir campaign" kalau ada deadline).
- `FarmingCard` (mockup `docs/design/airdropiq-c/CGarapan.dc.html`): nama project (link ke detail), cap, hitung mundur,
  streak; kolom kiri: "Task utama" ({x}/{y} selesai, checkbox → `submitCheck`), "Hari ini" (daily), "Weekly" dengan
  "Minggu ini udah"/"Belum minggu ini", link teks "+ Tambah task sendiri" (membuka form kecil), tombol "Ambil ulang step
  dari source", link "Berhenti garap"; kolom kanan: heatmap "Progres". Project ended: cap "ENDED", checklist dikunci,
  teks "Campaign udah ended. Checklist dikunci, riwayat garapanmu tetap tersimpan di sini."
- Kosong: "Kamu belum menggarap project apa pun. Buka sebuah airdrop dan klik Mulai garap."

- [ ] **Step 1: Test yang gagal** — komponen: `Heatmap` merender satu sel per hari rentang dengan kelas level yang benar, sel `upcoming` bergaris, dan tooltip;
  `FarmingCard` tanpa task harian menampilkan "Belum ada daily task. Tambah task sendiri."; e2e: login → buka project →
  "Mulai garap" → `/garapan` menampilkan kartu dengan "Task utama"; centang task utama → "1/N selesai" dan sel heatmap
  hari ini gak berubah; centang satu daily task → sel hari ini naik level dan teks "1 dari N task
  hari ini"; uncentang → turun; "Berhenti garap" → kartu hilang; user lain gak melihat apa pun di `/garapan`.
- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter web test && pnpm --filter web e2e` lulus.
- [ ] **Step 5:** commit `git commit -m "feat(web): Garapan saya page with daily checklist and heatmap"`

---

## Selesai kalau

- Semua test, typecheck, pgTAP, e2e lulus.
- Di produksi: member bisa mulai garap, mencentang task hari ini, melihat heatmap dan streak; member lain gak bisa
  melihatnya (dicek lewat dua akun).
