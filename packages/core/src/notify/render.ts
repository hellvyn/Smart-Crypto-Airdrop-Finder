// Digest email rendering: pure. Links are built only from `siteUrl` and `unsubscribeUrl`,
// never from scraped data. Every interpolated value is HTML-escaped.
import type { DigestProject, Digest } from "./digest.js";

export interface RenderOptions {
  siteUrl: string;
  unsubscribeUrl: string;
}
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Labels mirror apps/web/lib/view.ts.
const STATUS_LABELS: Record<string, string> = {
  live: "Live",
  announced: "Announced",
  speculative: "Speculative",
  ended: "Ended",
  unknown: "Unconfirmed",
};
const RISK_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
  insufficient_data: "Insufficient data",
};
const KIND_LABELS: Record<string, string> = {
  claim: "Claim",
  snapshot: "Snapshot",
  campaign_end: "Campaign end",
  withdraw_funds: "Withdraw funds",
};

const own = (map: Record<string, string>, key: string | null, fallback: string): string =>
  key !== null && Object.prototype.hasOwnProperty.call(map, key) ? (map[key] as string) : fallback;
const statusLabel = (s: string | null): string => own(STATUS_LABELS, s, "Unconfirmed");
const riskLabel = (l: string | null): string => own(RISK_LABELS, l, "Not assessed");
const kindLabel = (k: string): string => own(KIND_LABELS, k, k.replaceAll("_", " "));

const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const T_DEADLINES = "Deadlines in the next 48 hours";
const T_CHANGES = "Status and risk changes";
const T_NEW = "New airdrops today";
const FOOTER = "You get this email because daily digest is on.";

interface Row {
  project: DigestProject;
  detail: string; // text after the project name
}

export function renderDigestEmail(d: Digest, opts: RenderOptions): RenderedEmail {
  const base = opts.siteUrl.replace(/\/+$/, "");
  const link = (p: DigestProject): string => `${base}/projects/${encodeURIComponent(p.slug)}`;

  const n = d.deadlinesSoon.length;
  const subject =
    n > 0 ? `Airdrop digest: ${n} deadline${n === 1 ? "" : "s"} in the next 48h` : "Airdrop digest: updates on your watchlist";

  const sections: { title: string; rows: Row[]; plain: (r: Row) => string }[] = [];
  if (n > 0) {
    sections.push({
      title: T_DEADLINES,
      rows: d.deadlinesSoon.map((x) => ({
        project: x.project,
        detail: `${kindLabel(x.kind)}, ${x.isToday ? "today" : `${x.precision === "approximate" ? "around " : ""}${x.date}`}`,
      })),
      plain: (r) => `${r.project.name}: ${r.detail}`,
    });
  }
  if (d.changes.length > 0) {
    sections.push({
      title: T_CHANGES,
      rows: d.changes.map((c) => ({
        project: c.project,
        detail:
          c.field === "status"
            ? `status ${statusLabel(c.oldValue)} → ${statusLabel(c.newValue)}`
            : `risk ${riskLabel(c.oldValue)} → ${riskLabel(c.newValue)}`,
      })),
      plain: (r) => `${r.project.name}: ${r.detail}`,
    });
  }
  if (d.newProjects.length > 0) {
    sections.push({
      title: T_NEW,
      rows: d.newProjects.map((p) => ({
        project: p,
        detail: `${statusLabel(p.status)}, risk ${riskLabel(p.riskLevel)}`,
      })),
      plain: (r) => `${r.project.name} (${r.detail})`,
    });
  }

  const textParts: string[] = [];
  for (const s of sections) {
    const lines = [s.title, ...s.rows.flatMap((r) => [`- ${s.plain(r)}`, `  ${link(r.project)}`])];
    textParts.push(lines.join("\n"));
  }
  textParts.push(`${FOOTER} Unsubscribe: ${opts.unsubscribeUrl}`);
  const text = textParts.join("\n\n") + "\n";

  const TD = 'style="padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:14px;color:#222222;"';
  const A = 'style="color:#1a56db;"';
  const htmlSections = sections
    .map((s) => {
      const rows = s.rows
        .map((r) => {
          const name = `<a href="${esc(link(r.project))}" ${A}>${esc(r.project.name)}</a>`;
          // Changes read "<Project>: status A → B"; other sections keep the name and detail in separate cells.
          if (s.title === T_CHANGES) return `<tr><td ${TD}>${name}: ${esc(r.detail)}</td></tr>`;
          return `<tr><td ${TD}>${name}</td><td ${TD}>${esc(r.detail)}</td></tr>`;
        })
        .join("");
      return (
        `<h2 style="font-size:16px;margin:24px 0 8px;color:#111111;">${esc(s.title)}</h2>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>`
      );
    })
    .join("");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:16px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">` +
    `<div style="max-width:600px;margin:0 auto;">` +
    `<h1 style="font-size:20px;margin:0 0 8px;color:#111111;">${esc(subject)}</h1>` +
    htmlSections +
    `<p style="margin:32px 0 0;font-size:12px;color:#666666;">${esc(FOOTER)} ` +
    `Unsubscribe: <a href="${esc(opts.unsubscribeUrl)}" ${A}>${esc(opts.unsubscribeUrl)}</a></p>` +
    `</div></body></html>`;

  return { subject, text, html };
}
