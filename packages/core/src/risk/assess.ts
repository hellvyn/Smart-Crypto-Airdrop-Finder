import type { RiskLevel, RiskReason, Severity, Status } from "../types.js";
import { DANGEROUS_ASK_CODES, detectDangerousAsks } from "./dangerous-asks.js";
import type { DangerousAskCode } from "./dangerous-asks.js";
import type { ClaimLink } from "./claim-links.js";
import { isLookalike, registrableOf } from "./lookalike.js";

export type { RiskReason } from "../types.js";

export type CheckId =
  | "dangerous_asks"
  | "phishing_list"
  | "domain_age"
  | "lookalike"
  | "token_security"
  | "contract_verified"
  | "hack_history"
  | "corroboration"
  | "ai_review";

export interface RiskCheck {
  id: CheckId;
  ran: boolean;
}

export interface RiskInput {
  project: {
    name: string;
    officialDomains: string[];
    status: Status;
    tokenSymbol: string | null;
    conflict: boolean;
    sourceCount: number;
    hasOfficialSocial: boolean;
    /** Id of the project this one shares a name with. Only decides whether the reason applies. */
    lookalikeOf: string | null;
    /** Display name of the `lookalikeOf` project, shown in the reason. */
    lookalikeOfName: string | null;
    /** Official domains of the `lookalikeOf` project, shown in the reason. */
    lookalikeOfDomains: string[];
  };
  tasks: string[];
  /**
   * Dangerous asks found in the source text itself (code from `findDangerousAskSentences`, quote = the sentence).
   * Unknown codes are ignored; a code already found in `tasks` is not reported twice.
   */
  sourceAsks: { code: string; quote: string }[];
  linkDomains: { domain: string; kind: "website" | "app" | "docs" | "claim" | "social" }[];
  /** null = check failed or TLD unsupported. */
  domainAgeDays: Record<string, number | null>;
  /** GoPlus phishing_site. null = check failed. */
  phishingFlags: Record<string, boolean | null>;
  token: { honeypot: boolean; ownerCanMintOrChangeBalance: boolean; maliciousCreator: boolean } | null;
  contractVerified: boolean | null;
  hackCount: number | null;
  /**
   * What the AI Scam Analyst and contradiction detection found (curation spec §13 A2/A3), from the stored analyses.
   * `scam`: flags of the latest scam analysis whose quote passed `quoteInSource`, or null when there is no scam
   * analysis; `contradictions`: number of contradictions found. These can only add reasons and raise the level.
   */
  aiFlags?: { scam: { pattern: string; quote: string }[] | null; contradictions: number };
  /**
   * The project's claim/app links with their check status (`classifyLink`, #42). A `phishing` one adds the
   * `phishing_claim_link` reason (high). Missing = no claim/app links.
   */
  claimLinks?: ClaimLink[];
}

export interface RiskAssessment {
  level: RiskLevel;
  points: number;
  reasons: RiskReason[];
  checks: RiskCheck[];
}

const SOURCE_ASK_MESSAGE: Record<DangerousAskCode, string> = {
  asks_secret: "The source text asks for a seed phrase or private key",
  asks_payment: "The source text asks you to send crypto in order to claim",
};

/** Public wording per AI scam pattern. It never carries the quote: scam analyses are member-only (#54). */
const AI_SCAM_MESSAGE: Record<string, string> = {
  urgency: "pressures readers to act fast",
  connect_wallet_to_check: "asks readers to connect a wallet just to check eligibility",
  fake_support: "points readers to unofficial support or admins",
  secret_request: "asks for a seed phrase or private key",
  payment_request: "asks readers to send crypto or pay in order to claim",
  impersonation: "impersonates another project or its team",
  other: "uses another social-engineering pattern",
};
const AI_HIGH_PATTERNS: readonly string[] = ["secret_request", "payment_request"];

const NEW_CLAIM_DOMAIN_DAYS = 30;
const YOUNG_DOMAIN_DAYS = 90;
const MIN_CHECKS_RAN = 4;

const POINTS: Record<Severity, number> = { critical: 100, high: 30, medium: 10, info: 0 };
const RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, info: 0 };
/**
 * How strongly a level warns, for raising a level by AI reasons only. `insufficient_data` fails curation like
 * `high`, so an AI `medium` reason leaves it as it is, and only `high` or more replaces it.
 */
const STRICTNESS: Record<RiskLevel, number> = { low: 0, medium: 1, insufficient_data: 2, high: 3, critical: 4 };

/** Registrable domain when available, otherwise the lowercased input. */
function keyOf(domain: string): string {
  return registrableOf(domain) ?? domain.toLowerCase();
}

/** Smallest known age among the hostnames that belong to one registrable domain. */
function ageOf(reg: string, domainAgeDays: Record<string, number | null>): number | null {
  let min: number | null = null;
  for (const [host, age] of Object.entries(domainAgeDays)) {
    if (age === null || keyOf(host) !== reg) continue;
    if (min === null || age < min) min = age;
  }
  return min;
}

function anyNonNull(values: Record<string, unknown>): boolean {
  return Object.values(values).some((v) => v !== null && v !== undefined);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The highest severity among `reasons`, or null when there is none. */
function topSeverity(reasons: RiskReason[]): Severity | null {
  return reasons.reduce<Severity | null>(
    (acc, r) => (acc === null || RANK[r.severity] > RANK[acc] ? r.severity : acc),
    null,
  );
}

/**
 * Reasons from the AI flags: one `ai_scam_pattern` per distinct pattern of the flags that have a quote (unknown
 * patterns count as `other`), and one `ai_contradiction` when contradictions were found. Only ever adds.
 */
function aiReasons(aiFlags: RiskInput["aiFlags"]): RiskReason[] {
  if (aiFlags === undefined) return [];
  const reasons: RiskReason[] = [];
  const seen = new Set<string>();
  for (const f of aiFlags.scam ?? []) {
    if (f.quote.trim() === "") continue;
    const pattern = f.pattern in AI_SCAM_MESSAGE ? f.pattern : "other";
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    reasons.push({
      code: "ai_scam_pattern",
      severity: AI_HIGH_PATTERNS.includes(pattern) ? "high" : "medium",
      message: `AI review: the source text ${AI_SCAM_MESSAGE[pattern]}.`,
      source: "ai",
    });
  }
  if (aiFlags.contradictions > 0) {
    reasons.push({
      code: "ai_contradiction",
      severity: "medium",
      message: `AI review found ${plural(aiFlags.contradictions, "contradiction")} between or within the sources.`,
      source: "ai",
    });
  }
  return reasons;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const { project } = input;
  const reasons: RiskReason[] = [...detectDangerousAsks(input.tasks)];
  for (const ask of input.sourceAsks) {
    if (!(DANGEROUS_ASK_CODES as readonly string[]).includes(ask.code)) continue;
    if (reasons.some((r) => r.code === ask.code)) continue;
    reasons.push({
      code: ask.code,
      severity: "critical",
      message: `${SOURCE_ASK_MESSAGE[ask.code as DangerousAskCode]}: "${ask.quote}"`,
      source: "text",
    });
  }

  const officialRegs = new Set(project.officialDomains.map(keyOf));

  // Critical: GoPlus phishing list, honeypot token.
  const seenPhishing = new Set<string>();
  for (const [domain, flagged] of Object.entries(input.phishingFlags)) {
    if (flagged === true && !seenPhishing.has(keyOf(domain))) {
      seenPhishing.add(keyOf(domain));
      reasons.push({
        code: "phishing_listed",
        severity: "critical",
        message: `${domain} is listed as a phishing site.`,
        source: "goplus",
      });
    }
  }
  if (input.token?.honeypot) {
    reasons.push({
      code: "token_honeypot",
      severity: "critical",
      message: "The token looks like a honeypot: it can be bought but not sold.",
      source: "goplus",
    });
  }

  // High: claim/app links on the phishing list. One reason for all of them; the public message never names a link.
  const phishingClaimLinks = new Set((input.claimLinks ?? []).filter((l) => l.status === "phishing").map((l) => l.url));
  if (phishingClaimLinks.size > 0) {
    const n = phishingClaimLinks.size;
    reasons.push({
      code: "phishing_claim_link",
      severity: "high",
      message: `${plural(n, "claim link")} of this project ${n === 1 ? "is" : "are"} on the phishing list and hidden.`,
      source: "goplus",
    });
  }

  // Distinct link domains (by registrable domain) in input order.
  const linkRegs: string[] = [];
  for (const l of input.linkDomains) {
    const reg = keyOf(l.domain);
    if (!linkRegs.includes(reg)) linkRegs.push(reg);
  }

  // High: young unofficial claim domain.
  const seenClaim = new Set<string>();
  for (const l of input.linkDomains) {
    if (l.kind !== "claim") continue;
    const reg = keyOf(l.domain);
    if (seenClaim.has(reg) || officialRegs.has(reg)) continue;
    seenClaim.add(reg);
    const age = ageOf(reg, input.domainAgeDays);
    if (age !== null && age < NEW_CLAIM_DOMAIN_DAYS) {
      reasons.push({
        code: "new_claim_domain",
        severity: "high",
        message: `Claim link ${reg} is not an official domain and was registered ${plural(age, "day")} ago.`,
        source: "rdap",
      });
    }
  }

  // High: lookalike link domains (one per registrable domain). Docs/social links are
  // often project-owned platform hosts, and without official domains nothing can be
  // told apart from the real site, so those cases are skipped.
  const seenLookalike = new Set<string>();
  if (project.officialDomains.length > 0) {
    for (const l of input.linkDomains) {
      if (l.kind === "docs" || l.kind === "social") continue;
      const reg = keyOf(l.domain);
      if (seenLookalike.has(reg)) continue;
      if (isLookalike(l.domain, project.name, project.officialDomains)) {
        seenLookalike.add(reg);
        reasons.push({
          code: "lookalike_domain",
          severity: "high",
          message: `${l.domain} resembles the name "${project.name}" but is not an official domain.`,
          source: "heuristic",
        });
      }
    }
  }
  if (project.lookalikeOf !== null) {
    const other =
      project.lookalikeOfName === null
        ? "another project"
        : `"${project.lookalikeOfName}"${project.lookalikeOfDomains.length > 0 ? ` (${project.lookalikeOfDomains.join(", ")})` : ""}`;
    reasons.push({
      code: "lookalike_domain",
      severity: "high",
      message: `This project shares a name with ${other} but uses a different domain.`,
      source: "heuristic",
    });
  }

  if (input.token?.ownerCanMintOrChangeBalance) {
    reasons.push({
      code: "token_owner_powers",
      severity: "high",
      message: "The token owner can mint tokens or change balances.",
      source: "goplus",
    });
  }
  if (input.token?.maliciousCreator) {
    reasons.push({
      code: "malicious_creator",
      severity: "high",
      message: "The token contract creator is flagged as malicious.",
      source: "goplus",
    });
  }

  // Medium: young domains (any link domain or any domain with a known age).
  const ageRegs = [...linkRegs];
  for (const host of Object.keys(input.domainAgeDays)) {
    const reg = keyOf(host);
    if (!ageRegs.includes(reg)) ageRegs.push(reg);
  }
  for (const reg of ageRegs) {
    const age = ageOf(reg, input.domainAgeDays);
    if (age !== null && age < YOUNG_DOMAIN_DAYS) {
      reasons.push({
        code: "young_domain",
        severity: "medium",
        message: `${reg} was registered only ${plural(age, "day")} ago.`,
        source: "rdap",
      });
    }
  }

  if (input.contractVerified === false) {
    reasons.push({
      code: "unverified_contract",
      severity: "medium",
      message: "The token contract source code is not verified.",
      source: "blockscout",
    });
  }
  if (project.sourceCount === 1 && !project.hasOfficialSocial) {
    reasons.push({
      code: "single_source",
      severity: "medium",
      message: "Only 1 source mentions this project and no official social account was found.",
      source: "heuristic",
    });
  }
  if (project.conflict) {
    reasons.push({
      code: "conflicting_evidence",
      severity: "medium",
      message: "Sources disagree about key facts of this project.",
      source: "heuristic",
    });
  }
  if (input.hackCount !== null && input.hackCount > 0) {
    reasons.push({
      code: "hack_history",
      severity: "medium",
      message: `The project has ${plural(input.hackCount, "recorded hack")}.`,
      source: "defillama",
    });
  }

  // Info
  if (project.status === "speculative") {
    reasons.push({
      code: "speculative",
      severity: "info",
      message: "No airdrop has been announced; this is speculation based on onchain signals.",
      source: "extraction",
    });
  }

  const checks: RiskCheck[] = [
    { id: "dangerous_asks", ran: true },
    { id: "phishing_list", ran: anyNonNull(input.phishingFlags) },
    { id: "domain_age", ran: anyNonNull(input.domainAgeDays) },
    { id: "lookalike", ran: project.officialDomains.length > 0 || project.lookalikeOf !== null },
    { id: "token_security", ran: input.token !== null },
    { id: "contract_verified", ran: input.contractVerified !== null },
    { id: "hack_history", ran: input.hackCount !== null },
    { id: "corroboration", ran: true },
  ];

  // The level without AI first; AI reasons can then only raise it (spec §13: AI never lowers a risk).
  const ranCount = checks.filter((c) => c.ran).length;
  const top = topSeverity(reasons);
  let level: RiskLevel;
  if (top === null || top === "info") {
    level = ranCount < MIN_CHECKS_RAN ? "insufficient_data" : "low";
  } else {
    level = top;
  }

  const fromAi = aiReasons(input.aiFlags);
  const aiTop = topSeverity(fromAi);
  if (aiTop !== null && aiTop !== "info" && STRICTNESS[aiTop] > STRICTNESS[level]) level = aiTop;
  reasons.push(...fromAi);
  // Not counted in `ranCount`: an AI review never turns insufficient data into a lower level.
  checks.push({ id: "ai_review", ran: input.aiFlags?.scam != null });

  const points = reasons.reduce((sum, r) => sum + POINTS[r.severity], 0);
  return { level, points, reasons, checks };
}
