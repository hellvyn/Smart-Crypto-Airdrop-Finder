# Plan 1: Core Library & Daily Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Job harian di GitHub Actions yang ngumpulin teks airdrop, ngekstrak pakai LLM NVIDIA, gabungin jadi project, nilai risiko, dan
nyimpen semuanya di Supabase.

**Architecture:** Monorepo pnpm. `packages/core` berisi logika murni tanpa jaringan: skema, pembersih URL, normalisasi deadline,
penggabungan entitas, status, dan aturan risiko. `pipeline/` berisi IO: collector, client LLM, enrichment, repository Supabase, dan
orchestrator. Semua IO lewat dependency yang di-inject, supaya orchestrator bisa dites pakai fake.

**Tech Stack:**
- Node.js 24 LTS, TypeScript (strict), pnpm workspaces
- Vitest, zod, cheerio, tldts, fastest-levenshtein, p-limit
- @supabase/supabase-js, Supabase CLI (migrasi SQL)

**Spec:** `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md`

**Urutan plan:** Plan 1 (ini) → Plan 2 (`2026-10-10-plan-2-web-auth-wallet.md`) → Plan 3 (`2026-10-10-plan-3-notifications.md`).

## Prasyarat (owner, sebelum Task 1)

- Spec §12 #1, ToS NVIDIA: kalau gak boleh buat produk publik, **stop** dan revisi spec. Adapter LLM tetap bisa dipakai buat provider
  lain.
- Bikin project Supabase Free. Simpan GitHub Secrets: `NVIDIA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Spec §12 #3, #4, #5, #7, #10 dicek waktu verifikasi manual di Task 12 Step 6, lalu hasilnya dicatat di dokumen konteks:
  - Keep-alive workflow 60 hari
  - Pause Supabase
  - Log Actions di repo public bisa dibaca publik
  - Limit GoPlus
  - Seberapa telat cron

## Global Constraints

- Semua kode TypeScript strict. Identifier, komentar, dan UI copy pakai bahasa Inggris.
- `packages/core` **gak boleh** import modul jaringan atau DB.
- Log pipeline **gak boleh** berisi email, alamat wallet, atau isi watchlist. `RunStats` cuma berisi angka (spec §9).
- Jadwal job: cron `0 23 * * *` (23:00 UTC) + `workflow_dispatch`.
- LLM: selalu `stream: true`, decode UTF-8, sukses = `finish_reason === "stop"` + lolos `extractionSchema`. Maksimal **3** panggilan
  paralel.
- Fallback model, berurutan:
  1. `moonshotai/kimi-k3` dengan `{chat_template_kwargs:{thinking:false}}`
  2. `z-ai/glm-5.3-flash` dengan `{reasoning_effort:"low"}`
  3. `google/gemma-4-31b-it` tanpa parameter tambahan

  Semua model pakai `max_tokens: 8192` dan `temperature: 0`.
- Retensi teks dokumen: **90 hari** (hash tetap disimpan).
- Kandidat spekulatif DefiLlama: `gecko_id` kosong **dan** `symbol === "-"`, `tvl > 10_000_000`, kategori yang dikecualikan diatur
  di config, diurutkan dari `change_7d` terbesar.
- Parameter referral yang dibuang: `ref`, `referral`, `utm_*`, plus path `/r/<kode>`.
- Fixture test berupa HTML **yang dipangkas dan ditulis tangan**, cukup buat menjaga selector. **Jangan** commit salinan utuh halaman
  pihak ketiga (repo public, ToS airdrops.io masih [UNKNOWN]).

## Review Focus

1. **Varian nama project yang sama** (`$INK`, `Ink Chain`, `INK`) harus jadi satu project. Dites di Task 4.
2. **Tanggal tanpa tahun di akhir tahun:** published 2026-12-28, teks "Jan 3" → `2027-01-03`. Dites di Task 3.
3. **Parameter query yang sah ikut kebuang:** `?chain=arb&ref=X` → `?chain=arb`. Dites di Task 2.
4. **Domain homograph IDN:** `unіswap.org` dengan huruf Kirilik `і` → harus kedeteksi sebagai domain mirip. Dites di Task 6.
5. **Collector diam-diam ngasih 0 dokumen** waktu struktur HTML berubah. Harus dicatat sebagai `sourceFailed`, bukan "gak ada
   airdrop". Dites di Task 7 dan Task 12.
6. **Kalimat peringatan kepicu sebagai permintaan berbahaya:** task "Never share your seed phrase" gak boleh jadi Critical. Dites di
   Task 6.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc (24)
packages/core/src/
  types.ts                  Status, DeadlineKind, DatePrecision, RiskLevel, Severity
  schema/extraction.ts      extractionSchema (zod) + ExtractionResult
  url/clean.ts              cleanUrl
  url/domain.ts             registrableDomain, toUnicodeDomain
  url/in-source.ts          filterUrlsInSource
  deadline/normalize.ts     normalizeDeadline
  entity/name.ts            normalizeName
  entity/merge.ts           decideMerge
  status/derive.ts          pickEvidenceDate, deriveStatus
  risk/dangerous-asks.ts    detectDangerousAsks
  risk/lookalike.ts         isLookalike
  risk/assess.ts            assessRisk + RiskInput/RiskAssessment
  chain/adapter.ts          ChainAdapter, ActivitySummary (dipakai di Plan 2)
  index.ts
pipeline/src/
  config.ts                 PipelineConfig + defaultConfig
  http.ts                   httpGet, resolveRedirect
  collectors/types.ts       CollectedDocument, CollectorResult
  collectors/airdrops-io.ts parseListing, parseDetail, collectAirdropsIo
  collectors/telegram.ts    parseTelegramPage, collectTelegram
  collectors/defillama.ts   selectSpeculativeCandidates
  llm/nvidia.ts             streamChat
  llm/prompt.ts             PROMPT_VERSION, buildMessages
  llm/extract.ts            extractWithFallback
  enrich/goplus.ts, enrich/rdap.ts, enrich/hacks.ts
  store/repo.ts             PipelineRepo interface
  store/memory-repo.ts      fake buat test
  store/supabase-repo.ts    implementasi asli
  steps/*.ts                collect, extract, merge, score, purge
  run.ts                    runDaily
  main.ts                   entrypoint CLI
pipeline/eval/              run-eval.ts, ground-truth.json, cases/ (gitignored)
pipeline/test/fixtures/     HTML yang dipangkas
supabase/migrations/0001_pipeline.sql
.github/workflows/ci.yml, .github/workflows/daily.yml
```

---

### Task 1: Monorepo skeleton + CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Create: `pipeline/package.json`, `pipeline/tsconfig.json`
- Create: `.github/workflows/ci.yml`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: script root `pnpm test`, `pnpm typecheck`. Package `@saf/core` bisa di-import dari `pipeline`.

- [ ] **Step 1: Tulis smoke test:** `import * as core from "@saf/core"; expect(core).toBeDefined()`
- [ ] **Step 2: Bikin workspace.** `.gitignore` berisi `node_modules`, `dist`, `.env*`, `pipeline/eval/cases/`.
- [ ] **Step 3: Jalankan `pnpm install && pnpm test && pnpm typecheck`.** Expected: 1 test PASS, typecheck 0 error.
- [ ] **Step 4: Bikin `ci.yml`:** jalan di push + pull_request, Node dari `.nvmrc`, `pnpm install --frozen-lockfile`, `pnpm typecheck`,
  `pnpm test`.
- [ ] **Step 5: Commit** `chore: scaffold pnpm monorepo with core and pipeline packages`

### Task 2: Pembersih URL dan domain

**Files:**
- Create: `packages/core/src/url/clean.ts`, `packages/core/src/url/domain.ts`, `packages/core/src/url/in-source.ts`
- Test: `packages/core/test/url.test.ts`

**Interfaces:**
- Produces:
  - `cleanUrl(raw: string): { url: string; referralStripped: boolean }`
  - `registrableDomain(url: string): string | null` (pakai tldts, hasilnya ASCII/punycode)
  - `toUnicodeDomain(domain: string): string`
  - `filterUrlsInSource(urls: string[], sourceText: string): string[]`

- [ ] **Step 1: Tulis test yang gagal:**
  - `cleanUrl("https://omni.variational.io/?ref=OMNISHUKOC2R")` → `{url:"https://omni.variational.io/", referralStripped:true}`
  - `cleanUrl("https://www.raycash.xyz/r/V8P3TX")` → `{url:"https://www.raycash.xyz/", referralStripped:true}`
  - `cleanUrl("https://app.x.io/swap?chain=arb&ref=X&utm_source=tg")` → `url` sama dengan `"https://app.x.io/swap?chain=arb"`
  - `cleanUrl("https://claim.deepbook.tech/")` → `referralStripped:false`
  - `registrableDomain("https://waitlist.deepbook.tech/x")` → `"deepbook.tech"`
  - `filterUrlsInSource(["https://a.io/x","https://b.io"], "see [https://a.io/x/] and &amp;")` → `["https://a.io/x"]`.
    Bandinginnya case-insensitive, `&amp;`→`&`, dan trailing slash diabaikan.
- [ ] **Step 2: Jalankan `pnpm --filter @saf/core test url`.** Expected: FAIL (module not found)
- [ ] **Step 3: Implementasi** sesuai signature di atas. Daftar parameter referral diambil dari Global Constraints.
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(core): url cleaning, registrable domain, url-in-source filter`

### Task 3: Skema ekstraksi + normalisasi deadline

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/schema/extraction.ts`, `packages/core/src/deadline/normalize.ts`
- Test: `packages/core/test/extraction.test.ts`, `packages/core/test/deadline.test.ts`

**Interfaces:**
- Produces:
  - `type Status = "live"|"announced"|"speculative"|"ended"|"unknown"`
  - `type DeadlineKind = "claim"|"snapshot"|"campaign_end"|"withdraw_funds"|"tge"|"other"`
  - `type DatePrecision = "exact"|"approximate"|"month"|"quarter"`
  - `extractionSchema` (zod) dan `type ExtractionResult = z.infer<typeof extractionSchema>`. Field-nya persis kontrak spec §4.3:
    `is_airdrop_content`, dan `projects[]` berisi `{name, token_symbol, chains, status, status_evidence, tasks, deadlines[{kind,
    date, precision, text}], official_urls, confidence}`.
  - `type ExtractedDeadline = ExtractionResult["projects"][number]["deadlines"][number]`
  - `normalizeDeadline(d: ExtractedDeadline, publishedAt: Date | null): ExtractedDeadline`

- [ ] **Step 1: Tulis test yang gagal:**
  - `extractionSchema.safeParse({is_airdrop_content:false, projects:[]}).success === true`
  - Status `"maybe"` → `success === false`
  - Deadline `date:"2026-13-01"` → `success === false`
  - `normalizeDeadline({kind:"claim",date:"2026-01-03",precision:"exact",text:"Jan 3"}, new Date("2026-12-28"))` → `date` jadi
    `"2027-01-03"`
  - `normalizeDeadline({...,date:"2026-10-10",text:"Oct 10"}, new Date("2026-10-09"))` → gak berubah
  - `normalizeDeadline({...,date:"2026-10-11",precision:"exact",text:"approximately Oct 11"}, …)` → `precision === "approximate"`
  - `text:"Dec 15, 2026"` gak pernah digeser tahunnya
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.** Aturan `normalizeDeadline`:
  - Kalau `text` gak mengandung tahun 4 digit dan `publishedAt` ada, ambil kemunculan pertama bulan-hari itu yang **≥ publishedAt − 7
    hari**.
  - Kalau `text` cocok `/\b(approximately|approx\.?|around|about|~)\b/i`, set `precision = "approximate"`.

  Dua aturan ini nutup temuan Spike 3: model ngabaikan aturan "approximately".
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(core): extraction schema and deadline normalization`

### Task 4: Normalisasi nama, keputusan merge, dan status

**Files:**
- Create: `packages/core/src/entity/name.ts`, `packages/core/src/entity/merge.ts`, `packages/core/src/status/derive.ts`
- Test: `packages/core/test/entity.test.ts`, `packages/core/test/status.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(name: string): string`
  - `interface ProjectRef { id: string; nameKey: string; domains: string[] }`
  - `decideMerge(incoming: { nameKey: string; domains: string[] }, candidates: ProjectRef[]): { action: "merge"; projectId: string } | { action: "create"; lookalikeOf: string | null }`
  - `pickEvidenceDate(doc: { publishedAt: Date | null; pageUpdatedAt: Date | null; fetchedAt: Date }): Date`
  - `interface StatusEvidence { status: Status; at: Date }`
  - `deriveStatus(evidence: StatusEvidence[], current: Status | null): { status: Status; conflict: boolean }`

- [ ] **Step 1: Tulis test yang gagal:**
  - Nama `"$INK"`, `"Ink Chain"`, `"INK"` → semua jadi `"ink"`
  - `"Jumper Exchange"` → `"jumper"`
  - `"Arcus 🏹"` → `"arcus"`
  - Kata yang dibuang: `airdrop`, `chain`, `network`, `protocol`, `labs`, `finance`, `exchange`, `$`, emoji, tanda baca
  - `decideMerge({nameKey:"deepbook",domains:["deepbook.tech"]}, [{id:"p1",nameKey:"deepbook",domains:["deepbook.tech"]}])` →
    merge p1
  - Nama sama tapi domain `["deepbook-claim.xyz"]` → `{action:"create", lookalikeOf:"p1"}`
  - Nama sama, `domains:[]` → merge p1
  - Gak ada kandidat → `{action:"create", lookalikeOf:null}`
  - `deriveStatus([{status:"live",at:d1},{status:"ended",at:d2>d1}], "live")` → `{status:"ended", conflict:false}`
  - Dua status beda di tanggal UTC yang sama dengan bukti terbaru → `conflict:true`, `status` = bukti dengan timestamp paling akhir
  - Semua bukti `"unknown"` dan `current = "live"` → `{status:"live"}`
  - Gak ada `current` → `"unknown"`
  - `pickEvidenceDate`: pakai `publishedAt` dulu, lalu `pageUpdatedAt`, lalu `fetchedAt`
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.** Bukti `unknown` diabaikan selama masih ada bukti lain.
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(core): name normalization, merge decision, status derivation`

### Task 5: Interface chain adapter

**Files:**
- Create: `packages/core/src/chain/adapter.ts`
- Test: `packages/core/test/adapter.test.ts`

**Interfaces:**
- Produces (dipakai Plan 2):

```ts
export interface ActivitySummary {
  chain: string; txCount: number; firstTxAt: Date | null; lastTxAt: Date | null;
  activeMonths: { value: number; exact: boolean }; source: string; fetchedAt: Date;
}
export interface ChainAdapter {
  family: "evm"; chains: string[];
  isValidAddress(address: string): boolean;
  getActivity(address: string, chain: string): Promise<ActivitySummary>;
}
export const isEvmAddress: (address: string) => boolean; // /^0x[0-9a-fA-F]{40}$/
```

- [ ] **Step 1: Tulis test:** `isEvmAddress("0x" + "a".repeat(40)) === true`, `isEvmAddress("0x123") === false`
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(core): chain adapter interface`

### Task 6: Aturan risiko

**Files:**
- Create: `packages/core/src/risk/dangerous-asks.ts`, `packages/core/src/risk/lookalike.ts`, `packages/core/src/risk/assess.ts`
- Test: `packages/core/test/risk.test.ts`

**Interfaces:**
- Produces (`Severity` dan `RiskLevel` dideklarasi di `types.ts`, lalu di-re-export):

```ts
export type Severity = "critical" | "high" | "medium" | "info";
export type RiskLevel = "low" | "medium" | "high" | "critical" | "insufficient_data";
export interface RiskReason { code: string; severity: Severity; message: string; source: string }
export interface RiskCheck { id: CheckId; ran: boolean }
export type CheckId = "dangerous_asks" | "phishing_list" | "domain_age" | "lookalike" | "token_security"
  | "contract_verified" | "hack_history" | "corroboration";
export interface RiskInput {
  project: { name: string; officialDomains: string[]; status: Status; tokenSymbol: string | null;
             conflict: boolean; sourceCount: number; hasOfficialSocial: boolean; lookalikeOf: string | null };
  tasks: string[];
  linkDomains: { domain: string; kind: "website" | "app" | "docs" | "claim" | "social" }[];
  domainAgeDays: Record<string, number | null>;   // null = cek gagal / TLD gak didukung
  phishingFlags: Record<string, boolean | null>;   // GoPlus phishing_site
  token: { honeypot: boolean; ownerCanMintOrChangeBalance: boolean; maliciousCreator: boolean } | null;
  contractVerified: boolean | null;
  hackCount: number | null;
}
export interface RiskAssessment { level: RiskLevel; points: number; reasons: RiskReason[]; checks: RiskCheck[] }
export function detectDangerousAsks(tasks: string[]): RiskReason[];
export function isLookalike(domain: string, projectName: string, officialDomains: string[]): boolean;
export function assessRisk(input: RiskInput): RiskAssessment;
```

Aturan, dipetakan dari spec §6:

| Kode | Keparahan | Kapan kena |
|---|---|---|
| `asks_secret` | critical | Task cocok `seed phrase\|recovery phrase\|mnemonic\|private key\|secret phrase` **dan** gak didahului `never\|don't\|do not\|not` dalam 5 kata sebelumnya |
| `asks_payment` | critical | Task cocok `(send\|deposit\|transfer\|pay).{0,40}(to (claim\|receive\|unlock)\|fee to claim\|gas fee)` |
| `phishing_listed` | critical | `phishingFlags[d] === true` |
| `token_honeypot` | critical | `token.honeypot` |
| `new_claim_domain` | high | Link jenis `claim` dengan domain ∉ `officialDomains` dan umur < 30 hari |
| `lookalike_domain` | high | `isLookalike` true untuk domain link mana pun, atau `project.lookalikeOf !== null` |
| `token_owner_powers` | high | `token.ownerCanMintOrChangeBalance` |
| `malicious_creator` | high | `token.maliciousCreator` |
| `young_domain` | medium | Domain mana pun < 90 hari |
| `unverified_contract` | medium | `contractVerified === false` |
| `single_source` | medium | `sourceCount === 1 && !hasOfficialSocial` |
| `conflicting_evidence` | medium | `project.conflict` |
| `hack_history` | medium | `hackCount > 0` |
| `speculative` | info | `status === "speculative"` |

**Aturan level:**
- `level` = keparahan tertinggi yang ada di `reasons` (critical > high > medium). Kalau gak ada di atas `info`, level `low`.
- **Pengecualian:** kalau gak ada reason ≥ medium **dan** check yang `ran` < 4 dari 8, level jadi `insufficient_data`.
- `points` = critical 100, high 30, medium 10, info 0. Cuma disimpan buat kalibrasi nanti.
- Check `token_security` dan `contract_verified` jalan cuma kalau inputnya bukan `null`. **[Catatan]** Di v1 dua check ini selalu
  `ran:false`, karena belum ada sumber alamat kontrak.

**`isLookalike`:**
- `false` kalau `registrableDomain` dari domain itu ada di `officialDomains`.
- Selain itu: ubah domain ke Unicode, petakan huruf Kirilik/Yunani yang mirip Latin (`а→a, е→e, о→o, р→p, с→c, х→x, і→i, ј→j,
  ѕ→s, ο→o, α→a`), ambil label kedua dari kanan, buang tanda `-`.
- Hasilnya `true` kalau label mengandung `normalizeName(projectName)` (panjangnya ≥ 3), atau jarak Levenshtein ke nama itu ≤ 2
  (kalau panjang nama ≥ 5).

- [ ] **Step 1: Tulis test yang gagal:**
  - `detectDangerousAsks(["Enter your seed phrase to verify"])` → satu reason `asks_secret` critical
  - `detectDangerousAsks(["Never share your seed phrase"])` → `[]`
  - `detectDangerousAsks(["Send 0.1 ETH to receive your airdrop"])` → `asks_payment`
  - `isLookalike("claim-uniswap-airdrop.xyz","Uniswap",["uniswap.org"])` → true
  - `isLookalike(new URL("https://unіswap.org").hostname,"Uniswap",["uniswap.org"])` (pakai `і` Kirilik) → true
  - `isLookalike("app.uniswap.org","Uniswap",["uniswap.org"])` → false
  - `isLookalike("deepbook.tech","Raycash",["raycash.xyz"])` → false
  - `assessRisk` dengan `phishing_listed` + semua check lain bersih → `level:"critical"`
  - Domain klaim `claim-x.xyz` (umur 5 hari, bukan resmi) → `"high"`, reasons mengandung `new_claim_domain` dan `young_domain`
  - Cuma `speculative` dan 6 check jalan → `"low"`
  - Gak ada reason dan cuma 3 check jalan → `"insufficient_data"`
  - Check `token_security` → `ran:false` kalau `token:null`
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.** Tiap reason ngisi `message` (bahasa Inggris, menyebut domain atau angkanya) dan `source` (`goplus`,
  `rdap`, `defillama`, `blockscout`, `extraction`, `heuristic`).
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(core): risk rules, lookalike detection, dangerous-ask detection`

### Task 7: Collector airdrops.io + Telegram

**Files:**
- Create: `pipeline/src/http.ts`, `pipeline/src/collectors/types.ts`, `pipeline/src/collectors/airdrops-io.ts`,
  `pipeline/src/collectors/telegram.ts`
- Create fixtures: `pipeline/test/fixtures/airdrops-home.html`, `pipeline/test/fixtures/airdrops-detail.html`,
  `pipeline/test/fixtures/telegram.html` (dipangkas dan ditulis tangan, cukup buat menjaga selector)
- Test: `pipeline/test/collectors.test.ts`

**Interfaces:**
- Consumes: `cleanUrl` (Task 2)
- Produces:

```ts
export type SourceKind = "airdrops_io" | "telegram";
export interface CollectedDocument {
  sourceKind: SourceKind; sourceKey: string; url: string; text: string;
  publishedAt: Date | null; pageUpdatedAt: Date | null; fetchedAt: Date;
}
export interface CollectorResult { sourceKey: string; documents: CollectedDocument[]; failed: boolean; error?: string }
export interface Http { get(url: string): Promise<{ status: number; body: string }>; resolveRedirect(url: string): Promise<string | null> }
export function parseListing(html: string): string[];
export function parseDetail(html: string, url: string): { title: string; text: string; visitLinks: string[]; pageUpdatedAt: Date | null } | null;
export function collectAirdropsIo(http: Http, now: Date): Promise<CollectorResult>;
export function parseTelegramPage(html: string, channel: string): { messages: { id: number; url: string; publishedAt: Date; text: string }[] };
export function collectTelegram(http: Http, channel: string, sinceMessageId: number | null, now: Date): Promise<CollectorResult>;
```

**Aturan:**
- Teks dokumen menyisipkan tiap link sebagai ` [<url-yang-sudah-dibersihkan>] `, supaya LLM bisa nyalin URL apa adanya.
- `/visit/<kode>/` di-resolve dulu lewat `http.resolveRedirect`, baru dibersihin pakai `cleanUrl`.
- Konten detail = isi antara `.airdrop-info` dan `.airdrop-bottom`.
- `pageUpdatedAt` diambil dari teks `Updated <d Mon yyyy>`.
- Listing cuma ambil URL detail `https://airdrops.io/<slug>/`. Path non-airdrop dibuang: `blog`, `calendar`, `faq`, `contact`,
  `feed`, `wp-json`, `speculative`, `confirmed`, `claims`, `stay-safe`, `airdrop-alert`, `bulk`.
- Telegram: pesan ada di `.tgme_widget_message_wrap`, teks di `.tgme_widget_message_text`, waktu di `time[datetime]`, id dari
  `data-post`. Paginasi `?before=<oldestId>` sampai ketemu `sinceMessageId`, **maksimal 5 halaman**.
- `failed: true` kalau HTTP ≠ 200 **atau** parser ngasih 0 item padahal halamannya 200. Itu tanda struktur HTML berubah.

- [ ] **Step 1: Tulis test yang gagal:**
  - `parseListing(fixture)` mengandung `"https://airdrops.io/deepbook/"` dan gak mengandung `".../blog/"`
  - `parseDetail` → `title === "DeepBook"`, `pageUpdatedAt` = 2026-07-24, teks gak mengandung isi sidebar
  - `parseTelegramPage` → jumlah pesan, id, dan `publishedAt` sesuai fixture
  - `collectAirdropsIo` pakai fake `Http` yang ngembaliin `<html></html>` buat halaman utama → `{failed:true, documents:[]}`
  - Redirect yang di-resolve ke `https://x.io/?ref=AB` → teks dokumen mengandung `[https://x.io/]`
- [ ] **Step 2: Jalankan `pnpm --filter pipeline test collectors`.** Expected: FAIL
- [ ] **Step 3: Implementasi** pakai cheerio. `http.ts` pakai `fetch` global dengan User-Agent `SmartAirdropFinder/0.1 (+repo URL)`
  dan timeout 20 detik. `resolveRedirect` pakai `redirect: "manual"` lalu baca header `location`.
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(pipeline): airdrops.io and telegram collectors`

### Task 8: Kandidat spekulatif DefiLlama

**Files:**
- Create: `pipeline/src/collectors/defillama.ts`
- Test: `pipeline/test/defillama.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SpeculativeCandidate { name: string; slug: string; url: string | null; chains: string[]; tvl: number; change7d: number | null; category: string }
export function selectSpeculativeCandidates(protocols: unknown[], opts: { minTvl: number; excludedCategories: string[]; limit: number }): SpeculativeCandidate[];
```

- [ ] **Step 1: Tulis test yang gagal.** Pakai 4 protocol sintetis:
  - Punya `gecko_id` → dibuang
  - `symbol: "-"`, TVL 5 juta → dibuang
  - Kategori `"CEX"` → dibuang
  - Dua protocol yang lolos → diurutkan dari `change_7d` terbesar. `change_7d: null` ditaruh paling akhir
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi** (validasi bentuk tiap item pakai zod; item yang gak valid dilewati).
  **Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(pipeline): defillama speculative candidate selection`

### Task 9: Client LLM NVIDIA + ekstraksi dengan fallback

**Files:**
- Create: `pipeline/src/llm/nvidia.ts`, `pipeline/src/llm/prompt.ts`, `pipeline/src/llm/extract.ts`
- Test: `pipeline/test/llm.test.ts`

**Interfaces:**
- Consumes: `extractionSchema`, `normalizeDeadline`, `filterUrlsInSource` (Task 2–3), `CollectedDocument` (Task 7)
- Produces:

```ts
export interface ModelConfig { id: string; extraBody: Record<string, unknown> }
export interface ChatResult { content: string; finishReason: string | null; latencyMs: number; httpStatus: number }
export function streamChat(model: ModelConfig, messages: { role: "system" | "user"; content: string }[],
  deps: { fetch: typeof fetch; apiKey: string; baseUrl?: string }): Promise<ChatResult>;
export const PROMPT_VERSION: string; // "2026-10-10.1"
export function buildMessages(doc: Pick<CollectedDocument, "url" | "publishedAt" | "text">): { role: "system" | "user"; content: string }[];
export interface ExtractionAttempt { model: string; httpStatus: number; finishReason: string | null; latencyMs: number; error: string | null; raw: string }
export type ExtractOutcome = { ok: true; result: ExtractionResult; model: string; attempts: ExtractionAttempt[] } | { ok: false; attempts: ExtractionAttempt[] };
export function extractWithFallback(doc: CollectedDocument, models: ModelConfig[], deps: { chat: typeof streamChat; sleep: (ms: number) => Promise<void> }): Promise<ExtractOutcome>;
```

**Aturan:**
- Body request: `{model, messages, temperature:0, max_tokens:8192, stream:true, stream_options:{include_usage:true}, ...extraBody}`.
- Baca SSE pakai `TextDecoder("utf-8", {stream:true})`. Header charset diabaikan.
- Prompt system = isi prompt dari Spike 3, dengan field `deadline`/`deadline_text` diganti array `deadlines` sesuai skema.
  Pesan user: `Source: <url>\nPublished: <iso|unknown>\n\nTEXT:\n<text>`.
- Parse JSON: coba `JSON.parse` langsung. Kalau gagal, buang code fence lalu ambil `{` pertama sampai `}` terakhir.
- Sukses = `finishReason === "stop"` **dan** `extractionSchema` lolos.
- HTTP 429: tunggu 2 detik, lalu 4 detik (maksimal 2 retry di model yang sama), baru pindah ke model berikutnya. Kegagalan lain
  langsung pindah model.
- Setelah sukses: `official_urls` di-filter pakai `filterUrlsInSource`, lalu `cleanUrl`. Deadline di-`normalizeDeadline` pakai
  `doc.publishedAt`.

- [ ] **Step 1: Tulis test yang gagal.** `fetch` palsu ngembaliin `ReadableStream` SSE:
  - Karakter `×` (UTF-8 `0xC3 0x97`) dipotong di antara dua chunk → `content` mengandung `×`, bukan `Ã`
  - Stream berhenti tanpa `finish_reason` → `finishReason === null`
  - `extractWithFallback`: model 1 ngembaliin `finish_reason:"stop"` dengan konten kosong, model 2 ngembaliin JSON valid →
    `ok:true, model === models[1].id`, `attempts.length === 2`
  - Model 1 kena 429 tiga kali → `sleep` dipanggil dengan 2000 lalu 4000, lalu pindah ke model 2
  - Output berisi URL yang gak ada di teks sumber → URL itu dibuang dari hasil
  - Semua model gagal → `ok:false`
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan test.** Expected: PASS
- [ ] **Step 5: Commit** `feat(pipeline): streaming NVIDIA client and extraction with model fallback`

### Task 10: Enrichment (GoPlus phishing, RDAP, DefiLlama hacks)

**Files:**
- Create: `pipeline/src/enrich/goplus.ts`, `pipeline/src/enrich/rdap.ts`, `pipeline/src/enrich/hacks.ts`
- Test: `pipeline/test/enrich.test.ts`

**Interfaces:**
- Consumes: `Http` (Task 7), `normalizeName` (Task 4)
- Produces:
  - `checkPhishingSite(http: Http, url: string): Promise<boolean | null>`. Panggil
    `GET https://api.gopluslabs.io/api/v1/phishing_site?url=<enc>`. Return `result.phishing_site === 1`, atau `null` kalau error.
  - `domainAgeDays(http: Http, domain: string, now: Date): Promise<number | null>`. Panggil `GET https://rdap.org/domain/<domain>`,
    cari event `eventAction === "registration"`. Return `null` kalau 404, error, atau gak ada event.
  - `countHacks(hacks: unknown[], projectName: string): number`. Cocokkan `normalizeName(hack.name)` dengan
    `normalizeName(projectName)`.
  - `fetchHacks(http: Http): Promise<unknown[] | null>`. Panggil `GET https://api.llama.fi/hacks`.

- [ ] **Step 1: Tulis test yang gagal.** Pakai fake `Http`:
  - RDAP registrasi `2026-10-01`, `now = 2026-10-10` → `9`
  - RDAP 404 → `null`
  - GoPlus `{result:{phishing_site:0}}` → `false`
  - GoPlus HTTP 500 → `null`
  - `countHacks([{name:"Ink Chain"}], "INK")` → `1`
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Commit** `feat(pipeline): goplus, rdap and hack history enrichment`

### Task 11: Skema database + repository

**Files:**
- Create: `supabase/config.toml` (lewat `supabase init`), `supabase/migrations/0001_pipeline.sql`
- Create: `pipeline/src/store/repo.ts`, `pipeline/src/store/memory-repo.ts`, `pipeline/src/store/supabase-repo.ts`
- Test: `pipeline/test/memory-repo.test.ts`

**Interfaces:**
- Produces: tabel-tabel di bawah, interface `PipelineRepo`, `MemoryRepo` (dipakai test Task 12), dan `SupabaseRepo`.

Tabel di `0001_pipeline.sql`:
- `documents`, `extractions`, `projects`, `evidence`, `deadlines`, `tasks`, `links`, `risk_assessments`,
  `pipeline_runs`. Kolomnya sesuai spec §5.
- Tambahan yang belum ada di spec: `projects.name_key text`, `projects.lookalike_of uuid null`, `documents.source_key text`,
  `documents.extraction_status text check in ('pending','done','not_airdrop')`.
- Tabel baru **`project_changes`** (`project_id`, `field` (`status`|`risk_level`), `old_value`, `new_value`, `changed_at`). Dipakai
  digest di Plan 3 buat nampilin perubahan status dan level risiko.
- RLS aktif di semua tabel. Policy `select` buat `anon` dan `authenticated` di tabel publik: `projects`, `evidence`, `deadlines`,
  `tasks`, `links`, `risk_assessments`, `pipeline_runs`. **Gak ada** policy tulis; pipeline nulis pakai service role.
- `extractions` dan `documents` gak bisa dibaca publik.

```ts
export interface StoredDocument extends CollectedDocument { id: string; contentHash: string; extractionStatus: "pending" | "done" | "not_airdrop" }
export interface ProjectRow { id: string; slug: string; name: string; nameKey: string; tokenSymbol: string | null; chains: string[];
  officialDomains: string[]; status: Status; conflict: boolean; lookalikeOf: string | null; firstSeen: Date; lastSeen: Date }
export interface RunStats { [counter: string]: number }   // cuma angka, gak boleh teks
export interface PipelineRepo {
  getDocumentHash(url: string): Promise<string | null>;
  upsertDocument(doc: CollectedDocument, contentHash: string): Promise<StoredDocument>;  // hash beda → status jadi "pending"
  lastTelegramMessageId(channel: string): Promise<number | null>;
  listPendingDocuments(limit: number): Promise<StoredDocument[]>;
  saveExtraction(documentId: string, attempt: ExtractionAttempt, promptVersion: string): Promise<void>;
  setExtractionStatus(documentId: string, status: StoredDocument["extractionStatus"]): Promise<void>;
  findProjectsByNameKey(nameKey: string): Promise<ProjectRow[]>;
  createProject(p: Omit<ProjectRow, "id" | "firstSeen" | "lastSeen">, at: Date): Promise<ProjectRow>;
  updateProject(id: string, patch: Partial<ProjectRow>, at: Date): Promise<void>;  // status berubah → tulis project_changes
  addEvidence(e: { projectId: string; documentId: string; field: string; value: string; quote: string; at: Date }): Promise<void>;
  listStatusEvidence(projectId: string): Promise<StatusEvidence[]>;
  replaceDeadlines(projectId: string, documentId: string, ds: ExtractedDeadline[]): Promise<void>;
  replaceTasks(projectId: string, documentId: string, tasks: string[]): Promise<void>;
  upsertLinks(projectId: string, links: { url: string; kind: string; referralStripped: boolean }[]): Promise<void>;
  listProjectsForScoring(activeSinceDays: number, now: Date): Promise<(ProjectRow & { tasks: string[]; links: { url: string; kind: string }[]; sourceCount: number })[]>;
  latestRiskLevel(projectId: string): Promise<RiskLevel | null>;
  saveRiskAssessment(projectId: string, a: RiskAssessment, at: Date): Promise<void>;  // level berubah → tulis project_changes
  startRun(at: Date): Promise<string>;
  finishRun(runId: string, stats: RunStats, at: Date): Promise<void>;
  purgeDocumentText(olderThanDays: number, now: Date): Promise<number>;
}
```

- [ ] **Step 1: Tulis test yang gagal buat `MemoryRepo`:**
  - `upsertDocument` dengan hash sama dua kali → status tetap `"done"` kalau sebelumnya done
  - Hash beda → status jadi `"pending"`
  - `updateProject` dengan status baru → satu baris `project_changes`
  - `purgeDocumentText(90, now)` ngosongin teks dokumen berumur > 90 hari, `contentHash` tetap ada
- [ ] **Step 2: Implementasi `MemoryRepo`.** Jalankan test. Expected: PASS
- [ ] **Step 3: Tulis migrasi + `SupabaseRepo`.** Verifikasi pakai `supabase start && supabase db reset` (butuh Docker). Expected:
  migrasi jalan tanpa error. Lalu jalankan smoke script `pnpm --filter pipeline tsx scripts/repo-smoke.ts`, yang manggil
  `upsertDocument` → `findProjectsByNameKey` ke DB lokal. Expected: exit 0.
- [ ] **Step 4: Commit** `feat(pipeline): database schema and pipeline repository`

### Task 12: Orchestrator `runDaily` + workflow harian

**Files:**
- Create: `pipeline/src/config.ts`, `pipeline/src/steps/collect.ts`, `pipeline/src/steps/extract.ts`, `pipeline/src/steps/merge.ts`,
  `pipeline/src/steps/score.ts`, `pipeline/src/steps/purge.ts`, `pipeline/src/run.ts`, `pipeline/src/main.ts`
- Create: `.github/workflows/daily.yml`
- Test: `pipeline/test/run.test.ts`

**Interfaces:**
- Consumes: semua task sebelumnya
- Produces:

```ts
export interface PipelineConfig {
  telegramChannels: string[];          // default ["airdrops_io"]
  defillama: { minTvl: number; excludedCategories: string[]; limit: number };  // 10_000_000, ["CEX"], 50
  models: ModelConfig[];               // urutan dari Global Constraints
  llmConcurrency: number;              // 3
  maxDocumentsPerRun: number;          // 150
  scoreActiveSinceDays: number;        // 60
  textRetentionDays: number;           // 90
}
export interface PipelineDeps { repo: PipelineRepo; http: Http; chat: typeof streamChat; sleep: (ms: number) => Promise<void>; now: () => Date }
export function runDaily(deps: PipelineDeps, config: PipelineConfig): Promise<RunStats>;
```

**Urutan `runDaily`:**
1. `startRun`
2. Collect semua sumber (tiap sumber dibungkus try/catch → counter `source_failed`)
3. `upsertDocument` buat dokumen yang hash-nya baru atau berubah
4. Ekstrak dokumen `pending`, paling banyak `maxDocumentsPerRun`, dengan p-limit `llmConcurrency`:
   - `is_airdrop_content:false` → status `not_airdrop`
   - Gagal semua model → tetap `pending`
5. Merge per project hasil ekstraksi: `normalizeName` → `decideMerge` → create atau update, lalu evidence, deadlines, tasks, links,
   dan `deriveStatus`
6. Kandidat DefiLlama → project berstatus `speculative` dengan evidence dari DefiLlama (tanpa LLM)
7. Score: project aktif ≤ 60 hari dienrich, lalu `assessRisk`, lalu `saveRiskAssessment`
8. `purgeDocumentText(90)`
9. `finishRun`

Counter `RunStats`: `docs_collected`, `docs_changed`, `extract_ok`, `extract_failed`, `not_airdrop`, `projects_created`,
`projects_updated`, `assessed`, `source_failed`, `purged`.

Enrichment (GoPlus, RDAP) di-memo per domain dalam satu run, dan hacks DefiLlama diambil sekali per run. Ini pengganti "cache per
domain" di spec §6, karena refresh-nya memang harian. Daftar sumber disimpan di `PipelineConfig` (spec §4.1), jadi tabel `sources`
gak dibikin.

`main.ts` bikin deps asli dari env (`NVIDIA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), manggil `runDaily`, nyetak
**cuma** `JSON.stringify(stats)`, dan exit dengan kode 1 kalau `source_failed` = jumlah semua sumber.

- [ ] **Step 1: Tulis test yang gagal.** Pakai `MemoryRepo`, fake `Http` (fixture dari Task 7), dan fake `chat`:
  - Run pertama → `docs_collected > 0`, `extract_ok ≥ 1`, project DeepBook dibuat dengan status `live`
  - Run kedua dengan input yang sama → `docs_changed === 0`, dan `chat` gak dipanggil
  - Halaman utama airdrops.io ngembaliin `<html></html>` → `source_failed === 1`, sumber lain tetap diproses
  - Dua dokumen nyebut `"$INK"` dan `"Ink Chain"` → cuma satu project `ink`
  - Dokumen kedua bikin status DeepBook jadi `ended` → ada baris `project_changes` buat `status`
  - `stats` cuma berisi nilai bertipe number
- [ ] **Step 2: Jalankan test.** Expected: FAIL
- [ ] **Step 3: Implementasi** semua step dan `runDaily`.
- [ ] **Step 4: Jalankan `pnpm test && pnpm typecheck`.** Expected: semua PASS
- [ ] **Step 5: Bikin `daily.yml`:**
  - `on: schedule: [{cron: "0 23 * * *"}]` + `workflow_dispatch`
  - `permissions: contents: read`
  - Env dari secrets
  - Langkah: `pnpm install --frozen-lockfile && pnpm --filter pipeline start`
- [ ] **Step 6: Verifikasi manual:** push, lalu jalankan `workflow_dispatch`. Expected: job hijau, log cuma berisi satu baris JSON
  angka, dan tabel `projects` di Supabase terisi.
- [ ] **Step 7: Commit** `feat(pipeline): daily orchestrator and scheduled workflow`

### Task 13: Eval set LLM

**Files:**
- Create: `pipeline/eval/run-eval.ts`, `pipeline/eval/ground-truth.json`, `pipeline/eval/README.md`
- Test: `pipeline/test/eval-score.test.ts`

**Interfaces:**
- Consumes: `extractWithFallback`, `buildMessages` (Task 9)
- Produces:
  - `scoreCase(caseId: string, result: ExtractionResult | null, truth: GroundTruth): CaseScore`
  - Script `pnpm --filter pipeline eval`. Exit code 1 kalau ada syarat lulus yang gagal.

**Ground truth** (dari Spike 3, di-commit karena ini buatan kita sendiri):

| Case | Status | Token | Chain |
|---|---|---|---|
| `aio_deepbook` | `live` | `DEEP` | `sui` |
| `aio_variational` | `live` | `VAR` | `arbitrum` |
| `aio_abstract` | `ended` | `null` | – |
| `aio_raycash` | `speculative` | `null` | `polygon` |
| `tg_flop` | `speculative` | `FLOP` | – |
| `tg_ink` | `speculative` | `INK` | – |
| `tg_ledger_negative` | `is_airdrop_content:false` | – | – |
| `tg_weekly_radar` | – | – | – |

Untuk `tg_weekly_radar`, yang dinilai cuma recall: minimal 22 dari 28 slug project.

**Teks kasus** dibaca dari `pipeline/eval/cases/<id>.txt`. Folder ini **gitignored**, karena repo public dan ToS sumbernya
[UNKNOWN]. `README.md` ngejelasin cara ngisinya.

**Syarat lulus** (spec §11):
- URL halusinasi = 0
- `tg_ledger_negative` ditolak
- `aio_abstract` = `ended`
- Akurasi status ≥ baseline di `ground-truth.json` (awal: 5 dari 6)

- [ ] **Step 1: Tulis test yang gagal buat `scoreCase`:**
  - Abstract dijawab `"speculative"` → `statusOk:false`
  - Ada URL yang gak ada di teks → `hallucinatedUrls: 1`
- [ ] **Step 2: Jalankan test, pastikan FAIL. Implementasi. Jalankan lagi.** Expected: PASS
- [ ] **Step 3: Verifikasi manual** (butuh `NVIDIA_API_KEY` dan folder `cases/` terisi): `pnpm --filter pipeline eval`. Expected:
  tabel metrik tercetak, exit 0.
- [ ] **Step 4: Commit** `feat(pipeline): llm extraction eval harness`
