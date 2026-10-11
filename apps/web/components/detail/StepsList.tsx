import { ExplainStep } from "@/components/coach/ExplainStep";
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

/**
 * Whether `text` names `host` as a whole host: not inside a longer one ("x.io" is not in "max.io" or in
 * "x.io.evil.example"). A sentence's full stop or a path after the host still counts.
 */
function namesHost(text: string, host: string): boolean {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9.-])${escaped}(?![a-z0-9-]|\\.[a-z0-9])`, "i").test(text);
}

/** The project's claim/app links whose host the step names, so the step shows each one's check status (#42). */
function linksOf(text: string, links: DetailLink[]): DetailLink[] {
  return links.filter((l) => {
    const host = isCheckedKind(l.kind) ? hostOf(l.url) : null;
    return host !== null && namesHost(text, host);
  });
}

/**
 * "03 · Step garap": the steps grouped Daily, Weekly, Sekali, each group in step order. Step text is plain text (a URL
 * in it is no link); a claim/app link the step names is shown under it with its check status, and a phishing one is
 * a warning, never an anchor.
 */
export function StepsList({
  steps,
  links,
  member = false,
  projectId,
}: {
  steps: { id?: string; text: string; cadence: Cadence }[];
  links: DetailLink[];
  /** A signed-in member also gets "Jelasin langkah ini" under each step; a visitor gets no trace of it. */
  member?: boolean;
  projectId?: string;
}) {
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
                {member && projectId && s.id ? <ExplainStep projectId={projectId} stepId={s.id} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SectionCard>
  );
}
