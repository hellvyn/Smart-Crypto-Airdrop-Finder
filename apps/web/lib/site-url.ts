// The public address of the site, for canonical links, the sitemap and social previews. Vercel sets
// VERCEL_PROJECT_PRODUCTION_URL (a host without a scheme) on every deploy; the literal is the fallback for local builds
// and tests. Until the owner has a permanent domain this is the .vercel.app address (owner 2026-10-11).
const FALLBACK_HOST = "smart-airdrop-finder.vercel.app";

export function siteUrl(): URL {
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return new URL(`https://${host === "" ? FALLBACK_HOST : host}`);
}
