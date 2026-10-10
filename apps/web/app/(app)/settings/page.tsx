import { requireUser } from "@/lib/auth";
import {
  CONFIRMATION_ERROR_MESSAGE,
  DELETE_CONFIRMATION,
  getSettings,
  isPasswordError,
  isSettingsError,
  PASSWORD_ERROR_MESSAGES,
  SETTINGS_ERROR_MESSAGES,
  timezoneOptions,
} from "@/lib/settings";
import { createServerClient } from "@/lib/supabase/server";
import { submitChangePassword, submitDeleteAccount, submitUpdateSettings } from "./actions";

export const metadata = { title: "Settings · Smart Airdrop Finder" };

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; password?: string | string[]; error?: string | string[] }>;
}) {
  await requireUser();
  const params = await searchParams;
  const error = first(params.error);
  const db = await createServerClient();
  const settings = await getSettings(db);
  return (
    <>
      <h1>Settings</h1>
      <form action={submitUpdateSettings} className="auth-form">
        <label>
          Time zone
          <select name="timezone" defaultValue={settings.timezone}>
            {timezoneOptions(settings.timezone).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        {isSettingsError(error) ? (
          <p role="alert" className="form-error">
            {SETTINGS_ERROR_MESSAGES[error]}
          </p>
        ) : null}
        {first(params.saved) === "1" ? (
          <p role="status" className="form-message">
            Settings saved.
          </p>
        ) : null}
        <button type="submit">Save settings</button>
      </form>

      <section aria-labelledby="change-password">
        <h2 id="change-password">Ganti password</h2>
        <form action={submitChangePassword} className="auth-form">
          <label>
            Password sekarang
            <input type="password" name="currentPassword" autoComplete="current-password" required />
          </label>
          <label>
            Password baru
            <input type="password" name="newPassword" autoComplete="new-password" required />
          </label>
          <label>
            Ulangi password baru
            <input type="password" name="confirmPassword" autoComplete="new-password" required />
          </label>
          {isPasswordError(error) ? (
            <p role="alert" className="form-error">
              {PASSWORD_ERROR_MESSAGES[error]}
            </p>
          ) : null}
          {first(params.password) === "changed" ? (
            <p role="status" className="form-message">
              Password udah diganti.
            </p>
          ) : null}
          <button type="submit">Ganti password</button>
        </form>
      </section>

      <section aria-labelledby="delete-account">
        <h2 id="delete-account">Delete account</h2>
        <p>
          This permanently deletes your account and everything tied to it: your profile and settings, your watchlist,
          your saved wallets and their cached wallet activity checks. It cannot be undone.
        </p>
        <form action={submitDeleteAccount} className="auth-form">
          <label>
            Type {DELETE_CONFIRMATION} to confirm
            <input type="text" name="confirmation" autoComplete="off" spellCheck={false} required />
          </label>
          {error === "confirmation" ? (
            <p role="alert" className="form-error">
              {CONFIRMATION_ERROR_MESSAGE}
            </p>
          ) : null}
          <button type="submit">Delete my account</button>
        </form>
      </section>
    </>
  );
}
