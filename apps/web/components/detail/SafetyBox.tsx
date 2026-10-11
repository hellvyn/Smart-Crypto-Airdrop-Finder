import type { CheckId, RiskReason } from "@saf/core";
import { LinkStatus, SectionCard } from "@/components/ui";
import { detail as copy, labels, ui } from "@/lib/copy";
import { domainAge, isCheckedKind, registeredOn, safetyStrip, wibClock } from "@/lib/detail";
import { coverageLine, severityLabel, type DetailCheck, type DetailLink, type ProjectDetail, type ScamFlag } from "@/lib/view";

const s = copy.safety;
/** The 4 must-pass checks, in the mockup's card order (Cek 01 to Cek 04). */
const KEY_ORDER = ["dangerous_asks", "lookalike", "domain_age", "phishing_list"] as const;
type KeyId = (typeof KEY_ORDER)[number];
type AdvancedId = Exclude<CheckId, KeyId>;

const COUNT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

function num(v: string | number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Result and detail sentence of a key check. A sentence is only written when the check said what it looked at. */
function keyCard(id: KeyId, c: DetailCheck | undefined, computedAt: string): { result: string; detail: string | null; tone: string } {
  if (!c?.ran) return { result: s.notRun, detail: null, tone: "warn" };
  const tone = c.flagged ? "warn" : "pass";
  const d = c.detail ?? {};
  const words = s.results[id];
  const result = c.flagged ? words.found : words.clean;
  switch (id) {
    case "dangerous_asks": {
      const n = num(d.sources);
      return { result, detail: n === null ? null : s.details.dangerous_asks(n), tone };
    }
    case "lookalike": {
      const n = num(d.compared);
      return { result, detail: n === null ? null : s.details.lookalike(COUNT.format(n)), tone };
    }
    case "domain_age": {
      const days = num(d.ageDays);
      if (days === null) return { result, detail: null, tone };
      return { result: domainAge(days), detail: s.details.domain_age(registeredOn(computedAt, days)), tone };
    }
    case "phishing_list": {
      const n = num(d.checked);
      return { result, detail: n === null ? null : s.details.phishing_list(n), tone };
    }
  }
}

/** What a member sees an advanced check found. */
function advancedResult(c: DetailCheck): string {
  const d = c.detail ?? {};
  const id = c.id as AdvancedId;
  if (id === "hack_history" && num(d.count) !== null) return s.hacks(num(d.count)!);
  if (id === "corroboration" && num(d.sources) !== null) return s.sourceCount(num(d.sources)!);
  if (id === "ai_review") return c.flagged ? s.scam.found : s.scam.clean;
  return c.flagged ? s.generic.found : s.generic.clean;
}

function Reasons({ reasons }: { reasons: RiskReason[] }) {
  if (reasons.length === 0) return <p className="muted">{s.noReasons}</p>;
  return (
    <ul className="detail-reasons" aria-label={s.reasons}>
      {reasons.map((r, i) => (
        <li key={`${r.code}-${i}`} data-severity={r.severity}>
          <strong>{severityLabel(r.severity)}</strong>: <span>{r.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "04 · Security check" (#53, mockup CProject section 04): the re-check time, the strip (layers, sources read, links
 * checked, red flags), the risk reasons, the 4 must-pass cards, the advanced checks that ran, and the claim/app links
 * with their status. A visitor's advanced checks carry no detail (#54): an unflagged one is stamped "Member only", a
 * flagged one points to the public risk reasons. A row stored without details shows no detail sentence.
 */
export function SafetyBox({
  risk,
  links,
  sourceUrls,
  member,
  scamFlags,
}: {
  risk: ProjectDetail["risk"];
  links: DetailLink[];
  sourceUrls: string[];
  member: boolean;
  scamFlags: ScamFlag[] | null;
}) {
  const checkedLinks = links.filter((l) => isCheckedKind(l.kind));
  return (
    <section className="ui-section-card detail-safety">
      <div className="ui-section-head">
        <h2 className="ui-display ui-section-title">{`04 · ${copy.sections.safety}`}</h2>
        {risk ? <span className="ui-section-badge">{s.recheck(wibClock(risk.computedAt))}</span> : null}
      </div>
      {risk === null ? (
        <div className="ui-section-body">
          <p className="muted">{s.notAssessed}</p>
        </div>
      ) : (
        <>
          <Strip numbers={safetyStrip(risk, links, sourceUrls)} />
          <div className="ui-section-body detail-safety-body">
            <p className="muted">{coverageLine(risk.checks.map(({ id, ran }) => ({ id, ran })))}</p>
            <Reasons reasons={risk.reasons} />
            {member && scamFlags && scamFlags.length > 0 ? (
              <ul className="detail-scam-flags" aria-label={s.scamFlags}>
                {scamFlags.map((f, i) => (
                  <li key={i}>
                    <span>{f.explanation}</span> <span className="detail-quote">{`"${f.quote}"`}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="detail-must-pass">
              <span className="detail-must-pass-badge">{s.mustPass}</span>
              <span>{s.mustPassNote}</span>
            </p>
            <div className="detail-key-checks">
              {KEY_ORDER.map((id, i) => {
                const card = keyCard(id, risk.checks.find((c) => c.id === id), risk.computedAt);
                return (
                  <div key={id} className="detail-key-check" data-testid="key-check" data-tone={card.tone}>
                    <div className="detail-key-check-head">
                      <span className="ui-display" data-part="code">
                        {s.code(i + 1)}
                      </span>
                      <span className="ui-section-badge" data-part="source">
                        {s.sources[id]}
                      </span>
                    </div>
                    <div className="detail-key-check-body">
                      <b data-part="title">{labels.checks[id]}</b>
                      <span className="detail-key-check-result ui-display" data-part="result">
                        {card.result}
                      </span>
                      {card.detail ? <span data-part="detail">{card.detail}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <h3 className="detail-subhead">{s.advanced}</h3>
            <ul className="detail-advanced" aria-label={s.advanced}>
              {risk.checks
                .filter((c): c is DetailCheck & { id: AdvancedId } => c.ran && !(KEY_ORDER as readonly string[]).includes(c.id))
                .map((c) => (
                  <li key={c.id} data-flagged={c.flagged ? "true" : undefined}>
                    <span className="detail-advanced-text">
                      <b data-part="title">{s.advancedTitles[c.id]}</b>
                      <span>{s.advancedNotes[c.id]}</span>
                    </span>
                    {member ? (
                      <span className="detail-advanced-result">
                        <span className="ui-display" data-part="result" data-tone={c.flagged ? "warn" : "pass"}>
                          {advancedResult(c)}
                        </span>
                        <span className="ui-section-badge" data-part="source">
                          {s.sources[c.id]}
                        </span>
                      </span>
                    ) : c.flagged ? (
                      <span className="detail-advanced-flagged">{s.flaggedPublic}</span>
                    ) : (
                      <span className="detail-member-stamp" data-part="stamp">
                        {ui.memberOnly}
                      </span>
                    )}
                  </li>
                ))}
            </ul>

            {checkedLinks.length > 0 ? (
              <>
                <h3 className="detail-subhead">{s.links}</h3>
                <ul className="detail-links" aria-label={s.links}>
                  {checkedLinks.map((l) => (
                    <li key={l.url}>
                      <LinkStatus status={l.status ?? "unchecked"} url={l.url} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function Strip({ numbers }: { numbers: ReturnType<typeof safetyStrip> }) {
  const items = [
    [s.strip.layers, numbers.layers],
    [s.strip.sources, numbers.sources],
    [s.strip.links, numbers.links],
    [s.strip.redFlags, numbers.redFlags],
  ] as const;
  return (
    <ul className="detail-strip" aria-label={s.stripLabel}>
      {items.map(([label, value]) => (
        <li key={label}>
          <span className="ui-display" data-part="value">
            {value}
          </span>
          <span data-part="label">{label}</span>
        </li>
      ))}
    </ul>
  );
}
