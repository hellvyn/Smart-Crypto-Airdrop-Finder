function normalize(text: string): string {
  return text.toLowerCase().replace(/\/+$/, "");
}

// Characters that may legitimately follow a URL in running text or markup.
// Anything else (letters, digits, `.`, `-`, `_`, `%`, `&`, ...) means the
// source URL continues past the needle, so it is a different URL.
const BOUNDARY_CHARS = new Set(["/", "?", "#", ")", "]", '"', "'", "<", ">", ",", ";"]);

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char) || BOUNDARY_CHARS.has(char);
}

function occursAsWholeUrl(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return false;
    let end = idx + needle.length;
    // The needle had its trailing slash(es) stripped; tolerate them in the source.
    while (haystack[end] === "/") end++;
    if (isBoundary(haystack[end])) return true;
    from = idx + 1;
  }
}

/**
 * Returns the input URLs (original strings) that appear verbatim in the
 * source text, as whole URLs: the match must be followed by the end of the
 * text or a non-URL character, so `https://a.io/x` does not match inside
 * `https://a.io/xyz`. Comparison is case-insensitive, `&amp;` in the source
 * is decoded to `&`, and a trailing slash is ignored on either side.
 */
export function filterUrlsInSource(urls: string[], sourceText: string): string[] {
  const haystack = sourceText.replace(/&amp;/gi, "&").toLowerCase();
  return urls.filter((url) => {
    const needle = normalize(url);
    return needle !== "" && occursAsWholeUrl(haystack, needle);
  });
}
