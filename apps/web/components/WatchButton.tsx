import Link from "next/link";
import { submitWatch } from "@/app/(app)/watchlist/actions";
import { detail } from "@/lib/copy";

/**
 * "Tambah ke watchlist" / "Hapus dari watchlist" on the project detail page. Signed-out users (`watching === null`)
 * get a login link that comes back to the project. The form always sends the wanted state, so a double submit cannot
 * undo itself.
 */
export function WatchButton({ projectId, slug, watching }: { projectId: string; slug: string; watching: boolean | null }) {
  if (watching === null) {
    const next = encodeURIComponent(`/projects/${slug}`);
    return <Link href={`/login?next=${next}`}>{detail.loginToWatch}</Link>;
  }
  return (
    <form action={submitWatch}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="watch" value={watching ? "0" : "1"} />
      <button type="submit">{watching ? detail.unwatch : detail.watch}</button>
    </form>
  );
}
