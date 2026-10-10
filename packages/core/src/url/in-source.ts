function normalize(text: string): string {
  return text.toLowerCase().replace(/\/+$/, "");
}

/**
 * Returns the input URLs (original strings) that literally appear in the
 * source text. Comparison is case-insensitive, `&amp;` in the source is
 * decoded to `&`, and a trailing slash is ignored on either side.
 */
export function filterUrlsInSource(urls: string[], sourceText: string): string[] {
  const haystack = sourceText.replace(/&amp;/gi, "&").toLowerCase();
  return urls.filter((url) => {
    const needle = normalize(url);
    return needle !== "" && haystack.includes(needle);
  });
}
