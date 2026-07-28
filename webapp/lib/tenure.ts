/**
 * Time in office as a denominator.
 *
 * ## The problem this fixes
 *
 * Every leaderboard on this site ranks a total. A total is a fair comparison
 * only between members who had the same amount of time to accumulate it, and in
 * a Bundestag they do not: `datesInOffice` is stored per mandate
 * (convex/schema.ts) precisely because members join and leave mid-period. A
 * member sworn in eighteen months into a term appears on the "least recorded
 * activity" board against colleagues with twice the exposure, and the board
 * reads as a judgement about them rather than about their start date.
 *
 * That field existed and nothing divided by it. This module is the divider.
 *
 * ## Per 30 days, called a sitting month
 *
 * The unit is a 30-day month rather than a calendar one, so the divisor is a
 * count of days and not a calendar walk. It is a *rate*, so the choice of unit
 * only scales every member identically — what matters is that the unit is named
 * on the page, which `rankings.column.perMonth` does.
 *
 * ⚠ **It is not "per sitting week".** The Bundestag sits in sitting weeks —
 * roughly twenty a year — and a member's activity is concentrated in them, so a
 * true exposure denominator would count sitting weeks in the mandate span rather
 * than days. No dataset publishes the sitting calendar (§9 lists what the
 * sources carry, and it is not among them), so this divides by elapsed time and
 * the UI says so. Over a whole period the two are close, because sitting weeks
 * are spread evenly through it; over one month they are not, which is why
 * `rankings.caveat.normalised` states the limit rather than leaving it implied.
 *
 * Free of React and of `convex/`, like lib/scoring.ts and lib/dissent.ts, and
 * for the same reason: the server ranks by this figure and the browser shows it,
 * so a second copy of the formula is a second answer to "how active per month".
 */

/** One mandate's span within a period, as `mps.datesInOffice` stores it. An
 * open `end` means still serving — §6.2 is why that stays distinguishable from
 * a date, and this module has to honour the distinction to compute anything. */
export type MandateSpan = { start: string; end: string | null } | null | undefined

/** Days in the 30-day month this module normalises to. */
export const DAYS_PER_MONTH = 30

/**
 * Days below which no rate is claimed.
 *
 * ⚠ The part that is easy to leave out, and the same guard `DISSENT_MIN_BALLOTS`
 * puts on a dissent rate, for the same reason. A member sworn in four days ago
 * who tabled one motion has a rate of 7.5 motions per month — the highest in the
 * chamber, on one motion — and would top a board built to correct for exactly
 * that kind of distortion.
 *
 * 30 days: a member is compared on a per-month basis, so a member must have been
 * in office a month to be on the board at all. Below it `normalisedScore`
 * returns null, which is not zero — see there.
 */
export const MIN_TENURE_DAYS = 30

const MS_PER_DAY = 86_400_000

/** Parsed as UTC midnight, matching the schema's convention that every date is
 * a UTC calendar day. A bare `Date.parse("2025-03-25")` is already UTC, but the
 * explicit time is what keeps it that way if the format ever gains one. */
function parseDay(iso: string): number | null {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

/**
 * How many days a mandate has run, up to `asOf`.
 *
 * ## The three cases
 *
 *  - **A closed span** (`end` is a date) counts to that date: the member left,
 *    and their exposure stopped there. Counting to today would keep enlarging
 *    the denominator of someone who is no longer in office, shrinking their rate
 *    every day they are not there.
 *  - **An open span** (`end` is null) counts to `asOf` — still serving, so
 *    exposure is still accruing. That is what §6.2's open end means.
 *  - **No span at all** (`null`, the row predates the field, or an unparseable
 *    date) returns **null**, not zero. See `normalisedScore` for why the
 *    distinction has to survive this far.
 *
 * Inclusive of both endpoints: a member who served exactly one day served one
 * day, not zero. That matters only at the bottom of the range, which is exactly
 * where `MIN_TENURE_DAYS` is looking.
 *
 * `asOf` is threaded in rather than read from `Date.now()` here, the same rule
 * `passes` in convex/rankings.ts follows: every row in one query must be
 * measured against the same instant, or two members' denominators are computed
 * against clocks a few milliseconds apart.
 */
export function tenureDays(span: MandateSpan, asOf: string): number | null {
  if (!span) return null
  const start = parseDay(span.start)
  const now = parseDay(asOf)
  if (start === null || now === null) return null

  const end = span.end === null ? now : parseDay(span.end)
  if (end === null) return null

  // A span ending before it starts is a source error, not a negative tenure.
  // Null rather than a clamp to zero: zero would flow into the rate as "no
  // exposure", and this member's exposure is unknown rather than nil.
  if (end < start) return null

  // A mandate that has not begun — a future start date — is 0 rather than
  // negative, and falls below `MIN_TENURE_DAYS` either way.
  if (end === start) return 1
  return Math.floor((end - start) / MS_PER_DAY) + 1
}

/** Whole 30-day months a mandate has run, as a fraction. Null propagates. */
export function tenureMonths(span: MandateSpan, asOf: string): number | null {
  const days = tenureDays(span, asOf)
  if (days === null) return null
  return days / DAYS_PER_MONTH
}

/**
 * A total, restated as a rate per 30 days in office.
 *
 * ## Null is the answer, not zero
 *
 * Returned for a mandate with no recorded span and for one shorter than
 * `MIN_TENURE_DAYS`, and in both cases it means **"this member cannot be ranked
 * on this board"** rather than "this member scored nothing".
 *
 * The distinction is the whole point of the feature. A normalised board exists
 * to stop a short-serving member being read as inactive; returning 0 for the
 * member whose tenure is unknown or too short would put them at the bottom of
 * the *normalised* board too, which is the original injustice with an extra step.
 * Callers drop nulls from the ranking — see `getNormalisedRankings` in
 * convex/rankings.ts, which reports how many it dropped so the page can say so.
 *
 * Rounded to two places, matching `computeScore` in lib/scoring.ts and for the
 * same reason: this value is sorted on, and an unrounded float orders two
 * identical rates on the last bit.
 */
export function normalisedScore(total: number, span: MandateSpan, asOf: string): number | null {
  if (!Number.isFinite(total)) return null
  const months = tenureMonths(span, asOf)
  if (months === null || months <= 0) return null
  if (months * DAYS_PER_MONTH < MIN_TENURE_DAYS) return null
  return Math.round((total / months) * 100) / 100
}
