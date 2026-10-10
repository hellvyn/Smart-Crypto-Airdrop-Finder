import { createHash } from "node:crypto";
import { decideMerge, deriveStatus, normalizeName, pickEvidenceDate, registrableDomain } from "@saf/core";
import type { ExtractedDeadline, Status } from "@saf/core";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectRow, StoredDocument } from "../store/repo.js";

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

/**
 * Kebab-case slug of the name (ASCII letters and digits, diacritics folded). Names without any
 * ASCII letter or digit get a stable hash slug. `taken` are the slugs of projects with the same
 * name key; a clash appends -2, -3, ...
 */
export function pickSlug(name: string, taken: readonly string[]): string {
  let base = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base === "") {
    base = `p-${createHash("sha256").update(name.normalize("NFKC")).digest("hex").slice(0, 10)}`;
  }
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const slug = `${base}-${n}`;
    if (!used.has(slug)) return slug;
  }
}

export interface ProjectInput {
  name: string;
  tokenSymbol: string | null;
  chains: string[];
  status: Status;
  /** Quote that supports `status`. */
  quote: string;
  tasks: string[];
  deadlines: ExtractedDeadline[];
  /** Cleaned official URLs. */
  urls: string[];
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

/** Finds or creates the project for one input and applies chains, domains, token and status evidence. */
async function mergeProject(
  repo: PipelineRepo,
  input: ProjectInput,
  document: StoredDocument,
  now: Date,
  stats: DailyStats,
): Promise<{ id: string; links: { url: string; kind: LinkKind }[] } | null> {
  const nameKey = normalizeName(input.name);
  if (nameKey === "") return null;

  const links: { url: string; kind: LinkKind }[] = [];
  for (const url of input.urls) {
    const kind = classifyLink(url);
    if (kind !== null) links.push({ url, kind });
  }
  const officialDomains = [
    ...new Set(
      links.filter((l) => l.kind !== "social").flatMap((l) => registrableDomain(l.url) ?? []),
    ),
  ];

  const existing = await repo.findProjectsByNameKey(nameKey);
  const decision = decideMerge(
    { nameKey, domains: officialDomains },
    existing.map((p) => ({ id: p.id, nameKey: p.nameKey, domains: p.officialDomains })),
  );
  const at = pickEvidenceDate(document);

  let project: ProjectRow;
  if (decision.action === "create") {
    const initial = deriveStatus([{ status: input.status, at }], null);
    project = await repo.createProject(
      {
        slug: pickSlug(input.name, existing.map((p) => p.slug)),
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
  }

  await repo.addEvidence({
    projectId: project.id,
    documentId: document.id,
    field: "status",
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
      officialDomains: union(project.officialDomains, officialDomains),
      tokenSymbol: project.tokenSymbol ?? input.tokenSymbol,
      lastSeen: now,
    },
    now,
  );
  return { id: project.id, links };
}

/**
 * Merges every project a document mentions. Deadlines and tasks are replaced per (project, document),
 * accumulated first so two mentions of the same project in one document do not overwrite each other.
 */
export async function mergeDocument(
  repo: PipelineRepo,
  document: StoredDocument,
  inputs: ProjectInput[],
  now: Date,
  stats: DailyStats,
): Promise<void> {
  const touched = new Map<
    string,
    { deadlines: ExtractedDeadline[]; tasks: string[]; links: { url: string; kind: LinkKind }[] }
  >();
  for (const input of inputs) {
    const merged = await mergeProject(repo, input, document, now, stats);
    if (merged === null) continue;
    const acc = touched.get(merged.id) ?? { deadlines: [], tasks: [], links: [] };
    acc.deadlines.push(...input.deadlines);
    for (const task of input.tasks) if (!acc.tasks.includes(task)) acc.tasks.push(task);
    acc.links.push(...merged.links);
    touched.set(merged.id, acc);
  }
  for (const [projectId, acc] of touched) {
    await repo.replaceDeadlines(projectId, document.id, acc.deadlines);
    await repo.replaceTasks(projectId, document.id, acc.tasks);
    await repo.upsertLinks(
      projectId,
      acc.links.map((l) => ({ url: l.url, kind: l.kind, referralStripped: false })),
    );
  }
}
