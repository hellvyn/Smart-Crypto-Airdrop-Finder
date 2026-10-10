import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { getUser } from "@/lib/auth";

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        Smart Airdrop Finder
      </Link>
      <nav>
        {user ? (
          <>
            <Link href="/watchlist">Watchlist</Link>
            <Link href="/wallets">Wallets</Link>
            <Link href="/settings">Settings</Link>
            <span data-testid="user-email" className="user-email">
              {user.email}
            </span>
            <form action={signOut}>
              <button type="submit">Sign out</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}
