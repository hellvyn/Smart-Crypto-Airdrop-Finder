// Project logos (owner request 2026-10-11): one image per project for the /airdrops cards, stored in `project_logos`
// and served by the web from its own route, so a visitor's browser never contacts a project domain.
//
// Tiers, first usable one wins: (1) the logo of the DefiLlama protocol matched by official domain (the `tvl` signal's
// match), from icons.llama.fi only; (2) the avatar of the project's one X account through unavatar.io; (3) the favicon
// of an official domain whose GoPlus phishing check in this run was clean. Every download goes through `FetchImage`
// (https, 5 s, 2 redirects on allowed hosts, 64 KB, magic bytes, never SVG).
import pLimit from "p-limit";
import { registrableDomain } from "@saf/core";
import type { DefillamaProtocol } from "../collectors/defillama.js";
import type { PipelineConfig } from "../config.js";
import type { FetchImage, LogoImage } from "../http.js";
import type { DailyStats } from "../stats.js";
import type { LogoSource, PipelineRepo, ProjectForScoring } from "../store/repo.js";
import { matchingProtocols } from "./signals.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** A stored logo younger than this is not fetched again (at most one refresh per project per week). */
const LOGO_FRESH_MS = 7 * DAY_MS;
/** The only host DefiLlama logos are downloaded from, redirects included. */
const LLAMA_ICONS_HOST = "icons.llama.fi";
/**
 * Hosts an unavatar.io answer may come from: unavatar.io and its subdomains (its own CDN), and pbs.twimg.com, X's
 * image CDN, where X avatars live, in case unavatar answers with a redirect to the original instead of the bytes.
 */
const isUnavatarHost = (host: string): boolean =>
  host === "unavatar.io" || host.endsWith(".unavatar.io") || host === "pbs.twimg.com";
/** Tried in this order on each clean official domain. HTML is never read to find another icon. */
const FAVICON_PATHS = ["/apple-touch-icon.png", "/favicon.ico"] as const;

/** Hosts of X profile links; the handle is the first path segment. */
const X_HOSTS: ReadonlySet<string> = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/** First path segments of x.com pages that are not accounts. */
const X_RESERVED: ReadonlySet<string> = new Set([
  "i",
  "home",
  "search",
  "intent",
  "share",
  "explore",
  "hashtag",
  "settings",
  "messages",
  "notifications",
  "compose",
  "login",
  "logout",
  "signup",
  "tos",
  "privacy",
  "about",
  "download",
  "account",
]);

/**
 * The project's X handle, from its own `social` links on x.com or twitter.com (extraction copies them verbatim from
 * the source text) that are profile URLs: the one path segment when it is a valid handle (letters, digits, `_`, at most 15) and not a
 * reserved path. Handles are compared ignoring case (X does), and the first spelling is kept. Null when there is none,
 * or when there are several different ones: which account is the project's would be a guess.
 */
export function xHandle(links: { url: string; kind: string }[]): string | null {
  const handles = new Map<string, string>();
  for (const link of links) {
    if (link.kind !== "social") continue;
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !X_HOSTS.has(url.hostname.toLowerCase())) continue;
    // A profile URL only: exactly one path segment (a trailing slash is fine). A tweet (`/other/status/1`) or a
    // profile sub-page names an account that need not be the project's.
    const segments = url.pathname.split("/").filter((part) => part !== "");
    if (segments.length !== 1) continue;
    const first = segments[0]!;
    if (!X_HANDLE.test(first) || X_RESERVED.has(first.toLowerCase())) continue;
    if (!handles.has(first.toLowerCase())) handles.set(first.toLowerCase(), first);
  }
  return handles.size === 1 ? [...handles.values()][0]! : null;
}

/** The logo URL of the first matched protocol that has one on https://icons.llama.fi (default port); else null. */
function defillamaLogo(project: ProjectForScoring, protocols: DefillamaProtocol[]): string | null {
  for (const protocol of matchingProtocols(project, protocols)) {
    if (protocol.logo === null) continue;
    try {
      const url = new URL(protocol.logo);
      if (url.protocol === "https:" && url.hostname === LLAMA_ICONS_HOST && url.port === "") return url.href;
    } catch {
      // Not a URL: no logo from this protocol.
    }
  }
  return null;
}

type Outcome = { source: LogoSource; image: LogoImage } | "failed" | "deferred" | "none";

/** One project due for a logo, with what orders the queue. */
interface Candidate {
  project: ProjectForScoring;
  /** Its latest curation passed: it is on the list, so its card is seen. */
  listed: boolean;
  /** It was tried before (an attempt, or a stored logo). */
  tried: boolean;
  /** When it was last tried (the attempt, else the stored logo), in ms; 0 when never. Always finite. */
  since: number;
}

/** Listed first, then never tried, then the oldest attempt or logo, then by id. A total order on finite numbers. */
function queueOrder(a: Candidate, b: Candidate): number {
  if (a.listed !== b.listed) return a.listed ? -1 : 1;
  if (a.tried !== b.tried) return a.tried ? 1 : -1;
  if (a.since !== b.since) return a.since - b.since;
  return a.project.id < b.project.id ? -1 : a.project.id > b.project.id ? 1 : 0;
}

/**
 * The `logos` stage. A project is due when neither its stored logo nor its latest attempt (`project_logo_attempts`) is
 * younger than 7 days, so a project whose tiers all failed waits a week before it is tried again. Due projects go in
 * this order: listed (latest curation passed) before the others, never tried before tried, then the oldest attempt or
 * logo first. A few at a time (`config.logos.concurrency`), each project:
 * - tries the tiers in order and stores the first usable image (`logos_fetched`, and `logos_defillama`,
 *   `logos_x_avatar` or `logos_favicon`), recording a `stored` attempt; when none is usable the stored logo, if any,
 *   stays and a `failed` attempt is recorded (`logos_failed`);
 * - asks unavatar.io at most `maxXAvatarsPerRun` times a run (`logos_x_avatar_requests`, of which
 *   `logos_x_avatar_failed` gave nothing). A project whose X avatar comes after that goes on to its favicon
 *   (`logos_x_avatar_deferred`); the weekly refresh can upgrade it to the X avatar later. When that leaves it with
 *   nothing, no attempt is recorded, so it is tried again (X avatar first) on the next run;
 * - starts no project after `budgetMinutes` (by `deps.now()`, from the start of the stage); those wait for the next
 *   run (`logos_skipped`).
 * A project with nothing to try counts nowhere. A project whose logo or attempt cannot be stored counts as
 * `logos_failed`; the others go on. `phishing` holds the GoPlus answers of this run's `score` stage by registrable
 * domain: only `false` (checked, not listed) lets a favicon be asked.
 */
export async function refreshLogos(
  deps: { repo: PipelineRepo; fetchImage: FetchImage; now: () => Date },
  config: PipelineConfig,
  projects: ProjectForScoring[],
  ctx: { protocols: DefillamaProtocol[] | null; phishing: ReadonlyMap<string, boolean | null> },
  now: Date,
  stats: DailyStats,
): Promise<void> {
  const { repo, fetchImage } = deps;
  const ids = projects.map((p) => p.id);
  const [logos, attempts, listedIds] = await Promise.all([
    repo.listProjectLogos(ids),
    repo.listLogoAttempts(ids),
    repo.listListedProjects(ids),
  ]);
  const logoAt = new Map(logos.map((r) => [r.projectId, r.fetchedAt.getTime()]));
  const attemptAt = new Map(attempts.map((r) => [r.projectId, r.attemptedAt.getTime()]));
  const listed = new Set(listedIds);
  const fresh = (at: number | undefined): boolean => at !== undefined && now.getTime() - at < LOGO_FRESH_MS;
  const due: Candidate[] = projects
    .filter((p) => !fresh(logoAt.get(p.id)) && !fresh(attemptAt.get(p.id)))
    .map((project) => {
      const last = attemptAt.get(project.id) ?? logoAt.get(project.id);
      return { project, listed: listed.has(project.id), tried: last !== undefined, since: last ?? 0 };
    })
    .sort(queueOrder);

  let xRequests = 0;
  const logoFor = async (project: ProjectForScoring): Promise<Outcome> => {
    let tried = false;
    let deferred = false;
    const attempt = (url: string, allowHost: (host: string) => boolean): Promise<LogoImage | null> => {
      tried = true;
      return fetchImage(url, allowHost);
    };

    const llama = ctx.protocols === null ? null : defillamaLogo(project, ctx.protocols);
    if (llama !== null) {
      const image = await attempt(llama, (host) => host === LLAMA_ICONS_HOST);
      if (image !== null) return { source: "defillama", image };
    }

    const handle = xHandle(project.links);
    if (handle !== null) {
      if (xRequests >= config.logos.maxXAvatarsPerRun) {
        // The cap is reached: the favicon below still gets its turn, and the X avatar waits for a later run.
        deferred = true;
        stats.logos_x_avatar_deferred += 1;
      } else {
        xRequests += 1;
        stats.logos_x_avatar_requests += 1;
        // fallback=false: unavatar answers 404 instead of a generic placeholder when it finds no avatar.
        const image = await attempt(`https://unavatar.io/x/${handle}?fallback=false`, isUnavatarHost);
        if (image !== null) return { source: "x_avatar", image };
        stats.logos_x_avatar_failed += 1;
      }
    }

    for (const domain of project.officialDomains) {
      if (ctx.phishing.get(domain) !== false) continue;
      const sameDomain = (host: string): boolean => registrableDomain(`https://${host}/`) === domain;
      for (const path of FAVICON_PATHS) {
        const image = await attempt(`https://${domain}${path}`, sameDomain);
        if (image !== null) return { source: "favicon", image };
      }
    }
    if (deferred) return "deferred";
    return tried ? "failed" : "none";
  };

  const deadline = deps.now().getTime() + config.logos.budgetMinutes * MINUTE_MS;
  const limit = pLimit(config.logos.concurrency);
  await Promise.all(
    due.map(({ project }) =>
      limit(async () => {
        if (deps.now().getTime() >= deadline) {
          stats.logos_skipped += 1;
          return;
        }
        try {
          const outcome = await logoFor(project);
          if (outcome === "none" || outcome === "deferred") return;
          if (outcome === "failed") {
            await repo.saveLogoAttempt(project.id, "failed", now);
            stats.logos_failed += 1;
            return;
          }
          const { source, image } = outcome;
          await repo.saveProjectLogo(
            project.id,
            { source, mime: image.mime, dataB64: Buffer.from(image.bytes).toString("base64") },
            now,
          );
          await repo.saveLogoAttempt(project.id, "stored", now);
          stats.logos_fetched += 1;
          stats[`logos_${source}`] += 1;
        } catch {
          stats.logos_failed += 1;
        }
      }),
    ),
  );
}
