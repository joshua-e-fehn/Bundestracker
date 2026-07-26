/**
 * Relative timestamps — "2 hours ago", "gestern".
 *
 * Hand-rolled on top of the dictionary in lib/i18n.ts rather than delegating to
 * `Intl.RelativeTimeFormat`, for one reason: the dictionary is the contract.
 * Every user-facing string on Bundestrack is bilingual by typecheck (`en` is
 * annotated `Dictionary`, so a German string without an English one fails
 * `pixi run typecheck`), and a formatter that produces text from the platform's
 * own locale data sits outside that guarantee — it would render whatever the
 * runtime's ICU build happens to contain, in a locale the reader may not have
 * chosen, with no way for a translation review to see it. The thresholds below
 * are the only thing `Intl` would have given us for free.
 *
 * ## What the feed actually has
 *
 * `activityEvents.date` is a **day**, `YYYY-MM-DD` — not a timestamp. The
 * Bundestag publishes a date of record, not a time of day, so "2 hours ago" is
 * not a thing this data can say about a parliamentary event. `createdAt` is a
 * real millisecond timestamp but it records when *Bundestrack ingested the row*,
 * which is an artefact of the sync schedule: rendering it would tell the reader
 * how recently a cron ran and look exactly like a claim about the Bundestag.
 *
 * So `relativeDay` is the feed's formatter and it works in whole days. The
 * sub-day arm exists because `relativeTime` is also correct for a genuine
 * timestamp — it is just not what the feed passes it.
 */

import type { Locale, TranslationKey } from "./i18n"
import { t } from "./i18n"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Which key and count describe `elapsed` milliseconds.
 *
 * Split from the rendering so the thresholds can be tested without a locale,
 * and so the singular/plural choice is made *by key* rather than by an `if` at
 * the call site: German and English happen to agree on where the split falls,
 * but the dictionary is where a future locale that disagrees gets to say so.
 *
 * Weeks stop at four rather than running to 52: past a month, "vor 7 Wochen" is
 * a worse answer than "vor 2 Monaten" for a reader scanning a feed. Months
 * likewise stop at twelve. Both are approximations by construction — a "month"
 * here is 30 days — which is why the boundaries are generous rather than exact.
 */
export function relativeParts(elapsedMs: number): { key: TranslationKey; count: number } {
  // A future date reads as "just now" rather than as a negative count. The
  // sources publish the odd forward-dated record (a scheduled sitting), and
  // "in -3 days" is worse than a small imprecision.
  const elapsed = Math.max(0, elapsedMs)

  const minutes = Math.floor(elapsed / MINUTE)
  if (minutes < 1) return { key: "time.justNow", count: 0 }
  if (minutes === 1) return { key: "time.minuteAgo", count: 1 }
  if (minutes < 60) return { key: "time.minutesAgo", count: minutes }

  const hours = Math.floor(elapsed / HOUR)
  if (hours === 1) return { key: "time.hourAgo", count: 1 }
  if (hours < 24) return { key: "time.hoursAgo", count: hours }

  const days = Math.floor(elapsed / DAY)
  if (days === 1) return { key: "time.yesterday", count: 1 }
  if (days < 7) return { key: "time.daysAgo", count: days }

  const weeks = Math.floor(days / 7)
  if (weeks === 1) return { key: "time.weekAgo", count: 1 }
  if (days < 30) return { key: "time.weeksAgo", count: weeks }

  const months = Math.floor(days / 30)
  if (months === 1) return { key: "time.monthAgo", count: 1 }
  if (days < 365) return { key: "time.monthsAgo", count: months }

  const years = Math.floor(days / 365)
  return years === 1 ? { key: "time.yearAgo", count: 1 } : { key: "time.yearsAgo", count: years }
}

/** `relativeParts`, rendered in `locale`. */
export function relativeTime(fromMs: number, nowMs: number, locale: Locale): string {
  const { key, count } = relativeParts(nowMs - fromMs)
  return t(key, locale, { count })
}

/**
 * Parses an ISO `YYYY-MM-DD` to the UTC midnight starting that day, or null.
 *
 * `Date.parse` would accept it, and also accept `"2026-06-18T14:00:00+02:00"`,
 * `"June 18 2026"` and — depending on the engine — a good deal else. The feed's
 * dates come from the pipeline in exactly one shape, so anything else is a bug
 * worth surfacing as a missing timestamp rather than absorbing into a plausible
 * date.
 */
export function parseIsoDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = Date.parse(`${date}T00:00:00Z`)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Relative label for a **day**, which is what the feed stores. See the header.
 *
 * Compared midnight-to-midnight in UTC, so the answer is a whole number of
 * calendar days rather than a fraction that rounds by the hour: an event dated
 * today reads "gerade eben" all day, and yesterday's reads "gestern" all day,
 * instead of flipping to "vor 1 Tag" at some point in the afternoon.
 *
 * Returns the raw string for an unparseable date. That is deliberately visible —
 * a date the parser rejects is a pipeline bug, and showing it beats hiding it
 * behind an em-dash or, worse, behind today's date.
 */
export function relativeDay(date: string, nowMs: number, locale: Locale): string {
  const dayStart = parseIsoDate(date)
  if (dayStart === null) return date
  const todayStart = Math.floor(nowMs / DAY) * DAY
  return relativeTime(dayStart, todayStart, locale)
}

/**
 * The absolute date, spelled out — the tooltip behind every relative label.
 *
 * `Intl.DateTimeFormat` is fine *here*, unlike for the relative strings: it
 * renders a date, not a sentence, so there is no translated text to keep in
 * step with the dictionary. Forced to UTC so a stored `YYYY-MM-DD` is not
 * shifted a day backwards for readers west of Greenwich.
 */
export function absoluteDate(date: string, locale: Locale): string {
  const dayStart = parseIsoDate(date)
  if (dayStart === null) return date
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(dayStart))
}
