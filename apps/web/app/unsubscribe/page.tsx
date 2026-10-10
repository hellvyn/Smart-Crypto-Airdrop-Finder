import type { Metadata } from "next";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";
import { submitUnsubscribe } from "./actions";

// The URL carries a secret token: keep it out of search indexes.
export const metadata: Metadata = {
  title: "Unsubscribe · Smart Airdrop Finder",
  robots: { index: false, follow: false },
};

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * One-click unsubscribe from the digest email. Email clients and link scanners open links with GET, so this page
 * never changes anything on GET (and never looks the token up, so it does not reveal whether a token exists): it
 * only shows a button that POSTs the token to the server action. The token appears nowhere but the hidden field.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; done?: string | string[] }>;
}) {
  const params = await searchParams;

  if (first(params.done) === "1") {
    const user = await getUser();
    return (
      <>
        <h1>Unsubscribe</h1>
        <p role="status" className="form-message">
          You are unsubscribed.
        </p>
        {user ? (
          <p>
            <Link href="/settings">Turn it back on in Settings</Link>
          </p>
        ) : null}
      </>
    );
  }

  const token = first(params.token);
  if (!isUuid(token)) {
    return (
      <>
        <h1>Unsubscribe</h1>
        <p role="alert" className="form-error">
          This link is invalid or already used.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Unsubscribe</h1>
      <p>Stop receiving the daily airdrop digest email.</p>
      <form action={submitUnsubscribe} className="auth-form">
        <input type="hidden" name="token" value={token} />
        <button type="submit">Unsubscribe from daily digest</button>
      </form>
    </>
  );
}
