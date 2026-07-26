import type { Locale } from "./i18n"

/**
 * Number formatting, locale-aware.
 *
 * `Intl.NumberFormat` is fine here, unlike for the relative timestamps in
 * lib/relative-time.ts: this renders digits and separators, not translated
 * words, so there is no text for the dictionary to be the contract for. The
 * difference matters — German writes 12.345,6 where English writes 12,345.6,
 * and hand-rolling that would be reimplementing ICU badly.
 *
 * Formatters are cached because constructing one is the expensive part and a
 * leaderboard calls these ~600 times per render.
 */

const cache = new Map<string, Intl.NumberFormat>()

function formatter(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options)}`
  const existing = cache.get(key)
  if (existing) return existing
  const created = new Intl.NumberFormat(locale, options)
  cache.set(key, created)
  return created
}

/** A count — always whole. */
export function formatInteger(value: number, locale: Locale): string {
  return formatter(locale, { maximumFractionDigits: 0 }).format(value)
}

/**
 * A score. Two decimals, because that is the precision `computeScore` rounds
 * to — showing more would invent digits, showing fewer would make two different
 * scores render identically while sorting differently.
 */
export function formatScore(value: number, locale: Locale): string {
  return formatter(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/**
 * A 0…1 share, as a percentage.
 *
 * One decimal place: participation rates cluster near the top — most MPs vote in
 * most named ballots — so whole percents would collapse a large part of the
 * board into a single visible value while it still sorted invisibly.
 */
export function formatRate(value: number, locale: Locale): string {
  return formatter(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * A change, with an explicit sign.
 *
 * `signDisplay: "exceptZero"` rather than "always": a change of exactly zero
 * reads better as "0" than as "+0", and on the rising board a zero means
 * genuinely unchanged rather than a small gain rounded down.
 */
export function formatDelta(value: number, locale: Locale): string {
  return formatter(locale, {
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Dispatch for `BoardColumn.format`. Kept beside the formatters so a new
 * format is added in one place. */
export function formatBy(
  format: "integer" | "rate" | "score" | "delta",
  value: number,
  locale: Locale,
): string {
  switch (format) {
    case "integer":
      return formatInteger(value, locale)
    case "rate":
      return formatRate(value, locale)
    case "score":
      return formatScore(value, locale)
    case "delta":
      return formatDelta(value, locale)
  }
}

/**
 * A `YYYY-MM` as a month name — "Juli 2026", "July 2026".
 *
 * UTC-anchored, like every other date rendering here: a stored month parsed in
 * local time can slip to the previous one for readers west of Greenwich.
 */
export function formatMonth(month: string, locale: Locale): string {
  const parsed = Date.parse(`${month}-01T00:00:00Z`)
  if (Number.isNaN(parsed)) return month
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(parsed))
}
