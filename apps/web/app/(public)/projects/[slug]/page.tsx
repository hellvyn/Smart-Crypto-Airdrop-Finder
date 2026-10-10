import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { StaleBanner } from "@/components/StaleBanner";
import { getLastSuccessfulRunAt, getProjectDetail } from "@/lib/queries";
import { createServerClient } from "@/lib/supabase/server";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await createServerClient();
  const [project, lastRunAt] = await Promise.all([getProjectDetail(db, slug), getLastSuccessfulRunAt(db)]);
  if (!project) notFound();
  return (
    <>
      <p>
        <Link href="/">&larr; All airdrops</Link>
      </p>
      <StaleBanner lastRunAt={lastRunAt} now={new Date()} />
      <ProjectDetailView project={project} />
    </>
  );
}
