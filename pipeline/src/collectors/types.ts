export type SourceKind = "airdrops_io" | "telegram";

export interface CollectedDocument {
  sourceKind: SourceKind;
  sourceKey: string;
  url: string;
  text: string;
  publishedAt: Date | null;
  pageUpdatedAt: Date | null;
  fetchedAt: Date;
}

export interface CollectorResult {
  sourceKey: string;
  documents: CollectedDocument[];
  failed: boolean;
  error?: string;
}

export interface Http {
  get(url: string): Promise<{ status: number; body: string }>;
  /** Returns the absolute `Location` of the first redirect, or null if there is none. */
  resolveRedirect(url: string): Promise<string | null>;
}
