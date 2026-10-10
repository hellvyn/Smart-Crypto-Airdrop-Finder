import { parseUrl } from "./whatwg-url.js";

export interface CleanedUrl {
  url: string;
  referralStripped: boolean;
}

const REFERRAL_PARAMS = new Set(["ref", "referral"]);

function isReferralParam(name: string): boolean {
  const lower = name.toLowerCase();
  return REFERRAL_PARAMS.has(lower) || lower.startsWith("utm_");
}

/**
 * Removes referral tracking from a URL: `ref`, `referral` and `utm_*` query
 * params (case-insensitive names) and a `/r/<code>` path. Other params keep
 * their original order. Throws on input that is not a valid absolute URL.
 */
export function cleanUrl(raw: string): CleanedUrl {
  const parsed = parseUrl(raw);
  let stripped = false;

  // Filter the raw query pairs so untouched params keep their exact encoding.
  if (parsed.search.length > 1) {
    const kept: string[] = [];
    for (const pair of parsed.search.slice(1).split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      let name = rawName;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, " "));
      } catch {
        // Keep the raw name when it is not valid percent-encoding.
      }
      if (isReferralParam(name)) {
        stripped = true;
      } else {
        kept.push(pair);
      }
    }
    if (stripped) {
      parsed.search = kept.length > 0 ? `?${kept.join("&")}` : "";
    }
  }

  const segments = parsed.pathname.split("/");
  // "/r/CODE" splits into ["", "r", "CODE"].
  if (segments.length === 3 && segments[0] === "" && segments[1] === "r" && segments[2] !== "") {
    parsed.pathname = "/";
    stripped = true;
  }

  return { url: parsed.toString(), referralStripped: stripped };
}
