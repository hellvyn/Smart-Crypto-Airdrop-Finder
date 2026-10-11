import { ANALYZE_MODELS, MODELS } from "@saf/llm";
import type { ModelConfig } from "@saf/llm";

// The model chains live in `@saf/llm` (the farming coach shares them); every pipeline import keeps using `config`.
export { ANALYZE_MODELS, MODELS };

/** A VC whose portfolio page is cross-checked for `vc_backer` (curation spec §5.2). */
export interface VcConfig {
  id: string;
  name: string;
  /** Other names the VC goes by (a former name, a short form). */
  aliases: string[];
  tier: 1 | 2;
  portfolioUrl: string;
}

export interface PipelineConfig {
  telegramChannels: string[];
  defillama: { minTvl: number; excludedCategories: string[]; limit: number; newWithinDays: number };
  /**
   * AlphaDrops collector (curation spec §15.1): at most `maxDetails` detail pages per run, `delayMs` apart.
   * `intermediaryHosts` (exact host match) are never a project's domain: the collector drops a website link that
   * ends there, and extraction and merge refuse them as official URLs and domains (`isNonProjectHost`).
   * The `signals` stage then reads `llms-full.txt` and at most `maxRaisePages` raise pages (`reported_backer`, #41),
   * also `delayMs` apart: never-cached pages first, then the oldest. 6 per run is about 42 per week at one run a
   * day (spec §15.1: at most 40 per week). `maxRequestsPerRun` caps every AlphaDrops request of a run together: the raise part only
   * gets what the collector left. `enabled: false` sends no AlphaDrops request at all.
   */
  alphadrops: {
    enabled: boolean;
    maxDetails: number;
    delayMs: number;
    intermediaryHosts: string[];
    maxRaisePages: number;
    maxRequestsPerRun: number;
  };
  /** Tried in order until one returns a valid extraction. */
  models: ModelConfig[];
  /**
   * Tried in order until one returns a valid AI analysis (`analyze` stage only). The daily job drops models whose
   * provider has no key (`usableModels`), so without `ANTHROPIC_API_KEY` this is `models` again.
   */
  analyzeModels: ModelConfig[];
  llmConcurrency: number;
  maxDocumentsPerRun: number;
  /**
   * Extraction time budget per run. After it no new LLM call starts; the remaining documents stay pending
   * (counted as `extract_deferred`), so merge, score and purge finish within the job's 60-minute limit.
   */
  extractBudgetMinutes: number;
  /**
   * GoPlus time budget, counted from the start of `score`: after it no new GoPlus request starts. With
   * `goplusMaxConsecutiveFailures` domains in a row without an answer, the rest are not asked either. Domains not
   * asked count as not run (`phishing_list_failed`, and `phishing_list_skipped`), so a slow or rate-limiting GoPlus
   * cannot keep the job from saving its risk assessments within the 60-minute limit.
   */
  goplusBudgetMinutes: number;
  goplusMaxConsecutiveFailures: number;
  /**
   * RDAP time budget, counted from the start of `score`: after it no new RDAP request starts, and the domains not
   * asked count as not run (`domain_age_rdap_skipped`). RDAP runs one request at a time, alongside the GoPlus queue.
   */
  rdapBudgetMinutes: number;
  /**
   * crt.sh time budget, counting only the time crt.sh is busy (pacing waits and requests), not the time it waits for
   * RDAP to find a domain without a date: once it is used up no new crt.sh request starts (`domain_age_crtsh_skipped`).
   * Worst case crt.sh ends about 3.4 minutes after RDAP (about 10.2 minutes into `score`), inside the GoPlus 12.
   */
  crtshBudgetMinutes: number;
  /**
   * AI analysis budget per run, counted from the start of `analyze`: after it no new LLM call starts. At most
   * `maxAnalysesPerRun` analyses start per run. Analyses not started stay as they were (counted as
   * `ai_analyses_deferred`) and run on a later day; an unchanged input reuses the stored analysis without a call.
   */
  analyzeBudgetMinutes: number;
  maxAnalysesPerRun: number;
  scoreActiveSinceDays: number;
  textRetentionDays: number;
  /** VCs whose portfolio pages give verified `vc_backer` signals (`VC_LIST`). */
  vcs: VcConfig[];
  /**
   * Logo stage (owner request 2026-10-11): no project starts after `budgetMinutes` (counted from the start of the
   * stage), `concurrency` projects at a time, and at most `maxXAvatarsPerRun` unavatar.io requests per run (its free
   * plan allows 25 to 50 avatars per day per IP; the docs and other sources disagree). Projects left over wait for the
   * next run.
   */
  logos: { budgetMinutes: number; concurrency: number; maxXAvatarsPerRun: number };
}

/**
 * VC candidates of curation plan 5 Task 4 (tier 1 as the plan sets it) that are **not used**: each one failed at
 * least one condition of the check on 2026-10-11 (the comment above each one; details in docs/ops/pipeline.md,
 * "Daftar VC").
 * A VC moves to `VC_LIST` only when its page answers 200 to the pipeline's client, its outbound links are its
 * portfolio companies (at least ~10 of them in the HTML, no JavaScript needed), and neither its robots.txt nor its
 * terms forbid reading the page automatically (spec §5.2: a VC whose terms forbid it is struck). Re-check with
 * `scripts/vc-portfolio-check.ts`. The `portfolioUrl` is the page that lists the portfolio where one was found.
 */
export const VC_CANDIDATES: VcConfig[] = [
  // Terms forbid it: no access to or collection of data from the site by automated means.
  { id: "paradigm", name: "Paradigm", aliases: [], tier: 1, portfolioUrl: "https://www.paradigm.xyz/investments" },
  // 404: no portfolio page on polychain.capital (the homepage links only to job boards).
  { id: "polychain", name: "Polychain Capital", aliases: ["Polychain"], tier: 1, portfolioUrl: "https://polychain.capital/portfolio" },
  // JavaScript-rendered: the list is not in the HTML (only investor-portal links).
  { id: "pantera", name: "Pantera Capital", aliases: ["Pantera"], tier: 1, portfolioUrl: "https://panteracapital.com/portfolio/" },
  // JavaScript-rendered: no portfolio link in the HTML.
  { id: "multicoin", name: "Multicoin Capital", aliases: ["Multicoin"], tier: 1, portfolioUrl: "https://multicoin.capital/portfolio/" },
  // JavaScript-rendered: the portfolio section of the homepage (dragonfly.xyz moved here) has no company link in the HTML.
  { id: "dragonfly", name: "Dragonfly", aliases: ["Dragonfly Capital"], tier: 1, portfolioUrl: "https://dragonfly.com/" },
  // Blocked: the site's bot protection answers 403.
  { id: "coinbase-ventures", name: "Coinbase Ventures", aliases: [], tier: 1, portfolioUrl: "https://www.coinbase.com/ventures" },
  // 404: no portfolio page linked from the yzilabs.com homepage.
  { id: "yzi-labs", name: "YZi Labs", aliases: ["Binance Labs"], tier: 1, portfolioUrl: "https://www.yzilabs.com/portfolio" },
  // Terms forbid it: the site is licensed for personal, noncommercial use only, and no part may be downloaded.
  { id: "framework", name: "Framework Ventures", aliases: ["Framework"], tier: 2, portfolioUrl: "https://framework.ventures/portfolio" },
  // Terms forbid it: no robot, spider or other automatic means to access the site for any purpose.
  { id: "variant", name: "Variant", aliases: ["Variant Fund"], tier: 2, portfolioUrl: "https://variant.fund/portfolio/" },
  // Terms forbid it: no automated data collection without Electric Capital's express permission.
  { id: "electric-capital", name: "Electric Capital", aliases: [], tier: 2, portfolioUrl: "https://www.electriccapital.com/investments/" },
  // No company domains: the list links only to Hack VC's own detail pages (/portfolio/<company>).
  { id: "hack-vc", name: "Hack VC", aliases: [], tier: 2, portfolioUrl: "https://www.hack.vc/portfolio" },
  // Terms forbid it: personal, noncommercial use only; any other use needs written permission.
  { id: "placeholder", name: "Placeholder", aliases: ["Placeholder VC"], tier: 2, portfolioUrl: "https://www.placeholder.vc/" },
  // JavaScript-rendered: only the first 10 companies are in the HTML, the rest load with "Load More".
  { id: "delphi-ventures", name: "Delphi Ventures", aliases: ["Delphi Digital"], tier: 2, portfolioUrl: "https://delphiventures.io/portfolio-crypto" },
  // Terms forbid it: the site (terms on jumptrading.com) is licensed for private, non-commercial use only.
  { id: "jump-crypto", name: "Jump Crypto", aliases: ["Jump"], tier: 2, portfolioUrl: "https://jumpcrypto.com/invest" },
];

/**
 * Verified VCs: the only ones the pipeline fetches and trusts (`defaultConfig.vcs`), each one passed every condition
 * above (check of 2026-10-11, docs/ops/pipeline.md "Daftar VC"), so no unverified page can give a project a verified
 * `vc_backer`. An unreachable or link-less page of a listed VC only leaves that VC "not checked" in a run; it never
 * removes signals from the other VCs.
 */
export const VC_LIST: VcConfig[] = [
  // Page 200, 121 portfolio domains in the HTML, robots.txt allows /portfolio/. Its terms (on a16z.com) have no
  // automation or scraping ban and no personal/noncommercial restriction, but their general clause "all content and
  // material on the Services ... including information ... should not be used, modified, or reproduced without our
  // prior written consent" is ambiguous for a commercial product. Owner confirmed 2026-10-11 (clause risk accepted);
  // to remove it, move this entry back to VC_CANDIDATES. Its sister site a16z.com is in NON_PORTFOLIO_DOMAINS.
  { id: "a16z-crypto", name: "a16z crypto", aliases: ["a16z", "Andreessen Horowitz"], tier: 1, portfolioUrl: "https://a16zcrypto.com/portfolio/" },
];

export const defaultConfig: PipelineConfig = {
  telegramChannels: ["airdrops_io"],
  defillama: { minTvl: 1_000_000, excludedCategories: ["CEX"], limit: 80, newWithinDays: 180 },
  alphadrops: {
    enabled: true,
    maxDetails: 80,
    delayMs: 1500,
    intermediaryHosts: ["s.kaito.ai", "linktr.ee", "galxe.com", "app.galxe.com", "zealy.io", "layer3.xyz", "bit.ly", "t.co"],
    maxRaisePages: 6,
    maxRequestsPerRun: 120,
  },
  models: MODELS,
  analyzeModels: ANALYZE_MODELS,
  llmConcurrency: 3,
  maxDocumentsPerRun: 150,
  extractBudgetMinutes: 35,
  goplusBudgetMinutes: 12,
  goplusMaxConsecutiveFailures: 5,
  rdapBudgetMinutes: 6,
  crtshBudgetMinutes: 3,
  analyzeBudgetMinutes: 10,
  maxAnalysesPerRun: 60,
  scoreActiveSinceDays: 60,
  textRetentionDays: 90,
  vcs: VC_LIST,
  logos: { budgetMinutes: 2, concurrency: 3, maxXAvatarsPerRun: 20 },
};
