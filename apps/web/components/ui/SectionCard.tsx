import type { ReactNode } from "react";

/** A ruled card with a numbered title ("01 · AI verdict") and an optional source badge. */
export function SectionCard({
  number,
  title,
  badge,
  children,
}: {
  number?: string;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section className="ui-section-card">
      <div className="ui-section-head">
        <h2 className="ui-display ui-section-title">{number ? `${number} · ${title}` : title}</h2>
        {badge ? <span className="ui-section-badge">{badge}</span> : null}
      </div>
      <div className="ui-section-body">{children}</div>
    </section>
  );
}
