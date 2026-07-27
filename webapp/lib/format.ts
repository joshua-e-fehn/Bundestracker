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
export function formatApproximateCount(value: number, exact: boolean, locale: Locale): string {
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
 * A 0…1 share to one decimal place — the leaderboards' participation column.
 *
 * Distinct from `formatPercent`, which rounds to whole percents: participation
 * rates cluster near the top, because most MPs vote in most named ballots, so
 * whole percents collapse a large part of a 630-row board onto a handful of
 * visible values while it still sorts invisibly. A table that ranks by a number
 * has to show the digit it ranked on.
 */
export function formatRate(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * A change, with an explicit sign — the rising board's column.
 *
 * `signDisplay: "exceptZero"` rather than `"always"`: a change of exactly zero
 * reads better as "0" than as "+0", and there it means genuinely unchanged
 * rather than a small gain rounded down.
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
 * A **mean of a count**, to one decimal place.
 *
 * Distinct from `formatCount`, and the distinction is not cosmetic: an average
 * of whole things is not itself whole. `/parties` shows the mean committee seats
 * per mandate, which lands on values like 0.5 and 1.0 — rounded to whole numbers
 * those two both print as "1", so a bar chart's axis reads "0 0 1 1 1" with
 * duplicate ticks, and a party averaging 8.5 motions is reported as 8.
 *
 * One decimal rather than two, matching `formatScore`: the second place is below
 * the resolution at which two Fraktionen are meaningfully different.
 *
 * ⚠ Not for a true count. A chamber of "630.0 members" is worse than the
 * rounding this fixes — `formatCount` stays the default and this is only for a
 * value that is genuinely an average.
 */
export function formatMean(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * Dispatch for `BoardColumn.format` in lib/leaderboards.ts and
 * `PartyMetric.format` in lib/party-comparison.ts.
 *
 * Beside the formatters rather than in the table component, so a new column
 * format is added in one place and the nine boards cannot disagree about what
 * "rate" renders as. The union is exhaustive, so a format added there without a
 * case here is a compile error rather than a blank cell.
 */
export function formatBy(
  format: "integer" | "mean" | "rate" | "score" | "delta",
  value: number,
  locale: Locale,
): string {
  switch (format) {
    case "integer":
      return formatCount(value, locale)
    case "mean":
      return formatMean(value, locale)
    case "rate":
      return formatRate(value, locale)
    case "score":
      return formatScore(value, locale)
    case "delta":
      return formatDelta(value, locale)
  }
}

/**
 * The ceiling for a score slider, from the scores it has to span.
 *
 * Rounded *up* to the next ten so the top row sits inside the range rather than
 * exactly at its end — a thumb dragged fully right should still include the
 * highest-scoring row, not sit on the boundary that excludes it.
 *
 * Derived rather than fixed, and that is the reason this is worth a function:
 * scores are unbounded sums that grow through a Wahlperiode, and a feed group's
 * total also scales with its signature count. Any constant here would be wrong
 * by the end of a period.
 *
 * ⚠ Returns the `fallback` for an empty list, not 0. A slider with `max={0}` has
 * no travel — its thumb cannot move — so an empty roster would render a control
 * that looks enabled and does nothing. Both call sites previously spelled this
 * as a `|| 100` at the point of use, which also caught a *derived* zero (every
 * row unscorable), and folding it in here keeps that behaviour in one place.
 *
 * Beside the score formatters rather than in either component: the two call
 * sites — components/mp-table.tsx's roster filter and
 * components/activity-feed.tsx's feed threshold — had the same expression, and
 * a rounding rule that differs between two sliders showing the same kind of
 * number is the sort of drift a reader notices and cannot explain.
 */
export function scoreCeiling(scores: readonly number[], fallback = 100): number {
  // Spread rather than a reduce, matching the call sites it replaces. `Math.max`
  // of nothing is -Infinity, which the 0 floor absorbs.
  const highest = Math.max(0, ...scores)
  const rounded = Math.ceil(highest / 10) * 10
  return rounded || fallback
}

/**
 * A `YYYY-MM` as a month name — "Juli 2026" / "July 2026".
 *
 * UTC-anchored like every other date here: a stored month parsed in local time
 * slips to the previous one for readers west of Greenwich, which would put a
 * month picker one behind the rows it filters.
 */
export function formatMonth(month: string, locale: Locale): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  const parsed = Date.parse(`${month}-01T00:00:00Z`)
  if (Number.isNaN(parsed)) return month
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(parsed))
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
 * Re-exported from lib/bundestag.ts rather than implemented twice. A near-copy
 * lived here and handled name particles but not academic titles, while the
 * original handled titles but not particles — so `Dr. Hülya Düber` and
 * `Alexander von der Leyen` each rendered correctly on some pages and wrongly on
 * others depending on which module the component happened to import. One
 * implementation, both rules; see the note there.
 *
 * The re-export stays so the existing call sites (components/mp-card.tsx,
 * components/user-menu.tsx) keep working: this module is where a component
 * reaches for display formatting, and sending half of them to a different module
 * for one function would be the same split in a new place.
 */
export { initials } from "@/lib/bundestag"
