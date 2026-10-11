// Glossary of crypto terms the Coach explains (coach and briefing spec §8). The texts follow the writing style
// (no em dash, no banned word); the Coach prompt carries them as a shared cached block.

/** One glossary row: the term and its plain Indonesian explanation. */
export interface GlossaryEntry {
  term: string;
  text: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: "Wallet", text: "Dompet crypto. Tempat aset kamu disimpan, dan \"kunci\" untuk masuk ke aplikasi crypto." },
  { term: "Seed phrase", text: "12 atau 24 kata kunci utama wallet. Siapa pun yang tahu kata-kata ini bisa mengambil semua isi wallet. Jangan pernah dibagi ke siapa pun, termasuk admin atau \"support\"." },
  { term: "Private key", text: "Kunci rahasia wallet, sama bahayanya dengan seed phrase kalau bocor." },
  { term: "Gas fee", text: "Biaya kecil untuk menjalankan transaksi di blockchain. Dibayar pakai koin jaringannya, misalnya ETH di Ethereum." },
  { term: "Mainnet", text: "Jaringan asli. Transaksi di sini pakai uang beneran." },
  { term: "Testnet", text: "Jaringan uji coba. Koinnya gratis dan gak punya nilai, cocok buat latihan." },
  { term: "Bridge", text: "Memindahkan aset dari satu jaringan ke jaringan lain. Pakai cuma link bridge resmi." },
  { term: "Swap", text: "Menukar satu token dengan token lain." },
  { term: "Points", text: "Poin dari project untuk aktivitas kamu. Sering jadi dasar pembagian airdrop, tapi gak ada jaminan nilainya." },
  { term: "TGE", text: "Token Generation Event, saat token project pertama kali dirilis." },
  { term: "Claim", text: "Mengambil jatah airdrop. Cuma lewat link claim yang statusnya official di AirdropIQ." },
  { term: "Snapshot", text: "Saat project mencatat siapa saja yang memenuhi syarat. Aktivitas setelah snapshot biasanya gak dihitung." },
  { term: "Sybil", text: "Satu orang pakai banyak wallet untuk pura-pura jadi banyak orang. Project sering mencoret wallet seperti ini dari airdrop." },
  { term: "Testnet faucet", text: "Situs resmi yang membagi koin testnet gratis untuk latihan." },
  { term: "Phishing", text: "Situs atau pesan palsu yang meniru project asli untuk mencuri isi wallet. Cek domain sebelum connect wallet." },
  { term: "Connect wallet", text: "Menghubungkan wallet ke aplikasi. Lakukan cuma di situs resmi, dan jangan pernah menyetujui transaksi yang gak kamu mengerti." },
];
