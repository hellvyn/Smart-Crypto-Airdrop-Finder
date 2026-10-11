import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AskCoachLink } from "@/components/coach/AskCoachLink";
import { FarmButton } from "@/components/farming/FarmButton";
import { NotCuratedBanner } from "@/components/NotCuratedBanner";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { StaleBanner } from "@/components/StaleBanner";
import { WalletActivitySection } from "@/components/WalletActivitySection";
import { WatchButton } from "@/components/WatchButton";
import { getUser } from "@/lib/auth";
import { isCoachCandidate } from "@/lib/coach";
import { isFarming } from "@/lib/farming";
import { detail, pageTitle, projectSeoDescription } from "@/lib/copy";
import { getLastSuccessfulRunAt, getProjectDetail } from "@/lib/queries";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";
import { isWatching } from "@/lib/watchlist";
import { notCuratedReason } from "@/lib/view";
import { listWallets } from "@/lib/wallets";

/**
 * One read of the project per request, shared by the page and its metadata (React `cache` keys on the arguments).
 * Both call it without `now` on purpose: an extra argument would make the keys differ and defeat the dedupe.
 */
const loadProject = cache(async (slug: string, member: boolean) =>
  getProjectDetail(await createServerClient(), slug, { member }),
);

/**
 * A project that is not on the curated list (failed, or never rated) stays out of search engines (#55). One that
 * passed and then ended is not failed. The metadata reuses the page's own project read, so it adds no query.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const project = await loadProject(slug, (await getUser()) !== null);
  if (!project) return {};
  if (notCuratedReason(project.curation) !== null) return { robots: { index: false } };
  const description = projectSeoDescription(project.name, project.chains);
  const path = `/projects/${encodeURIComponent(project.slug)}`;
  return {
    title: pageTitle(project.name),
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", title: pageTitle(project.name), description, url: path },
    twitter: { card: "summary", title: pageTitle(project.name), description },
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await createServerClient();
  // The page is public. Signed in = member (#45): only then are the member-only parts queried at all.
  const user = await getUser();
  const now = new Date();
  const [project, lastRunAt] = await Promise.all([
    loadProject(slug, user !== null),
    getLastSuccessfulRunAt(db),
  ]);
  if (!project) notFound();
  // Only a signed-in user gets the watch and farming state (null = signed out).
  // A failed extra hides its own part (no button) instead of turning the public project page into the error page.
  // Wallet activity is for signed-in users (null = signed out); see WalletActivitySection for what each case shows.
  const [watching, farming, canExplain, wallets] = user
    ? await Promise.all([
        isWatching(db, project.id).catch(() => false),
        isFarming(db, project.id).catch(() => null),
        isCoachCandidate(db, project.id, now),
        listWallets(db).catch(() => null),
      ])
    : [null, null, false, null];
  const notListed = notCuratedReason(project.curation);
  return (
    <>
      <p>
        <Link href={LIST_PATH}>{detail.back}</Link>
      </p>
      {/* Right after the back link, above the stale banner and the watch and farm buttons. */}
      {notListed !== null ? <NotCuratedBanner reason={notListed} /> : null}
      <StaleBanner lastRunAt={lastRunAt} now={now} />
      <div className="project-actions">
        <WatchButton projectId={project.id} slug={project.slug} watching={watching} />
        <AskCoachLink projectId={project.id} member={user !== null} />
        {/* Last: its quiet "Berhenti garap" closes the row instead of sitting between buttons. */}
        <FarmButton projectId={project.id} farming={farming} />
      </div>
      <ProjectDetailView project={project} member={user !== null} canExplain={canExplain} now={now} />
      <WalletActivitySection project={project} wallets={wallets} />
    </>
  );
}
