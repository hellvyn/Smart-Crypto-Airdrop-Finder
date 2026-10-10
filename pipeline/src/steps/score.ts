import pLimit from "p-limit";
import { assessRisk, registrableDomain } from "@saf/core";
import type { RiskInput } from "@saf/core";
import type { Http } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import { firstCertificateAgeDays } from "../enrich/crtsh.js";
import { GOPLUS_MIN_INTERVAL_MS, checkPhishingSite, defaultSleep } from "../enrich/goplus.js";
import { countHacks, fetchHacks } from "../enrich/hacks.js";
import { domainAgeDays } from "../enrich/rdap.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";
import { LINK_KINDS } from "./merge.js";
import type { LinkKind } from "./merge.js";

/** Maximum parallel enrichment requests (RDAP and crt.sh domain age, DefiLlama hacks). */
const ENRICH_CONCURRENCY = 4;
/** GoPlus rate-limits hard, so it has its own limiter and runs one request at a time. */
const GOPLUS_CONCURRENCY = 1;

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
 * Domain age comes from RDAP, and from the first crt.sh certificate when RDAP has no answer.
 * One project failing to save counts as `score_failed` and does not stop the others.
 */
export async function scoreProjects(
  deps: { repo: PipelineRepo; http: Http; sleep?: (ms: number) => Promise<void> },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
): Promise<void> {
  const { repo, http } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const projects = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
  if (projects.length === 0) return;

  const domainsByProject = new Map(projects.map((p) => [p.id, linkDomains(p)]));
  // Social platforms (x.com, t.me, ...) are not the project's own domains: no phishing or age lookups.
  const enrichDomains = (links: RiskInput["linkDomains"]): string[] =>
    [...new Set(links.filter((l) => l.kind !== "social").map((l) => l.domain))];
  const domains = [...new Set([...domainsByProject.values()].flatMap(enrichDomains))];

  const limit = pLimit(ENRICH_CONCURRENCY);
  const goplusLimit = pLimit(GOPLUS_CONCURRENCY);
  const phishing = new Map<string, boolean | null>();
  let goplusStarted = false;
  const ages = new Map<string, number | null>();
  const agesFromCrtsh = new Set<string>();
  const [hacks] = await Promise.all([
    limit(() => fetchHacks(http)),
    ...domains.flatMap((domain) => [
      goplusLimit(async () => {
        // The limiter runs these one at a time; leave a pause between consecutive requests (GoPlus rate-limits bursts).
        if (goplusStarted) await sleep(GOPLUS_MIN_INTERVAL_MS);
        goplusStarted = true;
        phishing.set(
          domain,
          await checkPhishingSite(http, `https://${domain}`, sleep, () => void (stats.phishing_list_rate_limited += 1)),
        );
      }),
      limit(async () => {
        let age = await domainAgeDays(http, domain, now);
        if (age === null) {
          age = await firstCertificateAgeDays(http, domain, now);
          if (age !== null) agesFromCrtsh.add(domain);
        }
        ages.set(domain, age);
      }),
    ]),
  ]);

  stats.domain_age_from_crtsh = agesFromCrtsh.size;
  stats.phishing_list_failed = domains.filter((d) => phishing.get(d) === null).length;
  for (const project of projects) {
    if (project.officialDomains.length === 0) continue;
    stats.projects_with_official_domain += 1;
    if (project.officialDomains.some((d) => ages.get(d) != null)) stats.domain_age_ran += 1;
    if (project.officialDomains.some((d) => phishing.get(d) != null)) stats.phishing_list_ran += 1;
  }

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
