// Client-safe helpers of the Coach pages (spec §5.1, §5.3): the profile form's validation and the matching of project
// names in an answer against the links the server sent. No I/O and no server imports, so the components and Vitest
// can use it. The links come from the server (`X-Coach-Links`, built from slugs it owns), never from the model's text.
import { COACH_CAPITAL_BANDS, COACH_GOALS, COACH_LEVELS, COACH_MINUTES } from "@saf/core";
import type { CoachProfile } from "@saf/core";
import { coach } from "./copy";

// ---- Links in an answer ----

export interface CoachLink {
  name: string;
  href: string;
}

export interface TextSegment {
  text: string;
  /** Set when the segment is a project name: an internal `/projects/{slug}` link. */
  href?: string;
}

const PROJECT_HREF = /^\/projects\/[A-Za-z0-9._~%-]+$/;

/** The links of the `X-Coach-Links` header. Anything that is not an internal project link is dropped. */
export function parseLinksHeader(value: string | null): CoachLink[] {
  if (value === null || value === "") return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const { name, href } = item as { name?: unknown; href?: unknown };
      return typeof name === "string" && name.trim() !== "" && typeof href === "string" && PROJECT_HREF.test(href)
        ? [{ name, href }]
        : [];
    });
  } catch {
    return [];
  }
}

/**
 * `text` cut into plain pieces and project-name pieces. A name is matched exactly (case sensitive) and the longest
 * name wins, so "Base Swap" is not split by a project called "Base". The text itself is never altered.
 */
export function linkify(text: string, links: CoachLink[]): TextSegment[] {
  const byName = new Map<string, string>();
  for (const l of links) if (!byName.has(l.name)) byName.set(l.name, l.href);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0 || text === "") return text === "" ? [] : [{ text }];

  const segments: TextSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const name = names.find((n) => text.startsWith(n, i));
    if (name === undefined) {
      plain += text[i];
      i += 1;
      continue;
    }
    if (plain !== "") segments.push({ text: plain });
    plain = "";
    segments.push({ text: name, href: byName.get(name)! });
    i += name.length;
  }
  if (plain !== "") segments.push({ text: plain });
  return segments;
}

// ---- Profile form ----

/** What the form holds while the member fills it: strings, "" for nothing chosen yet. */
export interface ProfileFormValues {
  level: string;
  capital_band: string;
  has_wallet: "" | "yes" | "no";
  wallet_count: string;
  minutes_per_day: string;
  goal: string;
  chains: string[];
}

export type ProfileFormErrors = Partial<
  Record<"level" | "capital_band" | "has_wallet" | "wallet_count" | "minutes_per_day" | "goal", string>
>;

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  level: "",
  capital_band: "",
  has_wallet: "",
  wallet_count: "",
  minutes_per_day: "",
  goal: "",
  chains: [],
};

export function formValuesFrom(profile: CoachProfile | null): ProfileFormValues {
  if (profile === null) return EMPTY_PROFILE_FORM;
  return {
    level: profile.level,
    capital_band: profile.capital_band,
    has_wallet: profile.has_wallet ? "yes" : "no",
    wallet_count: profile.wallet_count === null ? "" : String(profile.wallet_count),
    minutes_per_day: String(profile.minutes_per_day),
    goal: profile.goal,
    chains: profile.chains,
  };
}

const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** The profile to save, or the message per field. The server checks everything again. */
export function validateProfileForm(
  values: ProfileFormValues,
): { ok: true; profile: CoachProfile } | { ok: false; errors: ProfileFormErrors } {
  const errors: ProfileFormErrors = {};
  const e = coach.form.errors;
  if (!isOneOf(COACH_LEVELS, values.level)) errors.level = e.level;
  if (!isOneOf(COACH_CAPITAL_BANDS, values.capital_band)) errors.capital_band = e.capital;
  if (values.has_wallet === "") errors.has_wallet = e.wallet;
  const minutes = Number(values.minutes_per_day);
  if (!(COACH_MINUTES as readonly number[]).includes(minutes)) errors.minutes_per_day = e.minutes;
  if (!isOneOf(COACH_GOALS, values.goal)) errors.goal = e.goal;
  const count = Number(values.wallet_count);
  if (values.has_wallet === "yes" && !(values.wallet_count.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= 10)) {
    errors.wallet_count = e.walletCount;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      level: values.level as CoachProfile["level"],
      capital_band: values.capital_band as CoachProfile["capital_band"],
      has_wallet: values.has_wallet === "yes",
      wallet_count: values.has_wallet === "yes" ? count : null,
      minutes_per_day: minutes as CoachProfile["minutes_per_day"],
      goal: values.goal as CoachProfile["goal"],
      chains: values.chains,
    },
  };
}
