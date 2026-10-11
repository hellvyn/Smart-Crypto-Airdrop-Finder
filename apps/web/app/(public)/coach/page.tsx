import Link from "next/link";
import { LANGKAH_NOL } from "@saf/core";
import { CoachApp, type RestoredThread } from "@/components/coach/CoachApp";
import { ThreadList } from "@/components/coach/ThreadList";
import { getUser } from "@/lib/auth";
import { Stamp } from "@/components/ui";
import { getCoachProfile, remainingQuota } from "@/lib/coach";
import { getPlanCards, getProjectGate, getThread, listThreads } from "@/lib/coach-view";
import { coach, notCurated, pageTitle } from "@/lib/copy";
import { listCoachChains } from "@/lib/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata = { title: pageTitle(coach.title) };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * AI Coach (spec §5). Members only: a visitor sees the page with a "KHUSUS MEMBER" stamp and what the Coach does, and
 * nothing is read for them (owner 2026-10-11: the menu shows for visitors too). `?project={id}` is "Tanya AI"
 * from a project page: a chat about that one project, or, for a project that did not pass curation, its public
 * reason and nothing else (§5.4). `?thread={id}` opens one of the member's earlier threads.
 */
export default async function CoachPage({ searchParams }: { searchParams: Promise<{ project?: string | string[]; thread?: string | string[] }> }) {
  const user = await getUser();
  if (!user) {
    return (
      <div className="coach coach-visitor" data-testid="coach-visitor">
        <h1 className="ui-display coach-title">{coach.heading}</h1>
        <div className="coach-visitor-stamp">
          <Stamp top={coach.visitor.stampTop} bottom={coach.visitor.stampBottom} tone="alert" size="lg" rotate={-6} />
        </div>
        <p>{coach.visitor.text}</p>
      </div>
    );
  }
  const params = await searchParams;
  const db = await createServerClient();
  const now = new Date();

  const [profile, chains, threads, remaining, opened] = await Promise.all([
    getCoachProfile(db, user.id),
    listCoachChains(db),
    listThreads(db, now),
    remainingQuota(db),
    first(params.thread) ? getThread(db, first(params.thread)!) : Promise.resolve(null),
  ]);

  const projectId = first(params.project) ?? opened?.projectId ?? null;
  const gate = projectId ? await getProjectGate(db, projectId) : null;

  let restored: RestoredThread | null = null;
  if (opened) {
    const cards = await getPlanCards(db, opened.recommendations.map((r) => r.project_id));
    restored = { threadId: opened.id, recommendations: opened.recommendations, cards, messages: opened.messages };
  }

  return (
    <>
      {gate?.state === "ok" || gate === null ? (
        <CoachApp
          // A different thread or project is a different conversation: start its state from scratch.
          key={`${gate?.state === "ok" ? gate.id : "plan"}:${restored?.threadId ?? "new"}`}
          chains={chains}
          profile={profile}
          remaining={remaining}
          langkahNol={LANGKAH_NOL}
          project={gate?.state === "ok" ? { id: gate.id, name: gate.name } : null}
          restored={restored}
        />
      ) : (
        <div className="coach">
          <h1 className="ui-display coach-title">{gate.state === "not_listed" ? coach.project.title(gate.name) : coach.heading}</h1>
          {gate.state === "not_listed" ? (
            <>
              <p className="banner banner-not-curated" data-testid="coach-not-listed">
                {notCurated.banner(gate.reason)}
              </p>
              <p>{coach.project.notListedNote}</p>
              <p>
                <Link href={`/projects/${encodeURIComponent(gate.slug)}`}>{coach.project.open}</Link>
              </p>
            </>
          ) : (
            <p>{coach.project.notFound}</p>
          )}
        </div>
      )}
      <ThreadList threads={threads} />
    </>
  );
}
