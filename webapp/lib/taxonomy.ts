/**
 * The closed vocabularies the schema and the UI both have to agree on.
 *
 * Outside `convex/` for the same reason lib/scoring.ts is: two sides need them.
 * `convex/schema.ts` builds its `eventType` validator from `EVENT_TYPES` here,
 * and the feed's filter chips render the same list — so a kind added to the
 * database is a kind the filter offers, without a second edit and without the
 * two drifting into a filter that cannot select an event that exists.
 *
 * Nothing in this file may import from `convex/` or from React: it is loaded
 * both inside Convex's V8 runtime (through the schema) and in the browser.
 */

// --- event types ----------------------------------------------------------

/**
 * What kind of parliamentary record an entry in the unified feed came from.
 *
 * Order is the one `convex/schema.ts` declares and the one the filter chips
 * render in, so the two cannot disagree about what "all types" means.
 */
export const EVENT_TYPES = [
  "motion",
  "speech",
  "vote",
  "question",
  "bill",
  "committee",
  "activity",
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value)
}

// --- mandate types --------------------------------------------------------

/**
 * How a member won their seat, as the values Stammdaten writes.
 *
 * `MANDATSART` verbatim — `Direktwahl` for a constituency won outright,
 * `Landesliste` for a seat taken from a party's state list. Stored raw on
 * `mps.electionMethod` (convex/schema.ts) and compared against verbatim rather
 * than derived from whether `constituency` is null. Those two agree today and
 * are different claims: a direct mandate whose constituency name failed to
 * ingest would be counted as a list MP by the derivation, silently, and every
 * count on the site would report a chamber with more list seats than it has.
 *
 * Here rather than in a component because four surfaces now need them — the
 * roster's filter, the badge, the parties dashboard's split and the Convex
 * query that aggregates it — and `convex/` may not import from a React-adjacent
 * path. This module is already the one both sides share; see the file header.
 *
 * **Nullable at the source.** An MP whose mandate type was not ingested is
 * *unknown*, not a list MP, so every consumer must keep the third case rather
 * than folding it into a default. `mandateType` below is what does the
 * narrowing, and it returns null rather than guessing.
 */
export const MANDATE_TYPES = ["Direktwahl", "Landesliste"] as const

export type MandateType = (typeof MANDATE_TYPES)[number]

/**
 * `electionMethod` narrowed to a known mandate type, or null.
 *
 * Null for an absent value *and* for an unrecognised one — a spelling this
 * vocabulary does not know is exactly as unusable as a missing one, and
 * returning it anyway would put an unlabelled value into a badge.
 */
export function mandateType(electionMethod: string | null | undefined): MandateType | null {
  if (electionMethod === null || electionMethod === undefined) return null
  return (MANDATE_TYPES as readonly string[]).includes(electionMethod)
    ? (electionMethod as MandateType)
    : null
}

/**
 * The translation key naming each mandate type.
 *
 * The keys the roster's filter already used (`mps.electionDirect` /
 * `mps.electionList`), pointed at from here rather than restated — the badge,
 * the roster's constituency fallback and the parties dashboard's split all name
 * the same two things, and a second pair of strings would be a second
 * vocabulary free to drift from the filter that selects on it.
 *
 * Typed as the literal keys rather than as `TranslationKey`: this module may
 * not import from lib/i18n.ts (it is loaded inside Convex's V8 runtime through
 * the schema — see the file header), and a `string` here would let a typo reach
 * `t()` as a missing key. The consumers are all in the browser and check the
 * value against their own `TranslationKey` at the call site.
 */
export const MANDATE_LABEL_KEYS = {
  Direktwahl: "mps.electionDirect",
  Landesliste: "mps.electionList",
} as const satisfies Record<MandateType, string>

// --- ranking metrics ------------------------------------------------------

/**
 * The columns a leaderboard can be ordered by.
 *
 * Every one of these is a stored field on an `activityScores` row, which is
 * what makes a leaderboard one indexed slice read and sorted rather than a
 * per-MP recomputation. The two leaderboards that are *not* here — cross-party
 * dissent and month-on-month rise — are separate queries because neither is a
 * field: one is derived from ballots, the other from two months compared.
 *
 * ⚠ `speechCount` is rankable in the sense that it sorts, and misleading in the
 * sense §5.2 of docs/api-research.md documents: question time fragments a
 * minister's turn into dozens of replies, so ranking by segment count puts
 * Robert Habeck 36 speeches above Olaf Scholz for saying 25 % less.
 * `speechWordCount` is what scoring actually weighs. Both are offered, and the
 * UI carries the caveat — hiding the count would not make the question go away,
 * it would just make the answer unavailable.
 */
export const RANKING_METRICS = [
  "totalScore",
  "motionCount",
  "speechCount",
  "speechWordCount",
  "questionCount",
  "reportCount",
  "voteParticipationRate",
  "committeeCount",
  "billSponsorshipCount",
] as const

export type RankingMetric = (typeof RANKING_METRICS)[number]

export function isRankingMetric(value: string): value is RankingMetric {
  return (RANKING_METRICS as readonly string[]).includes(value)
}

export type SortDirection = "asc" | "desc"

// --- age brackets ---------------------------------------------------------

/**
 * Age brackets for the rankings filter.
 *
 * Derived from `mps.birthDate`, which is nullable — the Stammdaten dump does
 * carry it, but an MP whose record lacks one is filtered *out* of every bracket
 * rather than into a default. That is the honest behaviour: an unknown age is
 * not an age, and quietly bucketing it would make a bracket's membership a
 * claim the source does not support.
 *
 * Bounds are inclusive at both ends. `70plus` is open at the top because the
 * alternative is a bracket that silently drops the chamber's oldest members.
 */
export const AGE_GROUPS = {
  u30: { min: 0, max: 29 },
  "30s": { min: 30, max: 39 },
  "40s": { min: 40, max: 49 },
  "50s": { min: 50, max: 59 },
  "60s": { min: 60, max: 69 },
  "70plus": { min: 70, max: Number.POSITIVE_INFINITY },
} as const satisfies Record<string, { min: number; max: number }>

export type AgeGroup = keyof typeof AGE_GROUPS

export const AGE_GROUP_KEYS = Object.keys(AGE_GROUPS) as AgeGroup[]

export function isAgeGroup(value: string): value is AgeGroup {
  return value in AGE_GROUPS
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Completed years between `birthDate` and `nowMs`, or null if unusable.
 *
 * Null rather than a guess for an absent or malformed date, so a caller has to
 * decide what an unknown age means instead of inheriting a zero that would put
 * every undated MP in the youngest bracket.
 *
 * Compared in UTC throughout. Stored dates are UTC-anchored `YYYY-MM-DD`
 * (see the schema header), and mixing them with a local-time "today" would move
 * a birthday across a day boundary for readers west of Greenwich — harmless for
 * one day, but it would make the same MP fall in different brackets for
 * different readers.
 */
export function ageOn(birthDate: string | null, nowMs: number): number | null {
  if (birthDate === null) return null
  const match = ISO_DATE_PATTERN.exec(birthDate)
  if (!match) return null
  const [, year, month, day] = match.map(Number)

  const now = new Date(nowMs)
  let age = now.getUTCFullYear() - year
  // Not yet had this year's birthday: month is 1-based here, 0-based on Date.
  const monthDelta = now.getUTCMonth() + 1 - month
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < day)) age--

  return age < 0 || age > 130 ? null : age
}

/** Whether an MP's birth date puts them in `group`. An unknown age is in no
 * group — see the note on `AGE_GROUPS`. */
export function inAgeGroup(birthDate: string | null, group: AgeGroup, nowMs: number): boolean {
  const age = ageOn(birthDate, nowMs)
  if (age === null) return false
  const { min, max } = AGE_GROUPS[group]
  return age >= min && age <= max
}

// --- months ---------------------------------------------------------------

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonth(value: string): boolean {
  return MONTH_PATTERN.test(value)
}

/**
 * The `YYYY-MM` before `month`, or null if `month` is not one.
 *
 * Zero-padding is not cosmetic here: `convex/activityScores.ts` rejects an
 * unpadded month precisely because `"2026-6"` sorts *above* every real date in
 * its year, so a bound built from one matches nothing and reports a working
 * month as zero. This produces the padded form or nothing.
 */
export function previousMonth(month: string): string | null {
  if (!isMonth(month)) return null
  const [year, index] = month.split("-").map(Number)
  const previous = index === 1 ? { year: year - 1, index: 12 } : { year, index: index - 1 }
  return `${previous.year}-${String(previous.index).padStart(2, "0")}`
}
