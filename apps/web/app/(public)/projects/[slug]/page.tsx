import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { StaleBanner } from "@/components/StaleBanner";
import { WalletActivitySection } from "@/components/WalletActivitySection";
import { WatchButton } from "@/components/WatchButton";
import { getUser } from "@/lib/auth";
import { getLastSuccessfulRunAt, getProjectDetail } from "@/lib/queries";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";
import { isWatching } from "@/lib/watchlist";
import { listWallets } from "@/lib/wallets";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await createServerClient();
  const [project, lastRunAt] = await Promise.all([getProjectDetail(db, slug), getLastSuccessfulRunAt(db)]);
  if (!project) notFound();
  // The page is public; only a signed-in user gets the watch state (null = signed out).
  const user = await getUser();
  const watching = user ? await isWatching(db, project.id) : null;
  // Wallet activity is for signed-in users (null = signed out); see WalletActivitySection for what each case shows.
  const wallets = user ? await listWallets(db) : null;
  return (
    <>
      <p>
        <Link href={LIST_PATH}>&larr; All airdrops</Link>
      </p>
      <StaleBanner lastRunAt={lastRunAt} now={new Date()} />
      <WatchButton projectId={project.id} slug={project.slug} watching={watching} />
      <ProjectDetailView project={project} />
      <WalletActivitySection project={project} wallets={wallets} />
    </>
  );
}
