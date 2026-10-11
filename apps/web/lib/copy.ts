// Every user-facing string of the web app, grouped by page or area. Wording follows the Plan 6 glossary first and the
// design C mockups (docs/design/airdropiq-c) second. Style rules: "kamu" tone, no em dash, straight quotes, and none of
// the banned words; test/copy-style.test.ts checks every string literal in this file.
// Pure module (no I/O, no server-only imports, type-only imports), so client components can use it too.
import type {
  AnalystVerdict,
  CheckId,
  DatePrecision,
  DeadlineKind,
  RiskLevel,
  Severity,
  Status,
  Tab,
  WorthLevel,
} from "@saf/core";

const BRAND = "AirdropIQ";

/** Browser tab title of a page: "Garapan saya · AirdropIQ". */
export function pageTitle(page: string): string {
  return `${page} · ${BRAND}`;
}

export const site = {
  title: BRAND,
  description: "Airdrop yang udah dicek, lengkap dengan source-nya.",
};

export const header = {
  navLabel: "Menu utama",
  brand: BRAND,
  /** Next to the logo (owner 2026-10-11). */
  beta: "Beta Version by Trisna",
  airdrops: "Airdrop",
  why: "Kenapa AirdropIQ",
  trackRecord: "Track record",
  garapan: "Garapan saya",
  coach: "AI Coach",
  watchlist: "Watchlist",
  wallets: "Wallet",
  account: "Akun",
  login: "Login",
  logout: "Logout",
};

export const auth = {
  title: "Login",
  heading: "Login",
  submit: "Login",
  email: "Email",
  password: "Password",
  noAccess: "Belum punya akses? Hubungi admin.",
  errors: {
    invalidCredentials: "Email atau password salah.",
    rateLimited: "Terlalu banyak percobaan login. Tunggu sebentar, lalu coba lagi.",
    /** 5 wrong attempts under one email or one address (migration 0019): blocked for 15 minutes. */
    throttled: "Udah 5 kali salah login. Coba lagi 15 menit lagi.",
    captchaNeeded: "Selesaikan verifikasi \"Aku bukan robot\" dulu, lalu login lagi.",
    captchaLabel: "Verifikasi",
    network: "Gak bisa nyambung ke server login. Cek koneksi kamu, lalu coba lagi.",
  },
};

export const errors = {
  generic: "Terjadi kesalahan. Coba lagi.",
  retry: "Coba lagi",
  notFoundHeading: "Halaman gak ketemu",
  notFoundText: "Halamannya gak ada, atau udah dipindah.",
  backToList: "← Balik ke list",
};

/** Labels shared by the list, the project page and the badges (lib/view.ts holds the logic). */
export const labels = {
  status: {
    live: "Live",
    announced: "Diumumkan",
    speculative: "Spekulatif",
    ended: "Ended",
    unknown: "Belum pasti",
  } satisfies Record<Status, string>,
  risk: {
    low: "Rendah",
    medium: "Sedang",
    high: "Tinggi",
    critical: "Kritis",
    insufficient_data: "Data belum cukup",
  } satisfies Record<RiskLevel, string>,
  notAssessed: "Belum dinilai",
  riskBadge: "Risiko",
  statusBadge: "Status",
  deadlineKind: {
    claim: "Claim",
    snapshot: "Snapshot",
    campaign_end: "Akhir campaign",
    withdraw_funds: "Tarik dana",
    tge: "TGE",
    other: "Lainnya",
  } satisfies Record<DeadlineKind, string>,
  precision: {
    exact: "tanggal tepat",
    approximate: "tanggal perkiraan",
    month: "bulannya aja",
    quarter: "kuartalnya aja",
  } satisfies Record<DatePrecision, string>,
  /** Risk checks, in the order coverage lists them (glossary #53 where it names them). */
  checks: {
    dangerous_asks: "Minta seed phrase / bayar dulu",
    phishing_list: "Database phishing",
    domain_age: "Umur domain",
    lookalike: "Domain tiruan",
    token_security: "Risiko kontrak token",
    contract_verified: "Kontrak verified",
    hack_history: "Riwayat hack",
    corroboration: "Cross-check antar source",
    ai_review: "Review AI",
  } satisfies Record<CheckId, string>,
  /** Coverage of all checks. "{k}/4 security check jalan" is reserved for the 4 key checks (glossary). */
  coverage: (ran: number, total: number, missing: string[]) =>
    missing.length > 0 ? `${ran}/${total} cek jalan. Belum bisa dicek: ${missing.join(", ")}.` : `${ran}/${total} cek jalan`,
  /** How many of the 4 key checks ran in the latest risk assessment (glossary "cakupan cek"). */
  keyChecks: (ran: number) => `${ran}/4 security check jalan`,
  /** End date of a project in the ended tab (#40). */
  endedOn: (date: string) => `Ended ${date}`,
  /** Short dollar amounts: "45 jt", "1,2 M". */
  usdUnits: { thousand: "rb", million: "jt", billion: "M" },
  /** Evidence fields are free-form strings in the database (no core type), so the map stays open. */
  evidenceField: {
    status: "Status",
    defillama_listing: "Listing DefiLlama",
    dangerous_ask: "Permintaan berbahaya",
  } as Record<string, string>,
  severity: {
    critical: "Tingkat kritis",
    high: "Tingkat tinggi",
    medium: "Tingkat sedang",
    info: "Info",
  } satisfies Record<Severity, string>,
  /** "Dicek ..." of a curated project (#44). */
  checked: {
    today: "Dicek hari ini",
    yesterday: "Dicek kemarin",
    daysAgo: (days: number) => `Dicek ${days} hari lalu`,
    staleSince: (date: string) => `Belum dicek lagi sejak ${date}`,
    frozen: (date: string) => `Last check ${date}`,
  },
  /** Row tag of the capital sub-filter (#52). */
  capital: {
    free: "Gratis",
    unknown: "Modal belum jelas",
    deposit: "Butuh $",
    depositMin: (amount: string) => `Butuh $${amount}+`,
  },
};

/** The curated /airdrops list (Plan 6 Task 4); the watchlist reuses its row texts. */
export const list = {
  title: "Daftar airdrop",
  summary: {
    title: "Update hari ini",
    checked: "dicek",
    passed: "lolos",
  },
  tabs: {
    live_now: "Live sekarang",
    early_bets: "Early",
    ended: "Ended",
  } satisfies Record<Tab, string>,
  sortLabel: "Urutan:",
  sort: { visitor: "Baru dicek", member: "Paling worth it", ended: "Baru ended" },
  capitalLabel: "Modal:",
  capital: { all: "Semua", free: "Gratis", deposit: "Butuh $" },
  option: (label: string, count: number) => `${label} · ${count}`,
  trackRecord: (r: { listed: number; noToken: number; riskRaised: number }) =>
    `${r.listed} ${landing.trackRecord.listed} · ${r.noToken} ${landing.trackRecord.noToken} · ${r.riskRaised} ${landing.trackRecord.riskRaised}.`,
  filtersLabel: "Filter",
  statusLegend: "Status",
  riskLegend: "Risiko",
  chainLabel: "Chain",
  allChains: "Semua chain",
  noMatches: (chain: string) => `${chain} (gak ada yang cocok)`,
  worthLabel: "Worth it",
  worthAll: "Worth it: semua",
  apply: "Terapkan filter",
  /** A multi-choice filter's button: nothing ticked, one ticked (its label), or how many. */
  filterSummary: (picked: string[]) => (picked.length === 0 ? "Semua" : picked.length === 1 ? picked[0]! : `${picked.length} dipilih`),
  clear: "Hapus filter",
  emptyPage: "Gak ada airdrop di halaman ini.",
  emptyFiltered: "Gak ada airdrop yang cocok sama filter ini.",
  emptyTab: "Belum ada airdrop yang lolos kurasi di tab ini.",
  chainUnknown: "Chain belum diketahui",
  noDeadline: "Belum ada deadline yang jelas",
  claimOpen: "Claim open · link dicek",
  /** The card's logo (owner request 2026-10-11): alt text, and the credit the unavatar.io free plan asks for. */
  logoAlt: (name: string) => `Logo ${name}`,
  logoCredit: "Logo: unavatar.io",
  /** Under the grid, once, when a card on the page has an X avatar logo: the followable unavatar.io link (free plan). */
  logoXPrefix: "Logo X dari ",
  logoXLink: "unavatar.io",
  /** Signal badges of a row (#41). Only a verified signal gets "✓"; AlphaDrops backers are what AlphaDrops reports. */
  signals: {
    vc: (investor: string) => `VC: ${investor} ✓`,
    reported: (investors: string) => `Menurut AlphaDrops: ${investors}`,
    lead: (investor: string) => `${investor} (lead)`,
    more: "…",
    tvl: (amount: string) => `TVL $${amount}`,
    coingecko: "Terdaftar di CoinGecko",
    curatedSource: "Sumber kurasi",
  },
  pagination: {
    label: "Halaman",
    previous: "Sebelumnya",
    next: "Berikutnya",
    pageOf: (page: number, last: number) => `Halaman ${page} dari ${last}`,
    range: (from: number, to: number, total: number) => `${from}-${to} dari ${total}`,
  },
  stale: {
    text: "Data mungkin udah gak update.",
    lastRun: (when: string) => `Update terakhir yang berhasil: ${when}.`,
    never: "Belum ada update yang berhasil.",
  },
};

/** The warning for a project that is not on the curated list (Plan 6 Task 6): the page banner and the watchlist label. */
export const notCurated = {
  banner: (reason: string) => `Gak masuk list: ${reason}`,
  /** No curation row at all: the pipeline has not run for the project yet. */
  unrated: "belum dinilai",
  /** A failed curation stored before the public reason existed. */
  noReason: "alasannya belum tercatat",
};

/** The project page (Plan 6 Task 5; mockup docs/design/airdropiq-c/CProject.dc.html). */
export const detail = {
  back: "← Balik ke list",
  chains: (chains: string[]) => `Chain: ${chains.join(", ")}`,
  chainUnknown: "Chain belum diketahui",
  /** The risk level in the page head (glossary "Risiko rendah"). */
  riskHead: (level: string) => `Risiko ${level.toLowerCase()}`,
  aiLabel: "Analisis AI",
  aiUnavailable: "Analisis AI belum tersedia",
  sections: {
    ai: "AI verdict",
    contradictions: "Sumber yang beda cerita",
    steps: "Step garap",
    safety: "Security check",
    effort: "Estimasi effort",
    why: "Kenapa lolos",
    /** Section 06 of a project that is not on the list (failed or never rated). */
    whyNot: "Kenapa gak lolos",
    summary: "Ringkasan",
    latestUpdate: "Update terbaru",
  },
  ai: {
    verdict: { garap: "Garap", pantau: "Pantau", skip: "Skip" } satisfies Record<AnalystVerdict, string>,
    confidence: (level: string) => `Confidence: ${level}`,
    points: "Poin analisis",
    noPoints: "Belum ada poin yang kutipannya cocok sama source, jadi verdict-nya kami tahan di Pantau.",
    source: "source",
  },
  contradictions: {
    empty: "Belum ada source yang beda cerita.",
    source: (n: number) => `source ${n}`,
    statusText: "Source-nya gak sepakat soal status airdrop ini. Anggap aja statusnya belum pasti.",
    statusQuotes: "Kutipan status yang beda",
  },
  steps: {
    empty: "Belum ada step.",
    cadence: { daily: "Daily", weekly: "Weekly", once: "Sekali" } satisfies Record<"daily" | "weekly" | "once", string>,
  },
  safety: {
    recheck: (time: string) => `Re-check tiap pagi · terakhir ${time} WIB`,
    stripLabel: "Ringkasan cek",
    strip: { layers: "Lapis cek", sources: "Source dibaca", links: "Link dicek", redFlags: "Red flag" },
    reasons: "Alasan risiko",
    noReasons: "Gak ada alasan risiko yang tercatat.",
    notAssessed: "Project ini belum dinilai.",
    scamFlags: "Temuan Analisis AI di teks source",
    mustPass: "Wajib lolos",
    mustPassNote: "Satu aja gagal jalan, project ini gak bakal tampil. Bukan dianggap lolos.",
    code: (n: number) => `Cek ${String(n).padStart(2, "0")}`,
    /** Where each check gets its answer (glossary #53). */
    sources: {
      dangerous_asks: "Scanner AirdropIQ",
      lookalike: "Database AirdropIQ",
      domain_age: "RDAP registry",
      phishing_list: "GoPlus Security",
      token_security: "GoPlus Security",
      contract_verified: "Blockscout",
      hack_history: "DefiLlama Hacks",
      corroboration: "Database AirdropIQ",
      ai_review: "Analisis AI",
    } satisfies Record<CheckId, string>,
    notRun: "Gak jalan",
    results: {
      dangerous_asks: { clean: "Gak ada", found: "Ketemu" },
      lookalike: { clean: "Gak ada yang mirip", found: "Ada yang mirip" },
      domain_age: { clean: "Gak ada domain baru", found: "Ada domain baru" },
      phishing_list: { clean: "Bersih", found: "Kedeteksi" },
    },
    details: {
      dangerous_asks: (sources: number) =>
        `Semua teks dari ${sources} source di-scan, termasuk tiap step garap. Kalimat peringatan kayak "never share your seed phrase" gak dihitung.`,
      lookalike: (compared: string) => `Link project ini dibandingin sama ${compared} domain official di database kami.`,
      domain_age: (date: string) =>
        `Terdaftar ${date}. Domain official di bawah 90 hari, atau link claim di bawah 30 hari, langsung bikin risiko naik.`,
      phishing_list: (checked: number) => `${checked} domain dan link dicocokin satu-satu ke database phishing.`,
    },
    age: { years: (n: number) => `${n} tahun`, months: (n: number) => `${n} bulan`, days: (n: number) => `${n} hari` },
    advanced: "Advanced check",
    advancedTitles: {
      token_security: "Risiko kontrak token",
      contract_verified: "Kontrak verified",
      hack_history: "Riwayat hack",
      corroboration: "Cross-check antar source",
      ai_review: "AI baca halaman claim",
    },
    advancedNotes: {
      token_security: "Kontrak token dicek: honeypot, pemilik yang bisa cetak token, pembuat yang ditandai.",
      contract_verified: "Source code kontrak token dicek udah diverifikasi atau belum.",
      hack_history: "Nama project dicocokin ke database exploit DeFi.",
      corroboration: "Status, deadline, dan link dibandingin antar source. Yang beda cerita kami tulis di bagian 02.",
      ai_review: 'Dicari: desakan waktu, "connect wallet buat cek eligibility", admin palsu, minta seed phrase secara halus.',
    },
    hacks: (count: number) => `${count} kasus`,
    sourceCount: (n: number) => `${n} source`,
    scam: { clean: "Gak ada pola scam", found: "Ada pola scam" },
    generic: { clean: "Gak ada temuan", found: "Ada temuan" },
    flaggedPublic: "Ada temuan. Lihat alasan risiko di atas.",
    links: "Link claim & app",
  },
  effort: {
    minutes: (n: number) => `±${n}`,
    minutesLabel: "menit / hari",
    capital: (amount: string) => `$${amount}+`,
    capitalLabel: "modal awal",
    free: "Gratis",
    unknown: "Belum jelas",
    sourcesLabel: "Kata source",
    rating: (source: string, value: string) => `${source}: ${value}`,
    ratingNames: { difficulty: "Kesulitan", cost: "Biaya", capital: "Modal" },
    capitalWords: { none: "gratis", low: "modal kecil", high: "modal besar" } as Record<string, string>,
  },
  why: {
    empty: "Belum ada sinyal yang tercatat.",
    verified: (source: string) => `Verified · ${source}`,
    sources: { vc: "portfolio VC", tvl: "DefiLlama", coingecko: "CoinGecko" },
    reportedLabel: "Laporan AlphaDrops, belum verified",
    claimedLabel: "Klaim project, belum verified",
    claimQuote: (quote: string) => `"${quote}"`,
    curatedSourceNames: {
      airdrops_io: "airdrops.io",
      telegram: "Telegram",
      alphadrops: "AlphaDrops",
      defillama: "DefiLlama",
    } as Record<string, string>,
    notes: "Catatan penilaian kami",
  },
  summary: {
    deadline: (kind: string, date: string, precision: string) => `${kind}: ${date} (${precision})`,
    dateUnknown: "tanggal belum diketahui",
    keyParameters: { allocation: "Alokasi", distribution: "Distribusi", tge: "TGE" } as Record<string, string>,
    keyParameter: (name: string, value: string) => `${name}: ${value}`,
  },
  latestUpdate: {
    empty: "Belum ada update dari source.",
    source: "source",
  },
  officialChecker: "Checker official (belum verified)",
  watch: "Tambah ke watchlist",
  unwatch: "Hapus dari watchlist",
  loginToWatch: "Login buat pakai watchlist",
};

export const walletActivity = {
  heading: "Aktivitas wallet",
  chainNotSupported: "Chain ini belum didukung.",
  addWallet: "Tambah wallet buat cek aktivitas wallet",
  check: (chain: string) => `Cek aktivitas wallet di ${chain}`,
  checkFor: (chain: string, wallet: string) => `Cek aktivitas wallet di ${chain} untuk ${wallet}`,
  checking: "Lagi dicek…",
  summary: (s: { chain: string; txCount: number; first: string | null; last: string | null; months: string }) =>
    `Aktivitas wallet di ${s.chain}: ${s.txCount} transaksi` +
    (s.first ? `, pertama ${s.first}` : "") +
    (s.last ? `, terakhir ${s.last}` : "") +
    `, aktif ${s.months} bulan`,
  cached: " (dicek dalam 6 jam terakhir)",
  none: (chain: string) => `Gak ada aktivitas di ${chain}`,
  rateLimited: "Kamu udah cek 10 kali dalam sejam. Coba lagi nanti.",
  notOwner: "Wallet itu gak ada di list kamu.",
  signedOut: "Login dulu buat cek aktivitas wallet.",
  unavailable: "Data lagi gak tersedia. Coba lagi nanti.",
};

export const wallets = {
  title: "Wallet",
  heading: "Wallet kamu",
  address: "Alamat wallet",
  label: "Label (opsional)",
  add: "Tambah wallet",
  empty: "Kamu belum nambahin wallet.",
  confirmQuestion: "Hapus wallet ini?",
  confirmDelete: "Ya, hapus",
  cancel: "Batal",
  delete: "Hapus",
  deleteLabel: (wallet: string) => `Hapus wallet ${wallet}`,
  errors: {
    invalidAddress: "Itu bukan alamat EVM yang valid (0x + 40 karakter hex).",
    duplicate: "Wallet ini udah kamu tambahin.",
    limitReached: (max: number) => `Kamu cuma bisa nambahin sampai ${max} wallet.`,
    labelTooLong: (max: number) => `Label maksimal ${max} karakter.`,
  },
};

/** "Perubahan sejak kunjungan terakhir" on /airdrops and the watchlist (Plan 6 Task 7). */
export const changes = {
  heading: "Perubahan sejak kunjungan terakhir",
  /** Accessible name of the list of changes; the near deadlines are their own group. */
  changesLabel: "Perubahan",
  deadlinesHeading: "Deadline dekat",
  markSeen: "Tandai sudah dibaca",
  markSeenPending: "Lagi ditandai...",
  curatedIn: "Masuk list",
  curatedOut: "Keluar dari list",
  /** A run that brought many projects into the list for the first time, as one line. */
  curatedInMany: (n: number) => `${n} project masuk list`,
  ended: "Udah ended",
  status: (from: string, to: string) => `Status berubah: ${from} → ${to}`,
  risk: (from: string, to: string) => `Risiko berubah: ${from} → ${to}`,
  deadline: (kind: string, date: string) => `Deadline ${kind} dalam 48 jam (${date})`,
  approximateDate: (date: string) => `sekitar ${date}`,
};

/** "Briefing pagi" above the list (coach and briefing spec §5.6): member only. */
export const briefing = {
  heading: (date: string) => `Briefing pagi · ${date}`,
  collapse: "Ciutkan briefing",
  expand: "Buka briefing",
  /** Accessible names of the three lists. */
  itemsLabel: "Poin briefing",
  changesLabel: "Perubahan di watchlist kamu",
  garapanLabel: "Deadline garapan terdekat",
  /** A garapan deadline line after the project name: kind and date, e.g. "Claim 14 Okt 2026". */
  deadline: (kind: string, date: string) => `${kind} ${date}`,
  approximateDate: (date: string) => `sekitar ${date}`,
};

export const watchlist = {
  title: "Watchlist",
  heading: "Watchlist kamu",
  empty: "Watchlist kamu masih kosong. Buka sebuah airdrop, lalu klik Tambah ke watchlist.",
};

export const settings = {
  title: "Akun",
  heading: "Akun",
  timezone: "Zona waktu",
  save: "Simpan pengaturan",
  saved: "Pengaturan disimpan.",
  deleteHeading: "Hapus akun",
  deleteText:
    "Akun kamu dihapus permanen, bareng semua yang terkait: profil, zona waktu, watchlist, garapan, wallet yang kamu simpan, dan hasil cek aktivitas wallet-nya. Ini gak bisa dibatalkan.",
  confirmLabel: (word: string) => `Ketik ${word} buat konfirmasi`,
  confirmError: (word: string) => `Ketiknya harus persis ${word}, huruf besar semua.`,
  deleteButton: "Hapus akun saya",
  errors: {
    invalidTimezone: "Zona waktu gak dikenal.",
  },
};

export const garapan = {
  title: "Garapan saya",
  heading: "Garapan saya",
  projects: "project digarap",
  dailyToday: "daily task hari ini",
  empty: "Kamu belum menggarap project apa pun. Buka sebuah airdrop dan klik Mulai garap.",
  legendLabel: "Arti warna heatmap",
  legend: {
    none: "gak ada daily task",
    zero: "0%",
    low: "1–49%",
    high: "50–99%",
    full: "100%",
    upcoming: "belum lewat",
  },
  start: "Mulai garap",
  stop: "Berhenti garap",
  open: "Buka Garapan saya",
  endKind: { snapshot: "snapshot", campaign_end: "akhir campaign", ended: "ended" },
  endedOn: (day: string) => `Ended ${day}`,
  daysLeft: (days: number, end: string) => `Sisa ${days} hari sampai ${end}`,
  range: (start: string, end: string) => `${start} sampai ${end}`,
  rangeWithEnd: (span: string, end: string) => `${span} (${end})`,
  archive: "Arsipkan",
  archiveLabel: (task: string) => `Arsipkan task: ${task}`,
  mainTasks: "Task utama",
  mainProgress: (done: number, total: number) => `${done}/${total} selesai`,
  today: "Hari ini",
  todayProgress: (done: number, total: number) => `${done} dari ${total} task hari ini`,
  noDaily: "Belum ada daily task. Tambah task sendiri.",
  weekly: "Weekly",
  weeklyDone: "Minggu ini udah",
  weeklyOpen: "Belum minggu ini",
  addSummary: "+ Tambah task sendiri",
  taskLabel: "Task",
  cadenceLabel: "Seberapa sering",
  cadence: { daily: "Daily", weekly: "Weekly", once: "Sekali" },
  addButton: "Tambah task",
  refresh: "Ambil ulang step dari source",
  endedStamp: "ENDED",
  streak: (days: number) => `Streak: ${days} hari`,
  endedNote: "Campaign udah ended. Checklist dikunci, riwayat garapanmu tetap tersimpan di sini.",
  progress: "Progres",
  progressLabel: (name: string) => `Progres ${name}`,
  /** Heatmap row labels, Monday to Sunday; every other row is blank like the mockup. */
  dayLabels: ["Sen", "", "Rab", "", "Jum", "", "Min"],
  cellUpcoming: (day: string) => `${day}: belum lewat`,
  cellDone: (day: string, done: number, total: number) => `${day}: ${done}/${total} daily task`,
  errors: {
    project_limit: "Kamu udah garap 50 project. Berhentiin salah satu dulu sebelum mulai yang baru.",
    task_limit: "Satu project maksimal 30 task aktif. Arsipkan task yang udah gak kamu pakai dulu.",
    invalid_task: "Teks task wajib diisi, maksimal 200 karakter.",
    not_farming: "Kamu lagi gak garap project ini.",
    task_inactive: "Task itu udah diarsipkan, atau project-nya udah berhenti kamu garap. Checklist di bawah udah yang terbaru.",
    invalid_timezone:
      "Zona waktu di akun kamu gak dikenal, jadi hari ini gak bisa dihitung. Ganti zona waktunya di halaman Akun, terus centang lagi.",
    result_not_ended: "Hasil baru bisa diisi setelah project-nya ended.",
    invalid_amount: "Jumlah token harus angka di atas 0. Desimal pakai titik atau koma, tanpa pemisah ribuan.",
    ambiguous_amount:
      "Angka itu bisa dibaca dua cara. Tulis jumlah token tanpa pemisah ribuan, misalnya 1250. Titik atau koma cuma buat desimal, misalnya 1.25.",
    invalid_claim_date: "Tanggal claim wajib diisi, dan gak boleh lewat dari hari ini.",
  },
  nextDeadline: (kind: string, date: string, precision: string) => `Deadline terdekat: ${kind} ${date} (${precision})`,
  totalResults: "Total hasil garapan",
  usd: (value: string) => `≈ $${value}`,
  result: {
    askTitle: "Dapet berapa dari airdrop ini?",
    askNote: "Isi sendiri ya. Nilai dolarnya kami hitung dari harga di tanggal claim.",
    amountLabel: "Jumlah token",
    amountPlaceholder: "contoh: 1250",
    dateLabel: "Tanggal claim",
    save: "Simpan",
    noReward: "Gak dapet",
    title: "Hasil kamu",
    edit: "Ubah",
    amount: (amount: string, symbol: string | null) => `${amount} ${symbol ?? "token"}`,
    valueAtClaim: (usd: string, day: string) => `≈ $${usd} waktu claim (${day})`,
    valueNow: (usd: string) => `sekarang ≈ $${usd}`,
    priceMissing: "Harga belum ketemu, jumlah token tetap tersimpan.",
    share: "Boleh dipakai anonim buat rata-rata hasil member",
    average: (project: string, usd: string, members: number) =>
      `Rata-rata member yang garap ${project}: ≈ $${usd} (dari ${members} member yang mau berbagi)`,
  },
  /** Attribution the CoinGecko Demo plan requires, shown wherever a USD value from prices is shown. */
  priceSource: {
    label: "Data harga:",
    coingecko: "CoinGecko",
    coingeckoUrl: "https://www.coingecko.com",
    defillama: "DefiLlama",
    defillamaUrl: "https://defillama.com",
  },
};

/** Coach: texts of the plan and chat routes (spec §5.7) and of the /coach page (spec §5.1 to §5.5). */
export const coach = {
  errors: {
    quota: "Jatah 100 pesan hari ini habis, reset jam 00.00 WIB.",
    unavailable: "Coach lagi gak bisa jawab, coba lagi sebentar.",
    bad_input: "Isiannya belum lengkap, atau pesannya kepanjangan (maksimal 1000 karakter). Cek lagi, lalu coba lagi.",
    not_member: "Percakapan ini gak ketemu di akun kamu. Login lagi, atau mulai percakapan baru dari halaman AI Coach.",
    secret: "Jangan pernah kirim seed phrase atau private key ke siapa pun, termasuk ke Coach. Pesan ini gak dikirim.",
  },
  empty: {
    noCandidates:
      "Belum ada project yang cocok sama profil kamu sekarang. Coba ubah modal atau level di profil, atau cek lagi besok. Pesan ini gak memotong jatah kamu.",
    noPlan: "Coach belum bisa bikin rencana, coba lagi.",
    /** Tanya AI about a project that is no longer on the list (the profile never filters that chat). */
    projectGone: "Coach belum punya cukup data soal project ini (belum lolos check, atau belum ada poin dan langkah dari analisis), jadi belum bisa bahas. Coba lagi besok. Pesan ini gak memotong jatah kamu.",
  },
  /** Stored as the member's message of a plan request (it shows in the history). */
  planRequest: "Bikinin rencana garapan buat aku.",
  title: "AI Coach",
  heading: "AI Coach",
  /** What a visitor sees on /coach (owner 2026-10-11): the menu is there for everyone, the Coach is for members. */
  visitor: {
    stampTop: "KHUSUS",
    stampBottom: "MEMBER",
    text: "AI Coach bantu kamu milih airdrop yang cocok sama modal, jumlah wallet, dan waktu kamu, terus jelasin tiap langkahnya. Fitur ini khusus member.",
  },
  intro:
    "Jawab beberapa pertanyaan, nanti Coach pilihin airdrop dari list yang udah lolos check, sesuai modal dan waktu kamu.",
  /** The member's own message when they ask the Coach to explain a step on a project page. */
  explainRequest: "Jelasin langkah ini dong.",
  form: {
    privacy: "Kami gak minta email, alamat wallet, atau saldo kamu.",
    /** The empty first option of every dropdown. */
    choose: "Pilih...",
    level: { legend: "Level kamu", beginner: "Pemula", intermediate: "Menengah", pro: "Pro" },
    capital: {
      legend: "Modal yang siap dipakai",
      free: "Gratis aja ($0)",
      gas_only: "Buat gas aja (< $10)",
      up_to_100: "$10 sampai 100",
      up_to_1000: "$100 sampai 1.000",
      over_1000: "> $1.000",
      /** Under the capital field, for a Pemula (spec §5.1, verbatim). */
      beginnerHint: "Banyak airdrop bisa digarap tanpa modal. Pilih 'Gratis aja' kalau belum mau keluar uang sama sekali.",
    },
    wallet: { legend: "Udah punya wallet?", yes: "Udah", no: "Belum", count: "Jumlah wallet" },
    minutes: { legend: "Waktu per hari", 15: "15 menit", 30: "30 menit", 60: "60 menit", 120: "120+ menit" },
    goal: { legend: "Tujuan", quick: "Cuan cepat", long_term: "Jangka panjang", learn: "Belajar dulu" },
    chains: { legend: "Chain favorit (boleh kosong)" },
    submit: "Simpan dan bikin rencana",
    errors: {
      level: "Pilih level kamu.",
      capital: "Pilih modal yang siap kamu pakai.",
      wallet: "Pilih udah atau belum punya wallet.",
      walletCount: "Isi jumlah wallet, 1 sampai 10.",
      minutes: "Pilih waktu per hari.",
      goal: "Pilih tujuan kamu.",
      save: "Profil belum tersimpan. Cek isiannya, lalu coba lagi.",
    },
  },
  profile: {
    title: "Profil kamu",
    edit: "Ubah profil",
    makePlan: "Bikin rencana baru",
    makePlanNote: "Ini dihitung 1 dari 100 pesan hari ini.",
    planning: "Coach lagi nyusun rencana...",
  },
  plan: {
    title: "Rencana garapan kamu",
    /** Fixed text above the plan of a Pemula; the model's plan never carries it. */
    securityTitle: "Pengingat keamanan",
    security:
      "Seed phrase dan private key gak pernah dibagi ke siapa pun, termasuk yang ngaku admin atau support. Connect wallet cuma di situs resmi. Transaksi yang kamu gak ngerti, jangan disetujui.",
    minutes: (n: number) => `Estimasi ${n} menit per hari`,
    reasons: "Kenapa cocok",
    freeNote: "Gratis, tapi mungkin tetap butuh sedikit gas kalau di mainnet.",
    freeNoteKey: "mungkin tetap butuh sedikit gas kalau di mainnet",
    started: "Udah masuk Garapan saya.",
    openGarapan: "Buka Garapan saya",
  },
  chat: {
    title: "Tanya AI",
    remaining: (left: number) => `Sisa ${left}/100 pesan hari ini`,
    disclaimer: "Bukan nasihat keuangan. Tetap DYOR.",
    label: "Pertanyaan kamu",
    send: "Kirim",
    sending: "AI Coach lagi nulis...",
    you: "Kamu",
    coach: "AI Coach",
  },
  project: {
    title: (name: string) => `Tanya AI soal ${name}`,
    intro: "Coach cuma bahas project ini, berdasarkan data yang udah lolos check.",
    endedReason: "udah ended",
    notListedNote: "Karena itu Coach gak nyaranin buat digarap, dan rencana garapan gak dibikin.",
    notFound: "Project ini gak ketemu.",
    open: "Lihat halaman project",
    askAi: "Tanya AI",
  },
  explain: {
    button: "Jelasin langkah ini",
    loading: "Coach lagi nulis...",
    needProfile: "Langkah ini belum bisa dijelasin. Biasanya karena profil kamu belum diisi, jadi lengkapi dulu di halaman AI Coach.",
    toCoach: "Buka AI Coach",
  },
  threads: {
    title: "Riwayat 30 hari terakhir",
    empty: "Belum ada percakapan.",
    plan: "Rencana garapan",
    chat: "Percakapan",
    project: (name: string) => `Tanya AI: ${name}`,
    open: "Buka",
    remove: "Hapus",
    removeLabel: (label: string) => `Hapus ${label}`,
  },
};

export const landing = {
  deleted: "Akun kamu udah dihapus.",
  heroTitle: "Airdrop yang worth it digarap, udah kami cek duluan.",
  heroLead:
    "Kami udah terlalu sering lihat orang kena link claim palsu di grup Telegram. Makanya aturannya simpel. Airdrop yang gak lolos 4 security check gak bakal tampil di sini, se-hype apa pun.",
  seeAirdrops: "Lihat airdrop",
  why: "Kenapa AirdropIQ",
  recheckBadge: "Re-check tiap pagi, 06.00 WIB",
  whyTitle: "Tiap hari semua airdrop kami cek ulang dari nol.",
  stampTop: "LOLOS",
  stampBottom: "4/4 CEK",
  stampNote: "ATAU GAK TAMPIL",
  whyBody: [
    "Jujur aja, kebanyakan web airdrop cuma copas announcement. Kami gak. Source-nya kami baca sendiri, link claim-nya kami cek, baru setelah itu airdrop-nya boleh masuk list.",
    "Badge verified cuma kami pasang kalau datanya cocok. Project ngaku di-backing VC gede tapi buktinya gak ada? Kami tulis apa adanya: masih klaim.",
  ],
  copyright: "© 2026 AirdropIQ",
  footer: "Not financial advice. Tetap DYOR sebelum connect wallet.",
  today: {
    title: "Update hari ini",
    time: "06.00 WIB",
    checked: "airdrop dicek",
    passed: "lolos",
    shownWithoutPass: "Tampil tanpa lolos check: ",
  },
  trackRecord: {
    title: "Track record kami",
    body: 'Gampang ngomong "airdrop pilihan". Buktiin hasilnya yang susah. Jadi tiap airdrop yang kami loloskan sebelum TGE, kami catat ending-nya gimana. Angkanya baru muncul setelah minimal 10 airdrop selesai, soalnya dua tiga contoh belum bisa disebut bukti.',
    listed: "Token listing",
    noToken: "Ended tanpa token",
    riskRaised: "Belakangan jadi risky",
    /** Not "... udah ended" alone: the population also holds projects that turned risky before ending, so listed and
     * noToken need not add up to total (spec 15.3, G4 revision). */
    note: (total: number) =>
      `Dari ${total} airdrop yang lolos sebelum token listing dan sekarang udah ended atau belakangan jadi risky.`,
  },
  compare: {
    title: "Apa bedanya gratis sama member?",
    feature: "Fitur",
    free: "Gratis",
    member: "Member",
    included: "Ada",
    notIncluded: "Gak ada",
    /** A member feature that is not there yet (owner, 2026-10-11): the tag by its title and its member cell. */
    soon: "Segera",
    rows: [
      { title: "List airdrop yang lolos check", note: "Yang live sekarang, early, dan yang udah ended.", free: true },
      { title: "Security check", note: "4 check utama, plus warning kalau ada pola scam.", free: true },
      { title: "Status link claim", note: "Official, beda domain, atau di-hide karena phishing.", free: true },
      { title: "Sumber yang beda cerita", note: "Kalau dua source gak sinkron, kamu lihat dua-duanya.", free: true },
      { title: "Step garap", note: "Step-by-step, udah dalam Bahasa Indonesia.", free: true },
      { title: "Track record", note: "Ending dari airdrop yang pernah kami loloskan.", free: true },
      { title: "Level worth it", note: "Sepadan gak sama effort-nya, plus urutan dari yang paling worth it.", free: false },
      { title: "AI verdict", note: "Garap, pantau, atau skip. Tiap alasan ada kutipan source-nya.", free: false },
      { title: "Estimasi effort", note: "Berapa menit per hari, modal, dan gas fee.", free: false },
      { title: "Morning briefing", note: "Airdrop baru dan update penting, dirangkum sebelum kamu buka grup.", free: false },
      { title: "AI Coach", note: "Tanya mau garap yang mana dulu, sesuai modal dan jumlah wallet kamu.", free: false },
      { title: "Farming tracker & watchlist", note: "Daily checklist, heatmap, dan update kalau ada yang berubah.", free: false },
    ],
  },
};

/** Strings of the design C primitives in components/ui. */
export const ui = {
  linkStatus: {
    official: "✓ Official domain",
    differentDomain: "⚠ Beda domain dari web official",
    unchecked: "Belum dicek",
    phishingHidden: "Link di-hide: kedeteksi phishing",
    phishingWarning: "Kalau link ini nongol di grup atau DM, jangan dibuka.",
  },
  memberOnly: "Member only",
  worth: {
    high: "Sangat worth it",
    medium: "Worth it",
    low: "Kurang worth it",
    insufficient_data: "Data belum cukup",
  } satisfies Record<WorthLevel, string>,
  tabBarLabel: "Tab daftar",
};
