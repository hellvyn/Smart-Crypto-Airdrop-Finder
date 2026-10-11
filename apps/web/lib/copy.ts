// Every user-facing string of the web app, grouped by page or area. Wording follows the Plan 6 glossary first and the
// design C mockups (docs/design/airdropiq-c) second. Style rules: "kamu" tone, no em dash, straight quotes, and none of
// the banned words; test/copy-style.test.ts checks every string literal in this file.
// Pure module (no I/O, no server-only imports, type-only imports), so client components can use it too.
import type { CheckId, DatePrecision, DeadlineKind, RiskLevel, Severity, Status } from "@saf/core";

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
  brandMark: "IQ",
  airdrops: "Airdrop",
  why: "Kenapa AirdropIQ",
  trackRecord: "Track record",
  garapan: "Garapan saya",
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

/** The current /airdrops list (Plan 6 Task 4 replaces it with the curated tabs). */
export const list = {
  title: "Daftar airdrop",
  heading: "Daftar airdrop",
  meta: (lastRun: string | null, total: number) =>
    `Update terakhir: ${lastRun ?? "belum ada"}. ${total} airdrop. Urutannya dari deadline terdekat, lalu yang paling baru kami lihat.`,
  filtersLabel: "Filter",
  statusLegend: "Status",
  riskLegend: "Risiko",
  chainLabel: "Chain",
  allChains: "Semua chain",
  noMatches: (chain: string) => `${chain} (gak ada yang cocok)`,
  apply: "Terapkan filter",
  clear: "Hapus filter",
  emptyPage: "Gak ada airdrop di halaman ini.",
  emptyFiltered: "Gak ada airdrop yang cocok sama filter ini.",
  empty: "Belum ada airdrop.",
  chainUnknown: "Chain belum diketahui",
  noDeadline: "Belum ada deadline yang jelas",
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

/** The current project page (Plan 6 Task 5 rebuilds it). */
export const detail = {
  back: "← Balik ke list",
  chains: (chains: string[]) => `Chain: ${chains.join(", ")}`,
  chainUnknown: "Chain belum diketahui",
  riskHeading: "Risiko",
  riskReasons: "Alasan risiko",
  noReasons: "Gak ada alasan risiko yang tercatat.",
  assessed: (day: string) => `Dinilai ${day}`,
  notAssessed: "Project ini belum dinilai.",
  conflictHeading: "Sumber yang beda cerita",
  conflictText: "Source-nya gak sepakat soal status airdrop ini. Anggap aja statusnya belum pasti.",
  conflictQuotes: "Kutipan status yang beda",
  deadlinesHeading: "Deadline",
  dateUnknown: "tanggal belum diketahui",
  noDeadlines: "Belum ada deadline.",
  tasksHeading: "Step garap",
  noTasks: "Belum ada step.",
  linksHeading: "Link",
  noLinks: "Gak ada link lain.",
  evidenceHeading: "Bukti",
  seeConflict: "Lihat kutipan yang beda cerita di atas.",
  noEvidence: "Belum ada bukti yang tercatat.",
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
    note: (total: number) => `Dari ${total} airdrop yang lolos sebelum token listing dan sekarang udah ended.`,
  },
  compare: {
    title: "Apa bedanya gratis sama member?",
    feature: "Fitur",
    free: "Gratis",
    member: "Member",
    included: "Ada",
    notIncluded: "Gak ada",
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
      { title: "Farming Coach", note: "Tanya mau garap yang mana dulu, sesuai modal dan jumlah wallet kamu.", free: false },
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
  },
  tabBarLabel: "Tab daftar",
};
