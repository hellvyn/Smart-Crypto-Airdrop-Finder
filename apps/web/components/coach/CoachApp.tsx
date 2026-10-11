"use client";

import { useState } from "react";
import type { CoachProfile } from "@saf/core";
import { planCardsAction } from "@/app/(public)/coach/actions";
import { Button } from "@/components/ui";
import { requestPlan, type PlanRecommendation } from "@/lib/coach-client";
import type { PlanCardInfo } from "@/lib/coach-view";
import { coach } from "@/lib/copy";
import { CoachChat, type ChatTurn } from "./CoachChat";
import { PlanCards } from "./PlanCards";
import { ProfileForm } from "./ProfileForm";

export interface RestoredThread {
  threadId: string;
  recommendations: PlanRecommendation[];
  cards: PlanCardInfo[];
  messages: ChatTurn[];
}

interface PlanState {
  threadId: string;
  recommendations: PlanRecommendation[];
  cards: PlanCardInfo[];
}

/** The profile as one line of words, for the summary above the plan. */
function summaryOf(profile: CoachProfile): string[] {
  const f = coach.form;
  return [
    f.level[profile.level],
    f.capital[profile.capital_band],
    profile.has_wallet ? `${profile.wallet_count} wallet` : `${f.wallet.legend} ${f.wallet.no}`,
    f.minutes[profile.minutes_per_day],
    f.goal[profile.goal],
    ...profile.chains,
  ];
}

/**
 * The interactive part of /coach: profile form, plan and chat (spec §5.1 to §5.3). The page has already read the
 * member's profile and quota. With `project` set it is the "Tanya AI" page: no plan, a chat about that one project.
 */
export function CoachApp({
  chains,
  profile: initialProfile,
  remaining: initialRemaining,
  langkahNol,
  project,
  restored,
}: {
  chains: string[];
  profile: CoachProfile | null;
  remaining: number | null;
  langkahNol: string;
  project: { id: string; name: string } | null;
  restored: RestoredThread | null;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<PlanState | null>(
    restored && restored.recommendations.length > 0 ? { threadId: restored.threadId, recommendations: restored.recommendations, cards: restored.cards } : null,
  );
  const [remaining, setRemaining] = useState(initialRemaining);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function makePlan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const outcome = await requestPlan();
    if (!outcome.ok) {
      setError(outcome.message);
      if (outcome.quota) setRemaining(0);
      setBusy(false);
      return;
    }
    setRemaining(outcome.remaining);
    if (outcome.threadId === null) {
      setPlan(null);
      setNotice(outcome.message);
      setBusy(false);
      return;
    }
    let cards: PlanCardInfo[] = [];
    try {
      cards = await planCardsAction(outcome.recommendations.map((r) => r.project_id));
    } catch {
      // The cards then show without logo, risk and capital tag.
    }
    setPlan({ threadId: outcome.threadId, recommendations: outcome.recommendations, cards });
    setBusy(false);
  }

  async function saved(next: CoachProfile) {
    setProfile(next);
    setEditing(false);
    if (project === null) await makePlan();
  }

  const showForm = profile === null || editing;
  const thread = project === null ? (plan?.threadId ?? null) : (restored?.threadId ?? null);

  return (
    <div className="coach">
      <h1 className="ui-display coach-title">{project ? coach.project.title(project.name) : coach.heading}</h1>
      <p className="muted">{project ? coach.project.intro : coach.intro}</p>

      {showForm ? (
        <ProfileForm
          chains={chains}
          initial={profile}
          submitLabel={project ? coach.form.submitOnly : coach.form.submit}
          onSaved={saved}
        />
      ) : profile ? (
        <section className="coach-profile" aria-labelledby="coach-profile-title">
          <h2 id="coach-profile-title" className="coach-section-title">
            {coach.profile.title}
          </h2>
          <p className="coach-profile-line">{summaryOf(profile).join(" · ")}</p>
          <div className="coach-profile-actions">
            <Button variant="secondary" type="button" onClick={() => setEditing(true)}>
              {coach.profile.edit}
            </Button>
            {project === null ? (
              <Button variant="primary" type="button" disabled={busy} onClick={makePlan}>
                {coach.profile.makePlan}
              </Button>
            ) : null}
          </div>
          {project === null ? <p className="muted">{coach.profile.makePlanNote}</p> : null}
        </section>
      ) : null}

      {busy ? (
        <p role="status" className="coach-busy">
          {coach.profile.planning}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {notice ? <p className="banner coach-notice">{notice}</p> : null}

      {profile && plan && project === null ? (
        <>
          <PlanCards
            recommendations={plan.recommendations}
            cards={plan.cards}
            level={profile.level}
            hasWallet={profile.has_wallet}
            langkahNol={langkahNol}
          />
          <CoachChat
            key={plan.threadId}
            threadId={plan.threadId}
            projectId={null}
            remaining={remaining}
            initialMessages={restored && restored.threadId === plan.threadId ? restored.messages : []}
          />
        </>
      ) : null}
      {profile && !showForm && project !== null ? (
        <CoachChat key={thread ?? "new"} threadId={thread} projectId={project.id} remaining={remaining} initialMessages={restored?.messages ?? []} />
      ) : null}
    </div>
  );
}
