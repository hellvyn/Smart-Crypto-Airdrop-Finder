import { LinkStatus, SectionCard } from "@/components/ui";
import { detail as copy } from "@/lib/copy";
import { isCheckedKind } from "@/lib/detail";
import type { Cadence, DetailLink } from "@/lib/view";

const ORDER: readonly Cadence[] = ["daily", "weekly", "once"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The project's claim/app links whose host the step names, so the step shows each one's check status (#42). */
function linksOf(text: string, links: DetailLink[]): DetailLink[] {
  const lower = text.toLowerCase();
  return links.filter((l) => {
    const host = isCheckedKind(l.kind) ? hostOf(l.url) : null;
    return host !== null && lower.includes(host);
  });
}

/**
 * "03 · Step garap": the steps grouped Daily, Weekly, Sekali, each group in step order. Step text is plain text (a URL
 * in it is no link); a claim/app link the step names is shown under it with its check status, and a phishing one is
 * a warning, never an anchor.
 */
export function StepsList({ steps, links }: { steps: { text: string; cadence: Cadence }[]; links: DetailLink[] }) {
  const groups = ORDER.map((cadence) => ({ cadence, steps: steps.filter((s) => s.cadence === cadence) })).filter(
    (g) => g.steps.length > 0,
  );
  return (
    <SectionCard number="03" title={copy.sections.steps}>
      {groups.length === 0 ? <p className="muted">{copy.steps.empty}</p> : null}
      {groups.map((g) => (
        <div key={g.cadence} className="detail-step-group">
          <h3 className="detail-step-cadence">{copy.steps.cadence[g.cadence]}</h3>
          <ul className="detail-steps" aria-label={copy.steps.cadence[g.cadence]}>
            {g.steps.map((s, i) => (
              <li key={i}>
                <span>{s.text}</span>
                {linksOf(s.text, links).map((l) => (
                  <LinkStatus key={l.url} status={l.status ?? "unchecked"} url={l.url} />
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SectionCard>
  );
}
