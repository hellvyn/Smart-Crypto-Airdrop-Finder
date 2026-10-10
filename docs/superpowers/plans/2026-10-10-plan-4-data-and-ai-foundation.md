# Plan 4: Fondasi Data dan AI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Data yang jadi dasar kurasi gak bolong lagi: domain resmi project live ketangkep, cek domain (umur + phishing)
jalan untuk hampir semua domain, AI pribadi owner jadi model utama dengan NVIDIA sebagai cadangan, ekstraksi mengambil
field yang menyamai isi airdrops.io, dan akurasi bisa diukur (eval diperluas + set uji scam).

**Architecture:**
- Collector airdrops.io membaca kotak **Overview** dan atribut `data-outbound-host` di link `/visit/`.
- Tahap score: GoPlus di-throttle + retry, RDAP punya cadangan crt.sh, dan angka cakupan cek masuk `pipeline_runs.stats`.
- Adapter LLM multi-provider: tiap model punya provider (`freellm` atau `nvidia`) dengan `baseUrl` + key sendiri; model
  yang benar-benar menjawab disimpan.
- Skema ekstraksi v3 (langkah berurutan + cadence, parameter kunci, penilaian sumber, update terbaru, backer klaim,
  modal) disimpan lewat tabel `tasks` (diperluas) dan tabel `evidence` yang sudah ada.
- Eval dan set uji scam adalah skrip manual (bukan CI), seperti eval v1.

**Tech Stack:** sama dengan Plan 1–3 (TypeScript, pnpm, Vitest, zod v4, cheerio, Supabase/Postgres, pgTAP).

**Spec:** `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` (rev. 3: §4.4, §4.6, §5.0, §10, §12, §13;
§15.1 untuk Task 8–9)

**Bergantung ke:** Plan 7 (dikerjakan lebih dulu; migrasi `0007`), Plan 1 (pipeline, `PipelineRepo`, `streamChat`, `extractWithFallback`, eval), PR #2 (circuit breaker,
`llm_models_tripped`). Plan 5 dan 6 bergantung ke plan ini.

## Prasyarat (owner)

- Secret GitHub Actions: `LLM_API_KEY` (boleh kosong selama router belum pakai auth) dan `LLM_BASE_URL`
  (`https://freellm.hellvyn.id/v1`). `NVIDIA_API_KEY` tetap.
- Aktifkan autentikasi di router `freellm.hellvyn.id` sebelum produk dibuka ke member (spec §13).
- Review label ground truth eval baru (Task 6) dan daftar set uji scam (Task 7).

## Global Constraints

- `@saf/core` tetap tanpa network, DB, atau `@types/node`. Semua I/O di `pipeline`.
- `pipeline_runs.stats` cuma angka. Gak ada URL, nama project, teks dokumen, email, atau alamat wallet di log/stats.
- LLM cuma mengekstrak. Gak ada field hasil LLM yang menentukan lolos kurasi atau badge "terverifikasi" (spec §13 batas
  keras).
- Tiap field hasil ekstraksi yang punya kutipan (`quote`) dibuang kalau kutipannya gak ada di teks sumber.
- URL resmi tetap lewat aturan "URL harus ada di sumber" (`filterUrlsInSource`) dan pembersih referral (`cleanUrl`).
- Domain dari host `airdrops.io` / `*.airdrops.io` (termasuk `bridge.airdrops.io`) gak pernah jadi domain project.
  Sama untuk `alphadrops.net` dan host perantara di config (`s.kaito.ai`, `linktr.ee`, `galxe.com`, `app.galxe.com`,
  `zealy.io`, `layer3.xyz`, `bit.ly`, `t.co`; cocok host persis) — Task 9.
- Request ke alphadrops.net: User-Agent yang sama dengan collector lain, jeda ≥ 1,5 detik antar halaman detail,
  maksimal 80 halaman detail per run.
- Urutan model: `freellm:auto` → `nvidia:z-ai/glm-5.3-flash` → `nvidia:moonshotai/kimi-k3` →
  `nvidia:google/gemma-4-31b-it`. Streaming wajib (502 di ~30 detik tanpa streaming, di kedua provider).
- Secret gak pernah di kode, log, atau output test. `LLM_API_KEY` boleh kosong (header `Authorization` gak dikirim).
- Migrasi baru: `0008_served_model.sql`, `0009_extraction_v3.sql`. Migrasi lama gak diubah.
- `PROMPT_VERSION` baru: `2026-10-10.3`.
- Commit trailer sesuai aturan repo (Co-Authored-By + Claude-Session).

## Review Focus

1. **Struktur halaman airdrops.io berubah atau gak punya kotak Overview** → dokumen tetap dibuat dari blok utama, gak
   throw; class `aidrop-info-wrapper` (salah ketik di sumber) dan `airdrop-info-wrapper` sama-sama dikenali. Test di
   Task 1.
2. **`auto` menjawab HTTP 200 tapi bukan JSON valid** → dokumen yang sama langsung lanjut ke model NVIDIA berikutnya,
   circuit breaker gak menghitungnya sebagai kegagalan endpoint. Test di Task 3.
3. **Kutipan field baru gak ada di teks (LLM memparafrase)** → entri itu dibuang, entri lain tetap; project gak gagal
   merge. Test di Task 4 dan 5.
4. **crt.sh lambat, error, atau mengembalikan ribuan sertifikat** → umur domain `null` (cek dianggap gak jalan), gak
   throw, run tetap selesai. Test di Task 2.
5. **GoPlus kena 429 beruntun** → satu retry setelah jeda, lalu `null`; angka gagalnya kelihatan di stats. Test di Task 2.
6. **Halaman AlphaDrops berubah format atau terputus di tengah** (Next.js payload gak ketemu, connection reset) → collector
   `failed`, dokumen yang sudah terkumpul tetap di-ingest, sumber lain jalan. Test di Task 9.

---

### Task 1: Collector airdrops.io membaca kotak Overview dan `data-outbound-host`

Bukti [FACT, halaman `https://airdrops.io/arcus/` 2026-10-10]: kotak Overview ada di
`<div class="aidrop-info-wrapper">` **setelah** `.airdrop-bottom`, berisi `<li>Website: <a href="/visit/9ea3/?k=…"
data-outbound-host="arcus.xyz">arcus.xyz</a></li>`, Documentation, X, Telegram Channel, Blog. Semua link `/visit/`
punya `data-outbound-host`. Redirect `/visit/` bisa di-resolve (`301 → https://arcus.xyz/`).

**Files:**
- Modify: `pipeline/src/collectors/airdrops-io.ts` (`parseDetail`, `collectAirdropsIo`)
- Modify: `pipeline/test/fixtures/airdrops-detail.html` (tambah kotak Overview + `data-outbound-host`)
- Test: `pipeline/test/collectors.test.ts`

**Interfaces:**
- Produces: `parseDetail(html, url)` mengembalikan field baru `overview: { label: string; href: string; outboundHost:
  string | null }[]` (urutan halaman) dan `visitHosts: Map<string, string>` (kode visit → host). Placeholder di teks
  tetap `[[visit:<code>]]`.
- Dokumen akhir: teks utama + (kalau ada) bagian penutup:
  ```
  Overview
  Website: [https://arcus.xyz/]
  Documentation: [https://docs.arcus.xyz/]
  X (Formerly Twitter): [https://x.com/arcus_xyz]
  Telegram Channel: [https://t.me/Arcus_Official]
  ```
  URL tiap baris = hasil resolve redirect (`cleanResolved`), atau `https://<outboundHost>/` kalau resolve gagal, atau URL
  langsung untuk link non-`/visit/`. Baris dengan host aggregator atau tanpa URL dibuang.

- [ ] **Step 1: Tulis test yang gagal**

```ts
describe("airdrops.io Overview box", () => {
  it("appends the Overview links with their resolved URLs", async () => {
    // fixture: Overview with Website (/visit/9ea3 → https://arcus.xyz/), Documentation (/visit/aea3, resolve fails,
    // data-outbound-host="docs.arcus.xyz"), X (https://x.com/arcus_xyz), Blog (/visit/bea3 → https://bridge.airdrops.io/)
    const doc = (await collectAirdropsIo(httpWith(fixturePages), NOW)).documents[0]!;
    expect(doc.text).toContain("Overview\nWebsite: [https://arcus.xyz/]");
    expect(doc.text).toContain("Documentation: [https://docs.arcus.xyz/]"); // host fallback
    expect(doc.text).toContain("X (Formerly Twitter): [https://x.com/arcus_xyz]");
    expect(doc.text).not.toContain("airdrops.io"); // aggregator target dropped, Blog line removed
  });

  it("uses data-outbound-host when an in-body visit link cannot be resolved", async () => {
    // body link <a href="/visit/5ea3/?k=1" data-outbound-host="app.arcus.xyz">portal</a>, resolveRedirect → null
    const doc = (await collectAirdropsIo(httpWith(pagesWithUnresolvableVisit), NOW)).documents[0]!;
    expect(doc.text).toContain("portal [https://app.arcus.xyz/]");
  });

  it("accepts the correctly spelled wrapper class and pages without an Overview box", () => {
    expect(parseDetail(htmlWithClass("airdrop-info-wrapper"), URL)!.overview).toHaveLength(4);
    expect(parseDetail(htmlWithoutOverview, URL)!.overview).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter pipeline exec vitest run test/collectors.test.ts`
Expected: FAIL (`overview` undefined / teks gak berisi "Overview").

- [ ] **Step 3: Implementasi di `airdrops-io.ts`**

Kotak Overview dicari dengan selector `.aidrop-info-wrapper li, .airdrop-info-wrapper li`, dibaca **sebelum** elemen
yang dibuang dihapus. Label = teks `li` sebelum `:`. `onVisit` di `embedLinks` mencatat `data-outbound-host` per kode.
Saat merangkai dokumen, kode visit yang gak ter-resolve memakai `https://<host>/` (host lewat `cleanUrl`, aggregator
dibuang lewat `isAggregatorHost`).

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter pipeline exec vitest run test/collectors.test.ts`
Expected: PASS, test collector lama tetap lulus.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/collectors/airdrops-io.ts pipeline/test/fixtures/airdrops-detail.html pipeline/test/collectors.test.ts
git commit -m "fix(collector): read airdrops.io Overview box and data-outbound-host"
```

---

### Task 2: Cakupan cek domain (GoPlus throttle, RDAP + crt.sh) dan angka cakupan

Bukti [FACT, run 2026-10-10 + cek manual]: `domain_age` jalan di 10/96 project, `phishing_list` 30/96. RDAP: `.com`,
`.xyz` OK; `.io` 404 di rdap.org; `.finance`/`.to`/`.ai`/`.fi` belum bisa dicek dari sandbox. GoPlus dipanggil dengan
konkurensi 4 tanpa retry. crt.sh [UNKNOWN] belum bisa dicek dari sandbox (diblok proxy); diverifikasi lewat stats run
produksi pertama setelah merge.

**Files:**
- Create: `pipeline/src/enrich/crtsh.ts`
- Modify: `pipeline/src/enrich/goplus.ts`, `pipeline/src/enrich/rdap.ts`, `pipeline/src/steps/score.ts`, `pipeline/src/stats.ts`
- Test: `pipeline/test/enrich.test.ts`, `pipeline/test/run.test.ts`

**Interfaces:**
- Produces:
  - `firstCertificateAgeDays(http: Http, domain: string, now: Date): Promise<number | null>`: GET
    `https://crt.sh/?q=<domain>&output=json`, umur dari `not_before` terkecil, floor hari, `null` untuk status ≠ 200,
    JSON gak valid, array kosong, atau body > 5 MB.
  - `domainAgeDays` (rdap) tetap; score memakai `rdap ?? crtsh`.
  - `checkPhishingSite` mendapat retry: status 429 atau 5xx → tunggu `GOPLUS_RETRY_MS = 2000`, coba sekali lagi.
    Konkurensi GoPlus = 1 (`GOPLUS_CONCURRENCY`), terpisah dari limiter RDAP.
  - Stats baru di `DailyStats`: `projects_with_official_domain`, `domain_age_ran`, `domain_age_from_crtsh`,
    `phishing_list_ran`, `phishing_list_failed`. "Ran" = project aktif yang punya domain resmi dan ceknya mengembalikan
    nilai non-null untuk minimal satu domain resminya.

- [ ] **Step 1: Tulis test yang gagal**

```ts
it("falls back to the earliest crt.sh certificate when RDAP has no answer", async () => {
  const http = fakeHttp({ "https://rdap.org/domain/orbinum.io": { status: 404, body: "" },
    "https://crt.sh/?q=orbinum.io&output=json": { status: 200, body: JSON.stringify([
      { not_before: "2025-01-10T00:00:00" }, { not_before: "2024-03-01T12:00:00" }]) } });
  // score uses rdap ?? crtsh
  expect(await firstCertificateAgeDays(http, "orbinum.io", new Date("2026-10-10T00:00:00Z"))).toBe(952);
});
it("returns null for crt.sh errors, empty lists and oversized bodies", async () => {
  for (const res of [{ status: 502, body: "" }, { status: 200, body: "[]" }, { status: 200, body: "x".repeat(5_000_001) }]) {
    expect(await firstCertificateAgeDays(fakeHttp({ [CRT]: res }), "a.io", NOW)).toBeNull();
  }
});
it("retries GoPlus once after a 429", async () => {
  const http = sequenceHttp([{ status: 429, body: "" }, { status: 200, body: '{"code":1,"result":{"phishing_site":0}}' }]);
  const sleep = vi.fn(async () => {});
  expect(await checkPhishingSite(http, "https://a.io", sleep)).toBe(false);
  expect(sleep).toHaveBeenCalledWith(2000);
});
// run.test.ts
it("reports domain check coverage in the run stats", async () => {
  const stats = await runDaily(deps, config);
  expect(stats.projects_with_official_domain).toBe(/* fixture projects with official domains */ 2);
  expect(stats.domain_age_ran).toBe(2);
  expect(stats.phishing_list_ran).toBe(2);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter pipeline exec vitest run test/enrich.test.ts test/run.test.ts`
Expected: FAIL (`firstCertificateAgeDays` gak ada, stats baru `undefined`).

- [ ] **Step 3: Implementasi**

`checkPhishingSite(http, url, sleep = defaultSleep)` (parameter `sleep` baru, default `setTimeout`). Di `score.ts`:
limiter GoPlus terpisah (`pLimit(1)`), RDAP tetap `ENRICH_CONCURRENCY`; crt.sh hanya dipanggil untuk domain yang RDAP-nya
`null`. Hitung stats cakupan setelah enrichment, sebelum loop assess.

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter pipeline exec vitest run`
Expected: PASS semua.

- [ ] **Step 5: Update `docs/ops/pipeline.md`** (tabel stats: 5 counter baru + artinya; troubleshooting: `domain_age_ran` rendah →
  cek `domain_age_from_crtsh`), lalu commit

```bash
git add pipeline/src/enrich pipeline/src/steps/score.ts pipeline/src/stats.ts pipeline/test docs/ops/pipeline.md
git commit -m "feat(score): crt.sh domain-age fallback, GoPlus throttle and retry, coverage stats"
```

---

### Task 3: Adapter LLM multi-provider (freellm `auto` utama, NVIDIA cadangan) + model yang menjawab

**Files:**
- Modify: `pipeline/src/llm/nvidia.ts` (rename konsep, file tetap), `pipeline/src/llm/extract.ts`, `pipeline/src/config.ts`,
  `pipeline/src/main.ts`, `pipeline/src/store/repo.ts`, `pipeline/src/store/memory-repo.ts`, `pipeline/src/store/supabase-repo.ts`
- Create: `supabase/migrations/0008_served_model.sql`
- Modify: `.github/workflows/daily.yml` (env run step: `LLM_API_KEY`, `LLM_BASE_URL`)
- Test: `pipeline/test/llm.test.ts`, `pipeline/test/run.test.ts`, `pipeline/test/supabase-repo.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderId = "freellm" | "nvidia"`; `ModelConfig` jadi `{ provider: ProviderId; id: string; extraBody: Record<string, unknown> }`.
  - `interface ProviderConfig { baseUrl: string; apiKey: string }`; `loadProviders(env): Record<ProviderId, ProviderConfig>`
    di `config.ts`: freellm = `LLM_BASE_URL` (default `https://freellm.hellvyn.id/v1`) + `LLM_API_KEY`; nvidia =
    `https://integrate.api.nvidia.com/v1` + `NVIDIA_API_KEY`. Trailing slash dibuang.
  - `MODELS` (urutan di Global Constraints). `freellm:auto` pakai `extraBody: {}`.
  - `ChatResult.servedModel: string | null` = field `model` dari chunk SSE pertama yang memilikinya.
  - `ExtractionAttempt.servedModel: string | null`; `ExtractionAttempt.model` = `"<provider>:<id>"`.
  - Circuit breaker memakai kunci `"<provider>:<id>"`.
  - Kolom baru `extractions.served_model text` (nullable).

- [ ] **Step 1: Tulis test yang gagal**

```ts
it("orders freellm auto first and NVIDIA models as fallback", () => {
  expect(defaultConfig.models.map((m) => `${m.provider}:${m.id}`)).toEqual([
    "freellm:auto", "nvidia:z-ai/glm-5.3-flash", "nvidia:moonshotai/kimi-k3", "nvidia:google/gemma-4-31b-it"]);
});
it("loads provider URLs and keys from the environment", () => {
  expect(loadProviders({ LLM_BASE_URL: "https://x.test/v1/", LLM_API_KEY: "", NVIDIA_API_KEY: "n" })).toEqual({
    freellm: { baseUrl: "https://x.test/v1", apiKey: "" },
    nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "n" } });
  expect(loadProviders({}).freellm.baseUrl).toBe("https://freellm.hellvyn.id/v1");
});
it("captures the model that actually answered from the stream", async () => {
  // SSE chunks: {"model":"gpt-oss:120b","choices":[{"delta":{"content":"{}"}}]} ... finish_reason stop
  const r = await streamChat({ provider: "freellm", id: "auto", extraBody: {} }, MSGS, { fetch: sse(chunks), apiKey: "", baseUrl: "https://x.test/v1" });
  expect(r.servedModel).toBe("gpt-oss:120b");
});
it("falls back to NVIDIA on the same document when auto returns unparsable JSON", async () => {
  // freellm:auto → 200 "not json"; nvidia:z-ai/glm-5.3-flash → valid
  const out = await extractWithFallback(DOC, defaultConfig.models, { chat, sleep, breaker });
  expect(out.ok && out.model).toBe("nvidia:z-ai/glm-5.3-flash");
  expect(breaker.isOpen("freellm:auto")).toBe(false);
});
// supabase-repo.test.ts
it("stores served_model with each extraction attempt", async () => { /* insert row has served_model */ });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter pipeline exec vitest run test/llm.test.ts test/run.test.ts test/supabase-repo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

`main.ts` membangun `chat = (model, messages) => streamChat(model, messages, { fetch, ...providers[model.provider] })`.
Migrasi: `alter table extractions add column served_model text;`. Eval (`eval/run-eval.ts`) ikut memakai `loadProviders`
dan `defaultConfig.models`.

- [ ] **Step 4: Jalankan test + pgTAP**

Run: `pnpm --filter pipeline exec vitest run && pnpm -r typecheck`
Run: `npx -y supabase@2.120.0 db reset && npx -y supabase@2.120.0 test db`
Expected: PASS (114 pgTAP lama tetap lulus).

- [ ] **Step 5: Update `docs/ops/pipeline.md`** (secret `LLM_API_KEY`, `LLM_BASE_URL`; urutan model; cara baca
  `extractions.served_model`), commit

```bash
git add pipeline supabase/migrations/0008_served_model.sql .github/workflows/daily.yml docs/ops/pipeline.md
git commit -m "feat(llm): multi-provider models, freellm auto first with NVIDIA fallback, record served model"
```

---

### Task 4: Skema ekstraksi v3 + prompt

**Files:**
- Modify: `packages/core/src/schema/extraction.ts`, `packages/core/src/index.ts`
- Modify: `pipeline/src/llm/prompt.ts`, `pipeline/src/llm/extract.ts` (`postProcess`)
- Test: `packages/core/test/extraction.test.ts` (atau file schema test yang ada), `pipeline/test/llm.test.ts`

**Interfaces:**
- Produces (per project di `extractionSchema`):
  - `steps: { text: string; cadence: "once" | "daily" | "weekly" }[]` (default `[]`)
  - `key_parameters: { name: "allocation" | "distribution" | "tge"; value: string; quote: string }[]`
  - `source_ratings: { name: "difficulty" | "cost"; value: string; quote: string }[]`
  - `latest_update: { text: string; date: string | null } | null` (`date` = YYYY-MM-DD kalender valid)
  - `claimed_backers: { investor: string; quote: string }[]`
  - `capital_required: "none" | "low" | "high" | "unknown"` (default `"unknown"`)
  - `tasks` tetap ada untuk kompatibilitas; `postProcess` mengisinya dari `steps[].text` kalau `tasks` kosong.
  - Helper core baru: `quoteInSource(quote: string, text: string): boolean` (bandingkan setelah whitespace dirapatkan
    dan lowercase).
  - `postProcess` membuang entri `key_parameters`, `source_ratings`, `claimed_backers` yang `quote`-nya gagal
    `quoteInSource`, dan `latest_update` yang `text`-nya gagal.
  - `PROMPT_VERSION = "2026-10-10.3"`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
it("accepts v3 fields and defaults missing ones", () => {
  const p = extractionSchema.parse({ is_airdrop_content: true, projects: [minimalV2Project] }).projects[0]!;
  expect(p.steps).toEqual([]); expect(p.capital_required).toBe("unknown"); expect(p.latest_update).toBeNull();
});
it("rejects an unknown cadence and an invalid latest_update date", () => {
  expect(() => extractionSchema.parse(withSteps([{ text: "x", cadence: "hourly" }]))).toThrow();
  expect(() => extractionSchema.parse(withLatest({ text: "x", date: "2026-02-30" }))).toThrow();
});
it("matches quotes ignoring whitespace runs and case", () => {
  expect(quoteInSource("Grant/Community  Airdrop allocation of 5%", "...grant/community airdrop allocation of 5% of total")).toBe(true);
  expect(quoteInSource("allocation of 10%", "allocation of 5%")).toBe(false);
});
// pipeline llm.test.ts
it("drops v3 entries whose quote is not in the source text and keeps the rest", async () => {
  const p = project({ key_parameters: [{ name: "allocation", value: "5%", quote: "5% of total supply" },
    { name: "tge", value: "Q4", quote: "TGE in Q4 2026" /* not in DOC text */ }],
    claimed_backers: [{ investor: "Paradigm", quote: "backed by Paradigm" /* not in text */ }] });
  const out = await extractWithFallback(docWith("... 5% of total supply ..."), MODELS, { chat: scripted([reply({ content: okJson([p]) })]).chat, sleep });
  const got = out.ok ? out.result.projects[0]! : null;
  expect(got?.key_parameters.map((k) => k.name)).toEqual(["allocation"]);
  expect(got?.claimed_backers).toEqual([]);
});
it("fills tasks from steps when tasks is empty", async () => { /* steps [{text:"Bridge",cadence:"once"}] → tasks ["Bridge"] */ });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter @saf/core exec vitest run && pnpm --filter pipeline exec vitest run test/llm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi skema + prompt**

Prompt: tambah field ke blok Schema, plus definisi:
- `steps`: langkah berurutan untuk ikut; `cadence` "daily"/"weekly" hanya kalau teks menyebut pengulangan ("check in
  daily", "every week"), selain itu "once".
- `key_parameters`: cuma kalau teks menyatakan alokasi airdrop, metode distribusi, atau tanggal/waktu TGE.
- `source_ratings`: cuma penilaian yang ditulis sumber (mis. "Difficulty: Easy", "Cost to earn: Medium").
- `latest_update`: kalimat update terbaru yang ditandai sumber ("Latest Update: …").
- `claimed_backers`: investor yang disebut teks mendukung project; `quote` = kalimat aslinya. Jangan menebak.
- `capital_required`: `high` kalau teks menyebut deposit/modal minimal ≥ $500 atau setara, `low` kalau di bawahnya atau
  cuma gas, `none` kalau gratis, `unknown` kalau gak disebut.
Aturan untrusted-text yang ada tetap di atas aturan baru.

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @saf/core exec vitest run && pnpm --filter pipeline exec vitest run && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core pipeline/src/llm pipeline/test/llm.test.ts
git commit -m "feat(extract): v3 schema - steps with cadence, key parameters, source ratings, backers, capital"
```

---

### Task 5: Menyimpan hasil ekstraksi v3

**Files:**
- Create: `supabase/migrations/0009_extraction_v3.sql`, `supabase/tests/extraction_v3.test.sql`
- Modify: `pipeline/src/store/repo.ts`, `memory-repo.ts`, `supabase-repo.ts`, `pipeline/src/steps/merge.ts`, `pipeline/src/run.ts` (`extractionInputs`)
- Test: `pipeline/test/run.test.ts`, `pipeline/test/memory-repo.test.ts`, `pipeline/test/supabase-repo.test.ts`

**Interfaces:**
- Consumes: v3 fields dari Task 4.
- Produces:
  - Migrasi 0009: `alter table tasks add column position integer not null default 0, add column cadence text not null
    default 'once' check (cadence in ('once','daily','weekly'));`
  - `PipelineRepo.replaceTasks(projectId, documentId, steps: { text: string; cadence: "once" | "daily" | "weekly" }[])`
    (signature berubah; `position` = indeks array).
  - `ProjectInput` mendapat `steps`, `facts: { field: string; value: string; quote: string }[]`.
  - Field evidence baru (tabel `evidence` yang ada, pola hapus-lalu-tulis per dokumen seperti `status`):
    `key_parameter:<name>`, `source_rating:<name>`, `latest_update` (value = tanggal atau ""), `claimed_backer`
    (value = nama investor), `capital_required` (value = level; gak ditulis kalau `unknown`).
  - `ProjectForScoring` mendapat `steps: { text: string; cadence: string }[]` dan `facts: { field: string; value: string; quote: string }[]`
    (dipakai Plan 5).

- [ ] **Step 1: Tulis test yang gagal**

```ts
it("stores steps in order with their cadence and v3 facts as evidence", async () => {
  // reply for INK_PAGE adds steps [{text:"Check in",cadence:"daily"},{text:"Bridge",cadence:"once"}],
  // key_parameters allocation "5%", claimed_backers Paradigm (quotes present in fixture text)
  await runDaily(deps, config);
  const p = (await repo.listProjectsForScoring(60, NOW)).find((x) => x.nameKey === "ink")!;
  expect(p.steps).toEqual([{ text: "Check in", cadence: "daily" }, { text: "Bridge", cadence: "once" }]);
  expect(p.facts).toContainEqual({ field: "key_parameter:allocation", value: "5%", quote: expect.any(String) });
  expect(p.facts).toContainEqual({ field: "claimed_backer", value: "Paradigm", quote: expect.any(String) });
});
it("replaces a document's v3 facts when the page changes", async () => { /* second run without backer → no claimed_backer */ });
```

pgTAP (`extraction_v3.test.sql`): kolom `tasks.position`/`tasks.cadence` ada; insert cadence `'hourly'` gagal dengan
`23514`; `extractions.served_model` ada; anon tetap gak bisa insert ke `tasks`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter pipeline exec vitest run`
Expected: FAIL.

- [ ] **Step 3: Implementasi** (repo memory + supabase, merge menulis steps & facts, `listProjectsForScoring` membaca keduanya;
  urutan steps by `position`).

- [ ] **Step 4: Jalankan semua test**

Run: `pnpm --filter pipeline exec vitest run && pnpm -r typecheck && npx -y supabase@2.120.0 db reset && npx -y supabase@2.120.0 test db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase pipeline
git commit -m "feat(merge): store ordered steps with cadence and v3 facts"
```

---

### Task 6: Eval diperluas (≥ 30 kasus, nilai deadline dan URL resmi)

**Files:**
- Modify: `pipeline/eval/score.ts`, `pipeline/eval/run-eval.ts`, `pipeline/eval/ground-truth.json`, `pipeline/eval/README.md`
- Create: `pipeline/eval/export-cases.ts` (ambil teks dokumen produksi ke `eval/cases/`, gitignored)
- Test: `pipeline/test/eval-score.test.ts`

**Interfaces:**
- Produces:
  - `CaseTruth` kind `project` mendapat opsional `deadlines?: { kind: DeadlineKind; date: string | null }[]` dan
    `officialDomains?: string[]`.
  - `CaseScore` mendapat `deadlinesExpected`, `deadlinesMatched` (cocok = kind + date sama), `officialDomainsExpected`,
    `officialDomainsMatched` (registrable domain dari `official_urls` yang lolos `filterUrlsInSource`).
  - Pass conditions baru (spec §12): status ≥ 90% kasus berstatus, deadline matched/expected ≥ 90%, URL halusinasi 0,
    domain resmi matched/expected ≥ 80%. Syarat v1 (negatif ditolak, abstract ended, radar recall) tetap.
  - `export-cases.ts`: argumen `--limit N`, ambil dokumen `airdrops_io`/`telegram` terbaru yang teksnya belum di-purge
    (pakai `SUPABASE_URL` + service key dari env), tulis `cases/<id>.txt` + `.meta.json`. Gak pernah menulis ke repo.

- [ ] **Step 1: Tulis test yang gagal** (`eval-score.test.ts`)

```ts
it("scores deadlines by kind and date", () => {
  const s = scoreCase("c", resultWith({ deadlines: [{ kind: "claim", date: "2026-10-05", precision: "exact", text: "Oct 5" }] }),
    truthWith({ deadlines: [{ kind: "claim", date: "2026-10-05" }, { kind: "tge", date: "2026-10-01" }] }), TEXT, []);
  expect([s.deadlinesMatched, s.deadlinesExpected]).toEqual([1, 2]);
});
it("scores official domains from source-verified URLs only", () => { /* URL not in text does not count */ });
it("fails the run when deadline accuracy is below 90%", () => {
  expect(evaluatePass(scoresWithDeadlines(8, 10), truth).find((c) => c.name.startsWith("deadline accuracy"))?.pass).toBe(false);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter pipeline exec vitest run test/eval-score.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi scoring + export**

- [ ] **Step 4: Label ≥ 22 kasus baru** (total ≥ 30): jalankan `export-cases.ts --limit 40`, pilih campuran (≥ 12 halaman
  airdrops.io live/announced, ≥ 5 speculative, ≥ 5 post Telegram, ≥ 2 negatif), label `status`, `token`, `chain`,
  `deadlines`, `officialDomains` **dari teks** ke `ground-truth.json`. Tiap label yang ragu ditandai di
  `eval/README.md` bagian "Label yang perlu review owner". Teks kasus gak di-commit.

- [ ] **Step 5: Jalankan eval sekali dan catat hasil** (gak harus lulus di plan ini; angkanya masuk spec §12 G4–G6)

Run: `NODE_USE_ENV_PROXY=1 pnpm --filter pipeline eval`
Expected: tabel per kasus + baris PASS/FAIL per syarat. Tulis ringkasan angka ke spec §12 (kolom "Hasil terakhir").

- [ ] **Step 6: Commit**

```bash
git add pipeline/eval pipeline/test/eval-score.test.ts docs/superpowers/specs/2026-10-10-curation-foundation-design.md
git commit -m "feat(eval): 30+ labelled cases, deadline and official-domain scoring, spec quality gates"
```

---

### Task 7: Set uji scam dan legit (risk engine)

**Files:**
- Create: `pipeline/eval/scam-set/README.md`, `pipeline/eval/scam-set/build.ts`, `pipeline/eval/scam-set/run.ts`,
  `pipeline/eval/scam-set/legit.json`
- Test: `pipeline/test/scam-set.test.ts`

**Interfaces:**
- Produces:
  - `legit.json` (di-commit, label kita sendiri): ≥ 30 airdrop yang sudah terbukti bayar, `{ name, officialDomain,
    claimDomain? }` (mis. Arbitrum `arbitrum.io`, Optimism `optimism.io`, Jupiter `jup.ag`, Starknet `starknet.io`, …).
  - `build.ts`: ambil daftar domain phishing publik (MetaMask `eth-phishing-detect` `src/config.json` → `blacklist`;
    ScamSniffer `scam-database` `blacklist/domains.json`) [UNKNOWN: format terkini dicek saat implementasi], pilih ≥ 30
    domain yang menyerupai airdrop/claim (`/(airdrop|claim|drop|reward)/` atau nama project di `legit.json`), tulis
    `cases/scam.json` (gitignored).
  - `toRiskInput(c: ScamCase | LegitCase, enrich): RiskInput`: kasus scam = project bernama brand yang ditiru, link
    `claim` ke domain scam, domain resmi = domain asli brand (kalau ada di `legit.json`) atau kosong.
  - `run.ts`: jalankan enrichment asli (GoPlus, RDAP/crt.sh) + `assessRisk`, cetak: scam yang levelnya `low`/`medium`
    (= lolos risiko), legit yang `high`/`critical`, dan cakupan cek. Plan 5 menambahkan `curate()` ke runner ini (G7/G8).
  - Exit code 0 selalu (laporan, bukan gerbang CI).

- [ ] **Step 1: Tulis test yang gagal** (logika murni, tanpa network)

```ts
it("maps a scam case to a claim link on the scam domain with the brand's real domain", () => {
  const input = toRiskInput({ kind: "scam", domain: "arbitrum-claim.xyz", brand: "Arbitrum" }, legitIndex, noEnrich);
  expect(input.linkDomains).toContainEqual({ domain: "arbitrum-claim.xyz", kind: "claim" });
  expect(input.project.officialDomains).toEqual(["arbitrum.io"]);
});
it("selects airdrop-like domains from a blacklist", () => {
  expect(selectAirdropLike(["arb-airdrop.com", "random.site", "jup-claim.io"], legitNames)).toEqual(["arb-airdrop.com", "jup-claim.io"]);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter pipeline exec vitest run test/scam-set.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** `build.ts`, `run.ts`, `legit.json`

- [ ] **Step 4: Jalankan sekali dan catat**

Run: `pnpm --filter pipeline exec tsx eval/scam-set/build.ts && NODE_USE_ENV_PROXY=1 pnpm --filter pipeline exec tsx eval/scam-set/run.ts`
Expected: laporan angka. Catat ke spec §12 (G7/G8 versi risk-only) dan `scam-set/README.md`. Kalau ada scam yang lolos
risiko, tulis polanya di README sebagai masukan Plan 5 (jangan ubah aturan risiko di task ini).

- [ ] **Step 5: Commit**

```bash
git add pipeline/eval/scam-set pipeline/test/scam-set.test.ts docs/superpowers/specs/2026-10-10-curation-foundation-design.md
git commit -m "feat(eval): scam and legit test set for the risk engine"
```

---

### Task 8: Seleksi DefiLlama v2 (#41)

**Files:**
- Modify: `pipeline/src/collectors/defillama.ts` (`protocolSchema`, `selectSpeculativeCandidates`), `pipeline/src/config.ts`
- Test: `pipeline/test/defillama.test.ts`

**Interfaces:**
- `protocolSchema` mendapat `listedAt` (unix detik, nullish), `rugged` (boolean nullish), `deadFrom` (nullish),
  `misrepresentedTokens` (boolean nullish).
- `selectSpeculativeCandidates(protocols, opts: { minTvl: number; excludedCategories: string[]; limit: number; newWithinDays: number; now: Date })`:
  syarat lama (tanpa `gecko_id`, `symbol === "-"`, kategori gak dikecualikan) + TVL ≥ `minTvl` + bukan `rugged`, gak ada
  `deadFrom`, bukan `misrepresentedTokens`. Urut: `listedAt` dalam `newWithinDays` hari dulu, lalu `change7d` desc
  (null terakhir), lalu TVL desc.
- Config: `defillama: { minTvl: 1_000_000, excludedCategories: ["CEX"], limit: 80, newWithinDays: 180 }`.
- `SpeculativeCandidate` mendapat `listedAt: Date | null`; teks dokumen DefiLlama menyebut tanggal listing.

- [ ] **Step 1: Test yang gagal**

```ts
it("keeps young protocols above $1M and drops rugged, dead and misrepresented ones", () => {
  const out = selectSpeculativeCandidates([proto({ name: "Young", tvl: 2e6, listedAt: daysAgo(30) }),
    proto({ name: "Old", tvl: 5e7, listedAt: daysAgo(900), change_7d: 50 }), proto({ name: "Rug", tvl: 9e6, rugged: true }),
    proto({ name: "Dead", tvl: 9e6, deadFrom: "2026-01-01" }), proto({ name: "Mis", tvl: 9e6, misrepresentedTokens: true }),
    proto({ name: "Tiny", tvl: 9e5 })], { ...opts, now: NOW });
  expect(out.map((c) => c.name)).toEqual(["Young", "Old"]);
});
it("caps at the limit", () => { /* 100 eligible → 80 */ });
```

- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter pipeline exec vitest run && pnpm -r typecheck` lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(collect): DefiLlama v2 selection (young protocols, $1M floor, drop rugged/dead)"`

---

### Task 9: Collector AlphaDrops (#41)

**Files:**
- Create: `pipeline/src/collectors/alphadrops.ts`, `pipeline/test/fixtures/alphadrops-listing.html`,
  `pipeline/test/fixtures/alphadrops-detail.html` (dipotong dari halaman asli; cuma data publik)
- Modify: `pipeline/src/collectors/types.ts` (`SourceKind` + `"alphadrops"`), `pipeline/src/steps/collect.ts`,
  `pipeline/src/config.ts`, pemeriksa host non-project yang sekarang menolak `airdrops.io` (cari `airdrops.io` di
  `pipeline/src/steps/merge.ts` dan `packages/core/src`), `supabase/migrations/0009_extraction_v3.sql` (check
  `documents.source_kind` + `'alphadrops'`)
- Test: `pipeline/test/alphadrops.test.ts`, `pipeline/test/run.test.ts`, `supabase/tests/extraction_v3.test.sql`

**Interfaces:**
- `parseAlphaListing(html: string): AlphaItem[]` — gabungkan string dari semua `self.__next_f.push([1,"…"])`, ambil
  objek JSON yang punya `slug` dan `fundingAmount`, dedupe per `slug`. `AlphaItem = { name; slug; status; shortDescription;
  description; categories: string[]; blockchains: string[]; fundingAmount: string | null; website: string | null;
  hasPoints: boolean; claimDeadline: string | null; addedDate: string }`. Nilai `"$undefined"`, `""`, `"NA"`, `"—"` →
  `null`; `"$$30M"` → `"$30M"` (teks apa adanya, gak diparse jadi angka).
- `parseAlphaDetail(html: string): string` — teks konten utama (deskripsi, "Airdrop tasks", "Deep dive strategy") lewat
  `normalizeText`, tanpa blok "Learn more"/iklan/"Other airdrop opportunities".
- `resolveWebsite(http, raw: string, intermediaryHosts: string[]): Promise<string | null>` — `cleanUrl`, ikuti
  `resolveRedirect` maks. 3 kali; host akhir `alphadrops.net` atau persis ada di `intermediaryHosts` → `null`.
- `collectAlphaDrops(http, now, opts: { maxDetails: number; delayMs: number; intermediaryHosts: string[] }): Promise<CollectorResult>`
  — status `active`/`upcoming`/`claimable` saja; satu dokumen per item: `url = https://alphadrops.net/airdrops/<slug>`,
  `sourceKey = "alphadrops"`, `publishedAt = addedDate`, teks:
  `Name: …\nStatus (AlphaDrops): …\nCategories: …\nChains: …\nFunding (reported by AlphaDrops): …\nWebsite: <url>\n\n<detail>`
  (baris Website dihilangkan kalau `resolveWebsite` null). Detail gagal diambil → dokumen tetap dibuat dari listing.
  Hash dokumen yang ada mencegah ekstraksi ulang kalau isinya sama.
- Config: `alphadrops: { enabled: true, maxDetails: 80, delayMs: 1500, intermediaryHosts: [ ...daftar Global Constraints ] }`.

- [ ] **Step 1: Test yang gagal**

```ts
it("parses listing items from the Next.js payload", () => {
  const items = parseAlphaListing(LISTING);
  expect(items.find((i) => i.slug === "catalyst")).toMatchObject({ status: "upcoming", fundingAmount: "$30M", website: "https://catalyst.app/?r=gVe0u" });
});
it("strips the referral and drops intermediary hosts", async () => {
  expect(await resolveWebsite(fakeHttp({}), "https://catalyst.app/?r=gVe0u", HOSTS)).toBe("https://catalyst.app/");
  expect(await resolveWebsite(fakeHttp({ "https://s.kaito.ai/x": null }), "https://s.kaito.ai/x", HOSTS)).toBeNull();
  expect(await resolveWebsite(fakeHttp({}), "https://kaito.ai/", HOSTS)).toBe("https://kaito.ai/");
});
it("skips ended items and keeps listing-only documents when a detail page fails", async () => { /* detail 500 → doc tanpa detail */ });
it("reports failed when the payload is missing", async () => { expect((await collectAlphaDrops(fakeHttp({ listing: "<html></html>" }), NOW, OPTS)).failed).toBe(true); });
// run.test.ts: an alphadrops document never yields alphadrops.net as an official domain
```

- [ ] **Step 2–4:** gagal → implementasi → `pnpm --filter pipeline exec vitest run && pnpm -r typecheck && npx -y supabase@2.120.0 db reset && npx -y supabase@2.120.0 test db` lulus.
- [ ] **Step 5: Commit** — `git commit -m "feat(collect): AlphaDrops collector with referral stripping and intermediary-host filter"`

---

## Selesai kalau

- Semua test (`pnpm -r test`), typecheck, pgTAP, dan e2e lulus.
- Run produksi: dokumen `alphadrops` masuk (`docs_collected` naik), kandidat DefiLlama sampai 80.
- Run produksi pertama setelah merge: `projects_with_official_domain` naik jauh dari 7 (target spec §5.0: ≥ 80% project
  live/announced teks), `domain_age_ran` dan `phishing_list_ran` dilaporkan, `extractions.served_model` terisi.
- Angka eval dan set uji scam tercatat di spec §12.
