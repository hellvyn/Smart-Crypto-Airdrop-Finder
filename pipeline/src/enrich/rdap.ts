import { z } from "zod";
import type { Http } from "../collectors/types.js";

const MS_PER_DAY = 86_400_000;

const responseSchema = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() }).partial()),
});

/**
 * Domain age in whole days (floored, never negative) from the RDAP registration event.
 * Returns null on any error, a missing registration event, or an unparseable date.
 */
export async function domainAgeDays(http: Http, domain: string, now: Date): Promise<number | null> {
  const res = await http.get(`https://rdap.org/domain/${encodeURIComponent(domain.toLowerCase())}`);
  if (res.status !== 200) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    return null;
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const registration = parsed.data.events.find((e) => e.eventAction === "registration");
  if (registration?.eventDate === undefined) return null;
  const registeredAt = Date.parse(registration.eventDate);
  if (Number.isNaN(registeredAt)) return null;
  return Math.max(0, Math.floor((now.getTime() - registeredAt) / MS_PER_DAY));
}
