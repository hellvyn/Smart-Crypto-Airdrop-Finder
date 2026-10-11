import { list } from "@/lib/copy";
import { formatDateTime, isStale } from "@/lib/view";

/** Shown when the last successful pipeline run is over 36 hours old, or there never was one. */
export function StaleBanner({ lastRunAt, now }: { lastRunAt: Date | null; now: Date }) {
  if (!isStale(lastRunAt, now)) return null;
  return (
    <p role="status" className="banner banner-stale">
      {list.stale.text} {lastRunAt ? list.stale.lastRun(formatDateTime(lastRunAt)) : list.stale.never}
    </p>
  );
}
