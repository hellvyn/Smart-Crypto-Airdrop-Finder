// `@saf/core` is compiled with lib ES2023 only (no DOM, no @types/node), and
// it is also type-checked as source by the pipeline package whose ambient
// types differ. Reach the runtime-provided WHATWG `URL` through `globalThis`
// with a minimal local type so no ambient declaration can conflict.
export interface ParsedUrl {
  hostname: string;
  pathname: string;
  search: string;
  toString(): string;
}

type UrlConstructor = new (url: string) => ParsedUrl;

const UrlCtor = (globalThis as unknown as { URL: UrlConstructor }).URL;

/** Parses an absolute URL. Throws `TypeError` when the input is invalid. */
export function parseUrl(raw: string): ParsedUrl {
  return new UrlCtor(raw);
}
