import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { getUser } from "@/lib/auth";
import { header } from "@/lib/copy";
import { LIST_PATH } from "@/lib/routes";
import { Button, HazardBar } from "@/components/ui";

/**
 * Design C header: hazard strip, "IQ" mark with the product name, capital-letter nav. A visitor gets the public
 * links and a black Login button; account links only exist for a signed-in user. There is no signup link (#46).
 * On a phone: the logo and Login/Logout on one row, every menu link below in a grid, nothing to swipe.
 */
export async function SiteHeader() {
  const user = await getUser();
  return (
    <>
      <HazardBar />
      <header className="site-header">
        <div className="brand-wrap">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              {header.brandMark}
            </span>
            <span className="brand-name">{header.brand}</span>
          </Link>
          <span className="brand-beta">{header.beta}</span>
        </div>
        {user ? (
          <nav className="site-nav site-nav-member" aria-label={header.navLabel}>
            <Link href={LIST_PATH}>{header.airdrops}</Link>
            <Link href="/garapan">{header.garapan}</Link>
            <Link href="/coach">{header.coach}</Link>
            <Link href="/watchlist">{header.watchlist}</Link>
            <Link href="/wallets">{header.wallets}</Link>
            <Link href="/settings">{header.account}</Link>
          </nav>
        ) : (
          <nav className="site-nav site-nav-visitor" aria-label={header.navLabel}>
            <Link href={LIST_PATH}>{header.airdrops}</Link>
            <Link href="/coach">{header.coach}</Link>
            <Link href="/#cara">{header.why}</Link>
            <Link href="/#jejak">{header.trackRecord}</Link>
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
                  {header.logout}
                </Button>
              </form>
            </>
          ) : (
            <Button variant="dark" href="/login">
              {header.login}
            </Button>
          )}
        </div>
      </header>
    </>
  );
}
