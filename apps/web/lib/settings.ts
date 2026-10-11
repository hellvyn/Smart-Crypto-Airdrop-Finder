// The signed-in user's settings (the one user-editable column of `profiles`: the time zone). Every function verifies
// the user itself with requireUser(), filters by that user's id, and relies on RLS ("own profile ...") plus the
// column-level UPDATE grant (timezone) as the other barriers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./auth";
import { settings as copy } from "./copy";

export interface Settings {
  timezone: string;
}

export type SettingsError = "invalid_timezone";

export const SETTINGS_ERROR_MESSAGES: Record<SettingsError, string> = {
  invalid_timezone: copy.errors.invalidTimezone,
};

export function isSettingsError(v: unknown): v is SettingsError {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SETTINGS_ERROR_MESSAGES, v);
}

/** What the user must type, exactly, to confirm deleting their account. */
export const DELETE_CONFIRMATION = "DELETE";
export const CONFIRMATION_ERROR_MESSAGE = copy.confirmError(DELETE_CONFIRMATION);

const DEFAULTS: Settings = { timezone: "UTC" };

let zoneSet: Set<string> | undefined;
let zoneList: string[] | undefined;

function zones(): { set: Set<string>; list: string[] } {
  if (!zoneSet || !zoneList) {
    const supported = Intl.supportedValuesOf("timeZone");
    // Some runtimes list "UTC" and some do not; it is the profile default and must always be accepted.
    zoneList = supported.includes("UTC") ? [...supported] : ["UTC", ...supported];
    zoneSet = new Set(zoneList);
  }
  return { set: zoneSet, list: zoneList };
}

/** Whether `tz` is exactly one of the IANA zones this runtime supports (or "UTC"). */
export function isValidTimezone(tz: unknown): tz is string {
  return typeof tz === "string" && zones().set.has(tz);
}

/** The zones to offer in the select; a stored zone that is no longer supported is kept so the form can show it. */
export function timezoneOptions(current?: string): string[] {
  const { set, list } = zones();
  return current && !set.has(current) ? [current, ...list] : list;
}

function throwIf(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Failed to ${what}: ${error.message}`);
}

/** The signed-in user's settings; the schema defaults if the profile row is somehow missing. */
export async function getSettings(db: SupabaseClient): Promise<Settings> {
  const user = await requireUser();
  const { data, error } = await db
    .from("profiles")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  throwIf(error, "load the settings");
  if (!data) return { ...DEFAULTS };
  const row = data as { timezone: unknown };
  return { timezone: typeof row.timezone === "string" ? row.timezone : DEFAULTS.timezone };
}

/** Saves the settings after validating them. Nothing is written for an unknown time zone. */
export async function saveSettings(
  db: SupabaseClient,
  input: Settings,
): Promise<{ ok: true } | { ok: false; error: SettingsError }> {
  const user = await requireUser();
  if (!isValidTimezone(input.timezone)) return { ok: false, error: "invalid_timezone" };
  const { data, error } = await db
    .from("profiles")
    .update({ timezone: input.timezone })
    .eq("user_id", user.id)
    .select("user_id");
  throwIf(error, "save the settings");
  if (!data || data.length === 0) throw new Error("Failed to save the settings: no profile found");
  return { ok: true };
}
