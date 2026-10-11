import { createHash } from "node:crypto";
import {
  decideMerge,
  deriveStatus,
  findDangerousAskSentences,
  normalizeName,
  pickEvidenceDate,
  registrableDomain,
} from "@saf/core";
import type { ExtractedDeadline, Status } from "@saf/core";
import { isNonProjectHost } from "../collectors/html-text.js";
import type { DailyStats } from "../stats.js";
import { FACT_FIELDS } from "../store/repo.js";
import type { Fact, PipelineRepo, ProjectRow, Step, StoredDocument } from "../store/repo.js";

export type LinkKind = "website" | "app" | "docs" | "claim" | "social";

export const LINK_KINDS: readonly LinkKind[] = ["website", "app", "docs", "claim", "social"];

const SOCIAL_HOSTS: ReadonlySet<string> = new Set([
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.me",
  "discord.gg",
  "discord.com",
  "medium.com",
  "github.com",
  "youtube.com",
  "linktr.ee",
]);

/** Heuristic link kind from host and path. Returns null for unparseable URLs. */
export function classifyLink(url: string): LinkKind | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.toLowerCase();
  if (SOCIAL_HOSTS.has(host)) return "social";
  if (host.startsWith("claim.") || path.includes("/claim")) return "claim";
  if (host.startsWith("docs.") || path.startsWith("/docs")) return "docs";
  const registrable = registrableDomain(url);
  const hasSubdomain = registrable !== null && host !== registrable;
  if (host.startsWith("app.") || (hasSubdomain && path !== "/")) return "app";
  return "website";
}

/** Kebab-case ASCII slug base (diacritics folded); a stable hash slug for names without ASCII letters or digits. */
export function slugBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base !== "") return base;
  return `p-${createHash("sha256").update(name.normalize("NFKC")).digest("hex").slice(0, 10)}`;
}

/** First free slug among base, base-2, base-3, ... Slugs are unique across all projects, whatever their name key. */
export async function pickSlug(name: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugBase(name);
  if (!(await exists(base))) return base;
  for (let n = 2; ; n++) {
    const slug = `${base}-${n}`;
    if (!(await exists(slug))) return slug;
  }
}

/** Multi-tenant platforms (forms, quest boards, page hosts): a link there never makes the platform an official domain. */
const PLATFORM_DOMAINS: readonly string[] = [
  "google.com",
  "forms.gle",
  "galxe.com",
  "zealy.io",
  "gleam.io",
  "typeform.com",
  "notion.site",
  "notion.so",
  "linktr.ee",
];

function isPlatformDomain(domain: string): boolean {
  return PLATFORM_DOMAINS.some((p) => domain === p || domain.endsWith(`.${p}`));
}

export interface ProjectInput {
  name: string;
  tokenSymbol: string | null;
  chains: string[];
  status: Status;
  /** Quote that supports `status`. */
  quote: string;
  /** Ordered steps, stored as `tasks` rows. */
  steps: Step[];
  /** v3 facts, stored as evidence; each `field` is one of `FACT_FIELDS`. */
  facts: Fact[];
  deadlines: ExtractedDeadline[];
  /** Cleaned official URLs; their kinds come from `classifyLink`. */
  urls: string[];
  /** Cleaned URL that is the project's website whatever its path (the DefiLlama `url`), or null. */
  websiteUrl: string | null;
  /**
   * `defillama`: a listing without a confirmed status. On an existing project its evidence is stored as
   * `defillama_listing`, so `deriveStatus` ignores it; only a newly created project gets `status` evidence.
   */
  source: "extraction" | "defillama";
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

/** Link kinds whose domains can become official. Claim links never do: a claim page is what phishing imitates. */
const OFFICIAL_KINDS: ReadonlySet<LinkKind> = new Set<LinkKind>(["website", "app", "docs"]);

/** Classified links of one input: the website URL first (as `website` unless it is a social host), then `urls`. */
function inputLinks(input: ProjectInput): { url: string; kind: LinkKind }[] {
  const links: { url: string; kind: LinkKind }[] = [];
  if (input.websiteUrl !== null) {
    const kind = classifyLink(input.websiteUrl);
    if (kind !== null) links.push({ url: input.websiteUrl, kind: kind === "social" ? "social" : "website" });
  }
  for (const url of input.urls) {
    const kind = classifyLink(url);
    if (kind !== null) links.push({ url, kind });
  }
  return links;
}

/**
 * Finds or creates the project for one input and applies chains, token and status evidence.
 *
 * Official domains (registrable domains of website, app and docs links, never claim, social or platform
 * hosts, nor links on a non-project host such as `s.kaito.ai` or `alphadrops.net`; see `isNonProjectHost`) are
 * only set while the project has none: on creation, or on an existing project with an empty list. A project
 * that already has official domains never gains new ones automatically, so a phishing domain listed next to the
 * real one cannot whitelist itself.
 *
 * Before the first status evidence of this (project, document) pair is written in this merge, the
 * document's earlier evidence for that field is deleted, so a page that changed replaces its own claim.
 */
async function mergeProject(
  repo: PipelineRepo,
  input: ProjectInput,
  document: StoredDocument,
  now: Date,
  stats: DailyStats,
  cleared: Set<string>,
  intermediaryHosts: readonly string[],
): Promise<{ id: string; links: { url: string; kind: LinkKind }[] } | null> {
  const nameKey = normalizeName(input.name);
  if (nameKey === "") return null;

  const links = inputLinks(input);
  const officialDomains = [
    ...new Set(
      links
        .filter((l) => OFFICIAL_KINDS.has(l.kind) && !isNonProjectHost(new URL(l.url).hostname, intermediaryHosts))
        .flatMap((l) => registrableDomain(l.url) ?? [])
        .filter((d) => !isPlatformDomain(d)),
    ),
  ];

  const existing = await repo.findProjectsByNameKey(nameKey);
  const decision = decideMerge(
    { nameKey, domains: officialDomains },
    existing.map((p) => ({ id: p.id, nameKey: p.nameKey, domains: p.officialDomains })),
  );
  // A DefiLlama listing is undated, weak evidence: date it at the epoch so any dated airdrops.io or
  // Telegram evidence outranks it in deriveStatus, even when that page's "Updated" date is old.
  const at = input.source === "defillama" ? new Date(0) : pickEvidenceDate(document);

  let project: ProjectRow;
  let evidenceField = "status";
  if (decision.action === "create") {
    const initial = deriveStatus([{ status: input.status, at }], null);
    project = await repo.createProject(
      {
        slug: await pickSlug(input.name, (slug) => repo.slugExists(slug)),
        name: input.name,
        nameKey,
        tokenSymbol: input.tokenSymbol,
        chains: union([], input.chains),
        officialDomains,
        status: initial.status,
        conflict: false,
        lookalikeOf: decision.lookalikeOf,
      },
      now,
    );
    stats.projects_created += 1;
  } else {
    const match = existing.find((p) => p.id === decision.projectId);
    if (!match) throw new Error("merge target not found");
    project = match;
    stats.projects_updated += 1;
    if (input.source === "defillama") evidenceField = "defillama_listing";
  }

  const clearKey = `${project.id} ${evidenceField}`;
  if (!cleared.has(clearKey)) {
    await repo.deleteEvidence(project.id, document.id, evidenceField);
    cleared.add(clearKey);
  }
  await repo.addEvidence({
    projectId: project.id,
    documentId: document.id,
    field: evidenceField,
    value: input.status,
    quote: input.quote,
    at,
  });
  const derived = deriveStatus(await repo.listStatusEvidence(project.id), project.status);
  await repo.updateProject(
    project.id,
    {
      status: derived.status,
      conflict: derived.conflict,
      chains: union(project.chains, input.chains),
      officialDomains: project.officialDomains.length > 0 ? project.officialDomains : officialDomains,
      tokenSymbol: project.tokenSymbol ?? input.tokenSymbol,
      lastSeen: now,
    },
    now,
  );
  return { id: project.id, links };
}

/**
 * Merges every project a document mentions. Deadlines, steps and v3 facts are replaced per (project, document),
 * accumulated first so two mentions of the same project in one document do not overwrite each other. Steps keep
 * their order (a step text already listed by an earlier mention is skipped). Facts follow the `status` pattern:
 * every `FACT_FIELDS` evidence row of this document is deleted, then the new facts are written, so a fact the page
 * no longer states disappears. An input without facts or steps is no error.
 *
 * When the document yields exactly one project, its text is also scanned for dangerous asks (spec section 6:
 * text and LLM output), stored as `dangerous_ask` evidence (value = ask code, quote = the sentence). A
 * document about several projects cannot tell whose ask it is, so nothing is attributed. Earlier
 * `dangerous_ask` evidence of this document is replaced either way. DefiLlama documents skip the ask scan and
 * the fact replacement: their text is our own summary and never goes through extraction.
 * `intermediaryHosts` (the config's `alphadrops.intermediaryHosts`) never become official domains.
 */
export async function mergeDocument(
  repo: PipelineRepo,
  document: StoredDocument,
  inputs: ProjectInput[],
  now: Date,
  stats: DailyStats,
  intermediaryHosts: readonly string[],
): Promise<void> {
  const touched = new Map<
    string,
    { deadlines: ExtractedDeadline[]; steps: Step[]; facts: Fact[]; links: { url: string; kind: LinkKind }[] }
  >();
  const cleared = new Set<string>();
  for (const input of inputs) {
    const merged = await mergeProject(repo, input, document, now, stats, cleared, intermediaryHosts);
    if (merged === null) continue;
    const acc = touched.get(merged.id) ?? { deadlines: [], steps: [], facts: [], links: [] };
    acc.deadlines.push(...input.deadlines);
    for (const step of input.steps) if (!acc.steps.some((s) => s.text === step.text)) acc.steps.push(step);
    acc.facts.push(...input.facts);
    acc.links.push(...merged.links);
    touched.set(merged.id, acc);
  }
  const extracted = document.sourceKind !== "defillama";
  const asks = extracted && touched.size === 1 ? findDangerousAskSentences(document.text) : [];
  for (const [projectId, acc] of touched) {
    if (extracted) {
      await repo.deleteEvidence(projectId, document.id, "dangerous_ask");
      for (const ask of asks) {
        await repo.addEvidence({
          projectId,
          documentId: document.id,
          field: "dangerous_ask",
          value: ask.code,
          quote: ask.sentence,
          at: pickEvidenceDate(document),
        });
      }
      for (const field of FACT_FIELDS) await repo.deleteEvidence(projectId, document.id, field);
      for (const fact of acc.facts) {
        await repo.addEvidence({ projectId, documentId: document.id, ...fact, at: pickEvidenceDate(document) });
      }
    }
    await repo.replaceDeadlines(projectId, document.id, acc.deadlines);
    await repo.replaceTasks(projectId, document.id, acc.steps);
    await repo.upsertLinks(
      projectId,
      acc.links.map((l) => ({ url: l.url, kind: l.kind, referralStripped: false })),
    );
  }
}
