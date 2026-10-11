import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { pageTitle, wallets as copy } from "@/lib/copy";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import { isAddWalletError, listWallets, MAX_LABEL_LENGTH, shortAddress, WALLET_ERROR_MESSAGES } from "@/lib/wallets";
import { submitAddWallet, submitDeleteWallet } from "./actions";

export const metadata = { title: pageTitle(copy.title) };

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; confirm?: string | string[] }>;
}) {
  await requireUser();
  const params = await searchParams;
  const error = first(params.error);
  const confirm = first(params.confirm);
  const db = await createServerClient();
  const wallets = await listWallets(db);
  return (
    <>
      <h1>{copy.heading}</h1>
      <form action={submitAddWallet} className="auth-form">
        <label>
          {copy.address}
          <input type="text" name="address" placeholder="0x…" autoComplete="off" spellCheck={false} required />
        </label>
        <label>
          {copy.label}
          <input type="text" name="label" maxLength={MAX_LABEL_LENGTH} autoComplete="off" />
        </label>
        {isAddWalletError(error) ? (
          <p role="alert" className="form-error">
            {WALLET_ERROR_MESSAGES[error]}
          </p>
        ) : null}
        <button type="submit">{copy.add}</button>
      </form>
      {wallets.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ul className="wallet-list">
          {wallets.map((w) => (
            <li key={w.id} data-testid="wallet-row" data-address={w.address}>
              <code title={w.address}>{shortAddress(w.address)}</code>
              {w.label ? <span className="muted"> {w.label}</span> : null}{" "}
              {isUuid(confirm) && confirm.toLowerCase() === w.id ? (
                <form action={submitDeleteWallet} className="inline-form">
                  <input type="hidden" name="id" value={w.id} />
                  <span>{copy.confirmQuestion}</span>
                  <button type="submit" data-tone="danger">
                    {copy.confirmDelete}
                  </button>
                  <Link href="/wallets">{copy.cancel}</Link>
                </form>
              ) : (
                <Link className="danger-link" href={`/wallets?confirm=${w.id}`} aria-label={copy.deleteLabel(shortAddress(w.address))}>
                  {copy.delete}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
