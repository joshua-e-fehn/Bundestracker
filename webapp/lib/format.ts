import type { Locale } from "./i18n"

/**
 * Locale-aware number and date formatting.
 *
 * Bundestrack shows German and English readers the same figures, and the two
 * spell them differently enough to matter: German writes `1.234,5` where English
 * writes `1,234.5`, so the *same string* means a thousand-fold difference
 * depending on who is reading it. Every number and date that reaches the page
 * goes through this module rather than through a bare `toLocaleString()` at the
 * call site, so the locale is never implicitly the server's.
 *
 * `Intl` is used directly rather than a date library: the formats needed here
 * are numbers, dates and a relative time, all of which `Intl` does natively in
 * both locales, and none of which needs parsing or arithmetic.
 */

/**
 * BCP-47 tags for the two locales.
 *
 * `en-GB` rather than `en-US`: the subject is European, and a British reader of
 * a German parliament should see `26 July 2026` rather than `July 26, 2026`.
 * Digit grouping is identical between the two, so this only affects dates.
 */
const INTL_LOCALES: Record<Locale, string> = {
  de: "de-DE",
  en: "en-GB",
}

function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale] ?? INTL_LOCALES.de
}

/**
 * A whole number with thousands separators — `1.234` in German, `1,234` in
 * English.
 *
 * Rounds rather than truncating, and guards non-finite input: a `NaN` reaching
 * `Intl.NumberFormat` renders the literal string "NaN" on the page, which looks
 * like a label rather than like the missing value it is. An em dash says
 * "no number" in both languages.
 */
export function formatCount(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(
    Math.round(value),
  )
}

/**
 * A count that may be a floor rather than a total.
 *
 * `convex/stats.ts` returns `{count, exact}` for every headline figure because
 * two of them are bounded by a read ceiling. This is where that honesty reaches
 * the reader: an inexact count renders `5.000+`. The `+` is appended after
 * formatting so it survives the German separator, and it reads the same in both
 * languages, which is why it is a symbol rather than a translated word.
 */
export function formatApproximateCount(
  value: number,
  exact: boolean,
  locale: Locale,
): string {
  const formatted = formatCount(value, locale)
  return exact ? formatted : `${formatted}+`
}

/**
 * A score, to one decimal place.
 *
 * Scores are stored rounded to two places (`computeScore` in lib/scoring.ts) but
 * shown to one: the second place is below the resolution at which two MPs are
 * meaningfully different, and a leaderboard reads better without it. The stored
 * precision still decides the ranking — this only changes what is printed.
 */
export function formatScore(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/** A 0…1 rate as a whole percentage. Used for vote participation, which is a
 * rate over *named* ballots only — the caller is responsible for saying so. */
export function formatPercent(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * A month-on-month change, always signed: `+3,4`, `−1,2`, `±0`.
 *
 * `signDisplay: "exceptZero"` rather than a hand-written `+` prefix, because the
 * minus sign a reader should see is U+2212, not the hyphen a template literal
 * would produce — and only `Intl` knows that per locale. Zero stays unsigned:
 * "no change" is not a direction.
 */
export function formatDelta(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(intlLocale(locale), {
    signDisplay: "exceptZero",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * Formats a value by what its column declares.
 *
 * The dispatch lives here rather than as a conditional in the table, so a
 * leaderboard column added to `LEADERBOARDS` (lib/leaderboards.ts) picks its
 * formatter by naming one — and a `format` added there without a case here is a
 * compile error at the switch rather than a cell that silently renders a raw
 * float.
 */
export function formatBy(
  format: "integer" | "rate" | "score" | "delta",
  value: number,
  locale: Locale,
): string {
  switch (format) {
    case "integer":
      return formatCount(value, locale)
    case "rate":
      return formatPercent(value, locale)
    case "score":
      return formatScore(value, locale)
    case "delta":
      return formatDelta(value, locale)
  }
}

/**
 * Parses an ISO `YYYY-MM-DD` date from the database.
 *
 * Anchored at UTC noon rather than midnight. Every date in the schema is a
 * calendar day with no time (convex/schema.ts), and `new Date("2026-07-26")`
 * parses as UTC midnight — which in any timezone behind UTC is the *previous*
 * day locally, so a vote held on the 26th would render as the 25th for a reader
 * in the Americas. Noon is far enough from both boundaries that no real offset
 * crosses it.
 *
 * Returns null on anything unparseable rather than an `Invalid Date`, which
 * formats as the string "Invalid Date" on the page.
 */
function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * A date as a reader sees it: `26. Juli 2026` / `26 July 2026`.
 *
 * Formatted in UTC to match the anchor above — letting `Intl` apply the
 * browser's timezone to a noon anchor would be harmless today but would start
 * shifting days if the anchor ever moved.
 */
export function formatDate(iso: string, locale: Locale): string {
  const date = parseIsoDate(iso)
  if (!date) return iso
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

/** The compact form for dense lists — `26.07.2026` / `26/07/2026`. */
export function formatDateShort(iso: string, locale: Locale): string {
  const date = parseIsoDate(iso)
  if (!date) return iso
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

/**
 * Someone's initials, for an avatar with no portrait.
 *
 * Needed rather than optional: §6.5 found no official bulk portrait source, and
 * Wikimedia Commons covers 36.5 % of WP21 — so most MPs have `photoUrl === null`
 * and the fallback is the common case, not the edge case.
 *
 * Takes the first letter of the first and last name parts, skipping the
 * particles the vote sheets file under a column headed `Titel` (§4.1: `von`,
 * `van`, `de` — not academic titles). Without that, half the aristocracy would
 * share the initials "V".
 */
const NAME_PARTICLES = new Set([
  "von",
  "van",
  "de",
  "der",
  "den",
  "dem",
  "du",
  "di",
  "da",
  "zu",
  "zur",
  "la",
  "le",
])

export function initials(name: string): string {
  const parts = name
    .split(/[\s-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !NAME_PARTICLES.has(part.toLowerCase()))
    // Drop a trailing parenthesised disambiguator: Stammdaten spells the
    // ortsZusatz inline, as in `Brand (Fulda)` (§6.2).
    .filter((part) => !part.startsWith("("))

  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase()
}
