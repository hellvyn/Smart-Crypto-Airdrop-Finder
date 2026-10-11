export type SourceKind = "airdrops_io" | "telegram" | "defillama" | "alphadrops";

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
  /** `headers` (names in lowercase) is given by the real client; fakes may leave it out. */
  get(url: string): Promise<{ status: number; body: string; headers?: Record<string, string> }>;
  /** Returns the absolute `Location` of the first redirect, or null if there is none. */
  resolveRedirect(url: string): Promise<string | null>;
}
