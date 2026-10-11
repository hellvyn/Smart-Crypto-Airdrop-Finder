import { ProjectRow } from "@/components/ProjectRow";
import { requireUser } from "@/lib/auth";
import { pageTitle, watchlist as copy } from "@/lib/copy";
import { createServerClient } from "@/lib/supabase/server";
import { getWatchlist } from "@/lib/watchlist";

export const metadata = { title: pageTitle(copy.title) };

export default async function WatchlistPage() {
  await requireUser();
  const db = await createServerClient();
  const items = await getWatchlist(db);
  return (
    <>
      <h1>{copy.heading}</h1>
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
