"use client";

import Link from "next/link";
import { useState } from "react";
import type { CoachProfile } from "@saf/core";
import { startFarmingAction } from "@/app/(app)/garapan/actions";
import { ProjectLogo } from "@/components/ProjectLogo";
import { RiskBadge } from "@/components/RiskBadge";
import { Button, Tag, type TagTone } from "@/components/ui";
import type { PlanRecommendation } from "@/lib/coach-client";
import type { PlanCardInfo } from "@/lib/coach-view";
import { coach, garapan } from "@/lib/copy";
import { capitalLabel, type Capital } from "@/lib/view";

const copy = coach.plan;
const CAPITAL_TONE: Record<Capital, TagTone> = { free: "verified", deposit: "plain", unknown: "reported" };

/**
 * "Mulai garap" on a plan card: `startFarmingAction`, then a pointer to Garapan saya. A refusal (the project limit)
 * is shown under the button and the button stays.
 */
function StartFarming({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "started">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (state !== "idle") return;
    setState("busy");
    setError(null);
    try {
      const outcome = await startFarmingAction(projectId);
      if (outcome.ok) {
        setState("started");
        return;
      }
      setError(garapan.errors[outcome.error]);
    } catch {
      setError(coach.errors.unavailable);
    }
    setState("idle");
  }

  if (state === "started") {
    return (
      <p className="coach-started">
        <span>{copy.started}</span> <Link href="/garapan">{copy.openGarapan}</Link>
      </p>
    );
  }
  return (
    <div className="coach-start">
      <Button variant="primary" type="button" disabled={state === "busy"} onClick={start}>
        {garapan.start}
      </Button>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The plan as cards (spec §5.2): the list card's logo, name, risk and capital tag, then the reasons with their quotes,
 * the minutes and "Mulai garap". The security reminder (Pemula) and Langkah 0 (no wallet) are fixed text above the cards:
 * the model's plan never carries them. Everything the model wrote is plain text, and the only links are internal.
 */
export function PlanCards({
  recommendations,
  cards,
  level,
  hasWallet,
  langkahNol,
}: {
  recommendations: PlanRecommendation[];
  cards: PlanCardInfo[];
  level: CoachProfile["level"];
  hasWallet: boolean;
  langkahNol: string;
}) {
  const info = new Map(cards.map((c) => [c.id, c]));
  return (
    <section className="coach-plan" aria-labelledby="coach-plan-title">
      <h2 id="coach-plan-title" className="coach-section-title">
        {copy.title}
      </h2>
      {level === "beginner" ? (
        <aside className="banner coach-security" data-testid="coach-security">
          <h3>{copy.securityTitle}</h3>
          <p>{copy.security}</p>
        </aside>
      ) : null}
      {!hasWallet ? (
        <p className="coach-langkah-nol" data-testid="coach-langkah-nol">
          {langkahNol}
        </p>
      ) : null}
      <div className="coach-cards">
        {recommendations.map((rec) => {
          const card = info.get(rec.project_id);
          const nameId = `coach-card-${rec.project_id}`;
          const freeNote = card?.capital === "free" && !rec.capital_note.includes(copy.freeNoteKey);
          return (
            <article key={rec.project_id} className="coach-card" aria-labelledby={nameId}>
              <div className="coach-card-head">
                <ProjectLogo id={rec.project_id} slug={rec.slug} name={rec.name} source={card?.logoSource ?? null} />
                <h3 id={nameId} className="coach-card-name">
                  <Link href={`/projects/${encodeURIComponent(rec.slug)}`}>{rec.name}</Link>
                </h3>
              </div>
              {card ? (
                <p className="badges">
                  <RiskBadge level={card.riskLevel} />
                  <Tag tone={CAPITAL_TONE[card.capital]} data-capital={card.capital}>
                    {capitalLabel(card.capital, card.capitalMinUsd)}
                  </Tag>
                </p>
              ) : null}
              <p className="coach-minutes">{copy.minutes(rec.minutes_per_day)}</p>
              <div className="coach-reasons">
                <h4>{copy.reasons}</h4>
                <ul>
                  {rec.reasons.map((reason, i) => (
                    <li key={i}>
                      <span>{reason.text}</span>
                      <blockquote className="coach-quote">{`"${reason.quote}"`}</blockquote>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="muted coach-capital-note">{rec.capital_note}</p>
              {freeNote ? <p className="muted coach-capital-note">{copy.freeNote}</p> : null}
              <StartFarming projectId={rec.project_id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
