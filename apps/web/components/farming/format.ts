// Number and date formats of "Hasil garapan" (#51), in id-ID like the rest of the site.

const WHOLE = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const TOKENS = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 8 });
const SHORT_DAY = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });

/** A USD value without the "$": whole dollars from $100 up ("1.234"), cents below ("4,16"). */
export function formatUsd(value: number): string {
  return (Math.abs(value) >= 100 ? WHOLE : CENTS).format(value);
}

/** A token amount: "1.250", "12,5". */
export function formatTokens(value: number): string {
  return TOKENS.format(value);
}

/**
 * A token amount as the amount field accepts it again: plain digits with a "." decimal, no grouping and never
 * exponent notation (1e-8 is "0.00000001", 12.5 is "12.5"). For pre-filling "Ubah". Only small amounts need it:
 * String() uses exponent notation below 1e-6 and from 1e21, and a stored amount is at most 1e15.
 */
export function plainAmount(value: number): string {
  const text = String(value);
  const small = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(text);
  if (!small) return text;
  const [, lead, rest = "", power] = small;
  return `0.${"0".repeat(Number(power) - 1)}${lead}${rest}`;
}

/** "7 Okt" for 2026-10-07. */
export function formatShortDay(day: string): string {
  return SHORT_DAY.format(new Date(`${day}T00:00:00Z`));
}
