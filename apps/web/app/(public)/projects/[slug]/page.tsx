import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { StaleBanner } from "@/components/StaleBanner";
import { WatchButton } from "@/components/WatchButton";
import { getUser } from "@/lib/auth";
import { getLastSuccessfulRunAt, getProjectDetail } from "@/lib/queries";
import { createServerClient } from "@/lib/supabase/server";
import { isWatching } from "@/lib/watchlist";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await createServerClient();
  const [project, lastRunAt] = await Promise.all([getProjectDetail(db, slug), getLastSuccessfulRunAt(db)]);
  if (!project) notFound();
  // The page is public; only a signed-in user gets the watch state (null = signed out).
  const user = await getUser();
  const watching = user ? await isWatching(db, project.id) : null;
  return (
    <>
      <p>
        <Link href="/">&larr; All airdrops</Link>
      </p>
      <StaleBanner lastRunAt={lastRunAt} now={new Date()} />
      <WatchButton projectId={project.id} slug={project.slug} watching={watching} />
      <ProjectDetailView project={project} />
    </>
  );
}
