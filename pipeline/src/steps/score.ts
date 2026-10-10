import pLimit from "p-limit";
import { assessRisk, registrableDomain } from "@saf/core";
import type { RiskInput } from "@saf/core";
import type { Http } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import { checkPhishingSite } from "../enrich/goplus.js";
import { countHacks, fetchHacks } from "../enrich/hacks.js";
import { domainAgeDays } from "../enrich/rdap.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";
import { LINK_KINDS } from "./merge.js";
import type { LinkKind } from "./merge.js";

/** Maximum parallel enrichment requests (GoPlus, RDAP, DefiLlama hacks). */
const ENRICH_CONCURRENCY = 4;

function linkDomains(project: ProjectForScoring): RiskInput["linkDomains"] {
  const seen = new Set<string>();
  const out: RiskInput["linkDomains"] = [];
  for (const link of project.links) {
    const domain = registrableDomain(link.url);
    if (domain === null) continue;
    const kind: LinkKind = (LINK_KINDS as readonly string[]).includes(link.kind) ? (link.kind as LinkKind) : "website";
    const key = `${domain} ${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain, kind });
  }
  return out;
}

/**
 * Scores every project seen within `scoreActiveSinceDays`. Enrichment is fetched once per registrable
 * domain per run (the job is daily, so this replaces a longer-lived cache), and hacks once per run.
 * One project failing to save counts as `score_failed` and does not stop the others.
 */
export async function scoreProjects(
  deps: { repo: PipelineRepo; http: Http },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
): Promise<void> {
  const { repo, http } = deps;
  const projects = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
  if (projects.length === 0) return;

  const domainsByProject = new Map(projects.map((p) => [p.id, linkDomains(p)]));
  // Social platforms (x.com, t.me, ...) are not the project's own domains: no phishing or age lookups.
  const enrichDomains = (links: RiskInput["linkDomains"]): string[] =>
    [...new Set(links.filter((l) => l.kind !== "social").map((l) => l.domain))];
  const domains = [...new Set([...domainsByProject.values()].flatMap(enrichDomains))];

  const limit = pLimit(ENRICH_CONCURRENCY);
  const phishing = new Map<string, boolean | null>();
  const ages = new Map<string, number | null>();
  const [hacks] = await Promise.all([
    limit(() => fetchHacks(http)),
    ...domains.flatMap((domain) => [
      limit(async () => phishing.set(domain, await checkPhishingSite(http, `https://${domain}`))),
      limit(async () => ages.set(domain, await domainAgeDays(http, domain, now))),
    ]),
  ]);

  for (const project of projects) {
    const projectLinks = domainsByProject.get(project.id) ?? [];
    const projectDomains = enrichDomains(projectLinks);
    try {
      const input: RiskInput = {
        project: {
          name: project.name,
          officialDomains: project.officialDomains,
          status: project.status,
          tokenSymbol: project.tokenSymbol,
          conflict: project.conflict,
          sourceCount: project.sourceCount,
          hasOfficialSocial: projectLinks.some((l) => l.kind === "social"),
          lookalikeOf: project.lookalikeOf,
          lookalikeOfName: project.lookalikeOfName,
          lookalikeOfDomains: project.lookalikeOfDomains,
        },
        tasks: project.tasks,
        sourceAsks: project.sourceAsks,
        linkDomains: projectLinks,
        domainAgeDays: Object.fromEntries(projectDomains.map((d) => [d, ages.get(d) ?? null])),
        phishingFlags: Object.fromEntries(projectDomains.map((d) => [d, phishing.get(d) ?? null])),
        token: null,
        contractVerified: null,
        hackCount: hacks ? countHacks(hacks, project.name) : null,
      };
      await repo.saveRiskAssessment(project.id, assessRisk(input), now);
      stats.assessed += 1;
    } catch {
      stats.score_failed += 1;
    }
  }
}
