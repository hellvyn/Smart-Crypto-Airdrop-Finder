import { requireUser } from "@/lib/auth";
import { pageTitle, settings as copy } from "@/lib/copy";
import {
  CONFIRMATION_ERROR_MESSAGE,
  DELETE_CONFIRMATION,
  getSettings,
  isSettingsError,
  SETTINGS_ERROR_MESSAGES,
  timezoneOptions,
} from "@/lib/settings";
import { createServerClient } from "@/lib/supabase/server";
import { submitDeleteAccount, submitUpdateSettings } from "./actions";

export const metadata = { title: pageTitle(copy.title) };

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; error?: string | string[] }>;
}) {
  await requireUser();
  const params = await searchParams;
  const error = first(params.error);
  const db = await createServerClient();
  const settings = await getSettings(db);
  return (
    <>
      <h1>{copy.heading}</h1>
      <form action={submitUpdateSettings} className="auth-form">
        <label>
          {copy.timezone}
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
            {copy.saved}
          </p>
        ) : null}
        <button type="submit">{copy.save}</button>
      </form>

      <section aria-labelledby="delete-account">
        <h2 id="delete-account">{copy.deleteHeading}</h2>
        <p>{copy.deleteText}</p>
        <form action={submitDeleteAccount} className="auth-form">
          <label>
            {copy.confirmLabel(DELETE_CONFIRMATION)}
            <input type="text" name="confirmation" autoComplete="off" spellCheck={false} required />
          </label>
          {error === "confirmation" ? (
            <p role="alert" className="form-error">
              {CONFIRMATION_ERROR_MESSAGE}
            </p>
          ) : null}
          <button type="submit">{copy.deleteButton}</button>
        </form>
      </section>
    </>
  );
}
