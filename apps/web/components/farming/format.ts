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

/** "7 Okt" for 2026-10-07. */
export function formatShortDay(day: string): string {
  return SHORT_DAY.format(new Date(`${day}T00:00:00Z`));
}
