import { ChangesSinceLastVisit } from "@/components/ChangesSinceLastVisit";
import { ProjectRow } from "@/components/ProjectRow";
import { requireUser } from "@/lib/auth";
import { pageTitle, watchlist as copy } from "@/lib/copy";
import { getChangesSeenAt, listChangesSince } from "@/lib/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getWatchlist } from "@/lib/watchlist";

export const metadata = { title: pageTitle(copy.title) };

export default async function WatchlistPage() {
  const user = await requireUser();
  const db = await createServerClient();
  const now = new Date();
  const [items, changes] = await Promise.all([
    getWatchlist(db),
    getChangesSeenAt(db, user.id).then((since) => listChangesSince(db, since, now)),
  ]);
  return (
    <>
      <h1>{copy.heading}</h1>
      <ChangesSinceLastVisit items={changes} />
      {items.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <div className="project-list">
          {items.map((item) => (
            <ProjectRow key={item.slug} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
