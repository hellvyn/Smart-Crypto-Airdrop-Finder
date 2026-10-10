import { ProjectRow } from "@/components/ProjectRow";
import { requireUser } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getWatchlist } from "@/lib/watchlist";

export const metadata = { title: "Watchlist · Smart Airdrop Finder" };

export default async function WatchlistPage() {
  await requireUser();
  const db = await createServerClient();
  const items = await getWatchlist(db);
  return (
    <>
      <h1>Your watchlist</h1>
      {items.length === 0 ? (
        <p>You are not watching any airdrops yet.</p>
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
