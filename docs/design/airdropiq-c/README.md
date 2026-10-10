# AirdropIQ, sistem desain C "Sertifikat inspeksi"

Mockup acuan ada di folder ini: `CLanding`, `CList`, `CProject`, `CMobile`, `CGarapan` (`*.dc.html`). Nilai token dan aturan
bentuk ada di spec §16 (`docs/superpowers/specs/2026-10-10-curation-foundation-design.md`). Teks UI mengikuti glosarium
Plan 6; kalau mockup dan glosarium beda, glosarium yang dipakai.

## Token

Semua ada di `:root` pada `apps/web/app/globals.css`: `--ground`, `--surface`, `--ink`, `--ink-2`, `--muted`,
`--line-soft`, `--accent`, `--accent-text`, `--pass`, `--ended`, `--caution`, `--warn-fill`, `--member-fill`, `--hazard`.

- `--accent` (#FF5A1F) cuma buat isian. Teks oranye kecil pakai `--accent-text`.
- Sudut selalu 0. Garis 2 px untuk kartu dan tiket, 3 px untuk header, kontainer utama, dan tombol, putus-putus 2 px
  untuk "Member only".
- Terang saja di versi ini (gak ada `prefers-color-scheme: dark`).
- Huruf: Barlow Condensed 800 huruf kapital untuk judul (kelas `ui-display`), Barlow 400 sampai 700 untuk isi. Dimuat
  lewat `next/font/google` di `app/layout.tsx`.

## Komponen

Semua diimpor dari `@/components/ui`. Gaya ada di bagian "Design C components" di `globals.css` (kelas `ui-*`).

| Komponen | Props | Catatan |
|---|---|---|
| `Stamp` | `top`, `bottom`, `tone: "pass" \| "ended" \| "caution"`, `size: "sm" \| "md" \| "lg"`, `rotate` | Cap lingkaran (58/92/150 px, garis 3/4/5 px). Rotasi dibatasi -10..10 derajat. `aria-label` = `top bottom`. |
| `HazardBar` | - | Strip 10 px, taruh di atas tiap halaman. Sudah dipasang di `SiteHeader`. |
| `HazardBlock` | `children` | Bingkai strip hazard 8 px dengan panel putih. |
| `Ticket` | `href`, `children` | Satu link per airdrop. 5 kolom di 960 px ke atas (cap, nama, sinyal, deadline, worth), 1 kolom di bawahnya. |
| `Tag` | `tone: "verified" \| "reported" \| "plain" \| "claimOpen" \| "warn"` | verified = garis hijau, reported = putus-putus, claimOpen = isian hitam, warn = isian peach. |
| `LinkStatus` | `status: "official" \| "different_domain" \| "phishing" \| "unchecked"`, `url` | `phishing` merender `HazardBlock` saja: gak ada `<a>`, URL-nya juga gak dicetak. Status lain: `ExternalLink` + `Tag`. |
| `MemberOnly` | `title` | Kotak putus-putus "Member only". Tanpa tombol atau link (#46). |
| `WorthBadge` | `level: "high" \| "medium" \| "low"` | "Sangat worth it" / "Worth it" / "Kurang worth it". |
| `TabBar` | `tabs: { label, count?, href, active }[]` | Tab aktif punya `aria-current="page"`. Target sentuh minimal 44 px. |
| `SectionCard` | `number?`, `title`, `badge?`, `children` | Judul `h2` "01 · Judul". |
| `Button` | `variant: "primary" \| "secondary" \| "dark"`, plus `href?` | Tanpa `href` jadi `<button>` (props native diteruskan), dengan `href` jadi link bergaya sama. |

## Aturan pakai

- Link keluar selalu lewat `ExternalLink` (dipakai `LinkStatus`), jangan `<a href>` langsung.
- Jangan pernah render link yang statusnya `phishing`; kalau perlu menampilkan status link, pakai `LinkStatus`.
- Header gak punya link daftar. Link akun (Watchlist, Wallets, Settings) cuma muncul untuk user yang login.
- Halaman baru: taruh konten di dalam `<main>` dari layout, bagian bernomor pakai `SectionCard`, tiap airdrop pakai
  `Ticket`.
