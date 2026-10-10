export interface ProjectRef {
  id: string;
  nameKey: string;
  domains: string[];
}

export type MergeDecision = { action: "merge"; projectId: string } | { action: "create"; lookalikeOf: string | null };

/**
 * Decides whether an incoming project is an existing one or a new one.
 * Same name with a different domain is NOT merged: it is created and flagged as a
 * possible lookalike of the existing project.
 */
export function decideMerge(
  incoming: { nameKey: string; domains: string[] },
  candidates: ProjectRef[],
): MergeDecision {
  const matches = candidates.filter((c) => c.nameKey === incoming.nameKey);
  const first = matches[0];
  if (first === undefined) return { action: "create", lookalikeOf: null };

  const incomingDomains = new Set(incoming.domains);
  const overlapping = matches.find((c) => c.domains.some((d) => incomingDomains.has(d)));
  if (overlapping) return { action: "merge", projectId: overlapping.id };

  if (incoming.domains.length === 0) return { action: "merge", projectId: first.id };

  const domainless = matches.find((c) => c.domains.length === 0);
  if (domainless) return { action: "merge", projectId: domainless.id };

  return { action: "create", lookalikeOf: first.id };
}
