import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <h1>Smart Airdrop Finder</h1>
      <p>Airdrops with their status, risk level and wallet activity, in one place.</p>
      <p>
        <Link href="/watchlist">Go to your watchlist</Link>
      </p>
    </>
  );
}
