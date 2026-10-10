import Link from "next/link";
import { submitWatch } from "@/app/(app)/watchlist/actions";

/**
 * Watch / Unwatch for the project detail page. Signed-out users (`watching === null`) get a sign-in link that comes
 * back to the project. The form always sends the wanted state, so a double submit cannot undo itself.
 */
export function WatchButton({ projectId, slug, watching }: { projectId: string; slug: string; watching: boolean | null }) {
  if (watching === null) {
    const next = encodeURIComponent(`/projects/${slug}`);
    return <Link href={`/login?next=${next}`}>Sign in to watch</Link>;
  }
  return (
    <form action={submitWatch}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="watch" value={watching ? "0" : "1"} />
      <button type="submit">{watching ? "Unwatch" : "Watch"}</button>
    </form>
  );
}
