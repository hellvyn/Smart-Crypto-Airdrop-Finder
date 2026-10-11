import { FarmingCard, dailyProgress } from "@/components/farming/FarmingCard";
import { requireUser } from "@/lib/auth";
import { garapan as copy, pageTitle } from "@/lib/copy";
import { FARMING_ERROR_MESSAGES, getFarmingBoard, isFarmingErrorCode } from "@/lib/farming";
import { createServerClient } from "@/lib/supabase/server";

export const metadata = { title: pageTitle(copy.title) };

const LEGEND: { className: string; text: string }[] = [
  { className: "heat-cell heat-level-none", text: copy.legend.none },
  { className: "heat-cell heat-level-0", text: copy.legend.zero },
  { className: "heat-cell heat-level-1", text: copy.legend.low },
  { className: "heat-cell heat-level-2", text: copy.legend.high },
  { className: "heat-cell heat-level-3", text: copy.legend.full },
  { className: "heat-cell heat-upcoming", text: copy.legend.upcoming },
];

/**
 * "Garapan saya": the projects the member farms now, one card each. A refused form action (limits, bad task text, a
 * task archived in another tab) comes back here as `?error=<code>` and is shown above the cards.
 */
export default async function GarapanPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  await requireUser();
  const { error } = await searchParams;
  const message = isFarmingErrorCode(error) ? FARMING_ERROR_MESSAGES[error] : null;
  const db = await createServerClient();
  const cards = await getFarmingBoard(db, new Date());
  const today = cards.map(dailyProgress).reduce((sum, p) => ({ done: sum.done + p.done, total: sum.total + p.total }), {
    done: 0,
    total: 0,
  });
  return (
    <div className="garapan">
      <div className="garapan-head">
        <h1 className="ui-display garapan-title">{copy.heading}</h1>
        {cards.length > 0 ? (
          <div className="garapan-summary" data-testid="garapan-summary">
            <div className="garapan-stat">
              <span className="garapan-stat-number">{cards.length}</span>{" "}
              <span className="garapan-stat-label">{copy.projects}</span>
            </div>
            <div className="garapan-stat">
              <span className="garapan-stat-number" data-tone="pass">
                {today.done}/{today.total}
              </span>{" "}
              <span className="garapan-stat-label">{copy.dailyToday}</span>
            </div>
          </div>
        ) : null}
      </div>
      {message ? (
        <p role="alert" className="form-error garapan-error">
          {message}
        </p>
      ) : null}
      {cards.length === 0 ? (
        <p className="garapan-empty">{copy.empty}</p>
      ) : (
        <>
          <ul className="heat-legend" aria-label={copy.legendLabel}>
            {LEGEND.map((item) => (
              <li key={item.text}>
                <span className={item.className} aria-hidden="true" />
                {item.text}
              </li>
            ))}
          </ul>
          {cards.map((card) => (
            <FarmingCard key={card.projectId} card={card} />
          ))}
        </>
      )}
    </div>
  );
}
