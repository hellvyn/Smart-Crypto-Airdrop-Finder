// The data of the morning briefing box on /airdrops (coach and briefing spec §5.6). The AI part is the pipeline's
// `briefings` row; the personal part comes from queries the page already has (the watchlist changes feed) and the
// garapan board.
import type { BriefingItem } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFarmingBoard } from "./farming";
import { getLatestBriefing } from "./queries";

/** One stored briefing: `day` is the WIB day it was written for (`YYYY-MM-DD`). */
export interface Briefing {
  day: string;
  items: BriefingItem[];
  /** False for the version the pipeline writes without the AI. */
  ai: boolean;
}

/** The next deadline of a project the member is farming (garapan). */
export interface GarapanDeadline {
  slug: string;
  name: string;
  kind: string;
  date: string;
  approximate: boolean;
}

export interface BriefingData {
  briefing: Briefing | null;
  garapan: GarapanDeadline[];
}

/** The most garapan deadlines the box lists. */
export const MAX_GARAPAN_DEADLINES = 3;

const WIB_OFFSET_MS = 7 * 3_600_000;

/** `YYYY-MM-DD` of `now` in WIB (UTC+7), the day the briefing is written for. */
export function wibDay(now: Date): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * What the briefing box needs besides the watchlist feed, for a signed-in member. Null when the briefing could not be
 * read: the page then shows no box at all. A failed garapan read only leaves that list empty. Nothing is logged: an
 * error could carry the member's data.
 */
export async function getBriefingData(db: SupabaseClient, now: Date): Promise<BriefingData | null> {
  let briefing: Briefing | null;
  try {
    briefing = await getLatestBriefing(db);
  } catch {
    return null;
  }
  let garapan: GarapanDeadline[] = [];
  try {
    garapan = (await getFarmingBoard(db, now))
      .flatMap((card) =>
        card.ended || card.nextDeadline === null
          ? []
          : [
              {
                slug: card.slug,
                name: card.name,
                kind: card.nextDeadline.kind,
                date: card.nextDeadline.date,
                approximate: card.nextDeadline.precision === "approximate",
              },
            ],
      )
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(0, MAX_GARAPAN_DEADLINES);
  } catch {
    // The box still shows the briefing and the watchlist changes.
  }
  return { briefing, garapan };
}
