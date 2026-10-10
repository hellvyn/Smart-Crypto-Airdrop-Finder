import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { getUser } from "@/lib/auth";
import { LIST_PATH } from "@/lib/routes";
import { Button, HazardBar } from "@/components/ui";

/**
 * Design C header: hazard strip, "IQ" mark with the product name, capital-letter nav. A visitor gets the public
 * links and a black Login button; account links only exist for a signed-in user. There is no signup link (#46).
 */
export async function SiteHeader() {
  const user = await getUser();
  return (
    <>
      <HazardBar />
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            IQ
          </span>
          <span className="brand-name">AirdropIQ</span>
        </Link>
        {user ? (
          <nav className="site-nav site-nav-member" aria-label="Menu utama">
            <Link href={LIST_PATH}>Airdrop</Link>
            <Link href="/garapan">Garapan saya</Link>
            <Link href="/watchlist">Watchlist</Link>
            <Link href="/wallets">Wallets</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        ) : (
          <nav className="site-nav site-nav-visitor" aria-label="Menu utama">
            <Link href={LIST_PATH}>Airdrop</Link>
            <Link href="/#cara">Kenapa AirdropIQ</Link>
            <Link href="/#jejak">Track record</Link>
          </nav>
        )}
        <div className="site-actions">
          {user ? (
            <>
              <span data-testid="user-email" className="user-email">
                {user.email}
              </span>
              <form action={signOut}>
                <Button variant="secondary" type="submit">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button variant="dark" href="/login">
              Login
            </Button>
          )}
        </div>
      </header>
    </>
  );
}
