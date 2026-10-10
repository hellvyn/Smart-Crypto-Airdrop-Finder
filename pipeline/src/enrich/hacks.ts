import { normalizeName } from "@saf/core";
import type { Http } from "../collectors/types.js";

/** Fetches the DefiLlama hack list. Returns null on any error or non-array response. */
export async function fetchHacks(http: Http): Promise<unknown[] | null> {
  const res = await http.get("https://api.llama.fi/hacks");
  if (res.status !== 200) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    return null;
  }
  return Array.isArray(raw) ? (raw as unknown[]) : null;
}

/** Counts hacks whose normalized name equals the normalized project name. */
export function countHacks(hacks: unknown[], projectName: string): number {
  const target = normalizeName(projectName);
  if (target === "") return 0;
  let count = 0;
  for (const hack of hacks) {
    if (typeof hack !== "object" || hack === null) continue;
    const name = (hack as { name?: unknown }).name;
    if (typeof name === "string" && normalizeName(name) === target) count++;
  }
  return count;
}
