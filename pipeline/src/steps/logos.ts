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
 * the source text): the first path segment when it is a valid handle (letters, digits, `_`, at most 15) and not a
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
    const first = url.pathname.split("/")[1] ?? "";
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

/**
 * The `logos` stage. For every project of `projects` whose stored logo is missing or at least 7 days old (no logo
 * first, then the oldest), a few at a time (`config.logos.concurrency`):
 * - tries the tiers in order and stores the first usable image (`logos_fetched`, and `logos_defillama`,
 *   `logos_x_avatar` or `logos_favicon`); when none is usable the stored logo, if any, stays (`logos_failed`);
 * - asks unavatar.io at most `maxXAvatarsPerRun` times a run (`logos_x_avatar_requests`, of which
 *   `logos_x_avatar_failed` gave nothing). A project whose turn comes after that waits for a later run without trying
 *   its favicon, so the X avatar keeps its place in the order (`logos_x_avatar_deferred`);
 * - starts no project after `budgetMinutes` (by `deps.now()`, from the start of the stage); those wait for the next
 *   run (`logos_skipped`).
 * A project with nothing to try counts nowhere. A project whose logo cannot be stored counts as `logos_failed`; the
 * others go on. `phishing` holds the GoPlus answers of this run's `score` stage by registrable domain: only `false`
 * (checked, not listed) lets a favicon be asked.
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
  const stored = new Map(
    (await repo.listProjectLogos(projects.map((p) => p.id))).map((r) => [r.projectId, r.fetchedAt.getTime()]),
  );
  const age = (id: string): number => now.getTime() - (stored.get(id) ?? Number.NEGATIVE_INFINITY);
  const due = projects
    .filter((p) => age(p.id) >= LOGO_FRESH_MS)
    .sort((a, b) => age(b.id) - age(a.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let xRequests = 0;
  const logoFor = async (project: ProjectForScoring): Promise<Outcome> => {
    let tried = false;
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
      if (xRequests >= config.logos.maxXAvatarsPerRun) return "deferred";
      xRequests += 1;
      stats.logos_x_avatar_requests += 1;
      // fallback=false: unavatar answers 404 instead of a generic placeholder when it finds no avatar.
      const image = await attempt(`https://unavatar.io/x/${handle}?fallback=false`, isUnavatarHost);
      if (image !== null) return { source: "x_avatar", image };
      stats.logos_x_avatar_failed += 1;
    }

    for (const domain of project.officialDomains) {
      if (ctx.phishing.get(domain) !== false) continue;
      const sameDomain = (host: string): boolean => registrableDomain(`https://${host}/`) === domain;
      for (const path of FAVICON_PATHS) {
        const image = await attempt(`https://${domain}${path}`, sameDomain);
        if (image !== null) return { source: "favicon", image };
      }
    }
    return tried ? "failed" : "none";
  };

  const deadline = deps.now().getTime() + config.logos.budgetMinutes * MINUTE_MS;
  const limit = pLimit(config.logos.concurrency);
  await Promise.all(
    due.map((project) =>
      limit(async () => {
        if (deps.now().getTime() >= deadline) {
          stats.logos_skipped += 1;
          return;
        }
        try {
          const outcome = await logoFor(project);
          if (outcome === "none") return;
          if (outcome === "deferred") {
            stats.logos_x_avatar_deferred += 1;
            return;
          }
          if (outcome === "failed") {
            stats.logos_failed += 1;
            return;
          }
          const { source, image } = outcome;
          await repo.saveProjectLogo(
            project.id,
            { source, mime: image.mime, dataB64: Buffer.from(image.bytes).toString("base64") },
            now,
          );
          stats.logos_fetched += 1;
          stats[`logos_${source}`] += 1;
        } catch {
          stats.logos_failed += 1;
        }
      }),
    ),
  );
}
