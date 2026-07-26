/**
 * The trend charts' month arithmetic, and the five series as data.
 *
 * Separated from the component that draws them for lib/heatmap.ts' reason: this
 * is the part that can be wrong without looking wrong. A gap-filling bug draws a
 * line straight from March to June and it still looks like a line — it just
 * silently claims the Bundestag rose for two months. A test catches that; an eye
 * does not.
 *
 * Everything here is UTC and every month is a zero-padded `YYYY-MM`, matching
 * `activityScores.month` and the guard `monthWindow` puts on it in
 * convex/activityScores.ts. That padding is load-bearing rather than cosmetic:
 * `"2026-6"` sorts *above* every real date in its year, so an unpadded month
 * silently sorts to the end of a chart's x-axis instead of into June.
 *
 * Nothing here imports from `convex/` or from React, in the same spirit as
 * lib/taxonomy.ts: `convex/activityScores.ts` needs `MONTH_PATTERN`'s meaning
 * and the browser needs the series table, and neither should reach into the
 * other's runtime.
 */

import type { TranslationKey } from "./i18n"

// --- month arithmetic -----------------------------------------------------

/** Zero-padded `YYYY-MM`, months 01…12. The same shape `monthWindow` enforces
 * in convex/activityScores.ts and `isMonth` tests in lib/taxonomy.ts — restated
 * here rather than imported so this module stays free of both. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isTrendMonth(value: string): boolean {
  return MONTH_PATTERN.test(value)
}

/** The `YYYY-MM` `count` months after `month`, or null if `month` is not one.
 * Negative counts step backwards. Produces the padded form or nothing — see the
 * header on why an unpadded month is worse than no month. */
export function shiftMonth(month: string, count: number): string | null {
  if (!isTrendMonth(month)) return null
  const [year, index] = month.split("-").map(Number)
  // Through a zero-based month index so the year carries correctly in both
  // directions: `index - 1 + count` can go below zero or past eleven, and
  // `Math.floor` divides the right way for negatives where a truncating `/`
  // would not.
  const zeroBased = index - 1 + count
  const shiftedYear = year + Math.floor(zeroBased / 12)
  const shiftedIndex = ((zeroBased % 12) + 12) % 12
  return `${shiftedYear}-${String(shiftedIndex + 1).padStart(2, "0")}`
}

/**
 * Every month from `from` to `to` inclusive, in order.
 *
 * Returns an empty list rather than throwing for a malformed or inverted range,
 * because the callers' inputs come from stored rows: a chart with no months
 * renders its empty state, where an exception would take the whole profile page
 * down over one bad row.
 *
 * Bounded at `MAX_MONTHS`. A Wahlperiode is four years, so a real range is ~48
 * entries; the cap exists so a corrupt `9999-12` bound cannot spin here building
 * a hundred thousand strings.
 */
const MAX_MONTHS = 600

export function monthRange(from: string, to: string): string[] {
  if (!isTrendMonth(from) || !isTrendMonth(to) || from > to) return []
  const months: string[] = []
  let cursor: string | null = from
  while (cursor !== null && cursor <= to && months.length < MAX_MONTHS) {
    months.push(cursor)
    cursor = shiftMonth(cursor, 1)
  }
  return months
}

/**
 * The stored monthly rows as a dense, ordered series — one point per calendar
 * month between the first and last row, gaps filled with zeroes.
 *
 * ## Why the gaps are filled here rather than left to the chart
 *
 * `getMonthlyScoresByMP` returns only the months that have a row, because a
 * month with no score is not a row in the database. Handed straight to a line
 * chart, the x-axis becomes *categorical* — the months present, evenly spaced —
 * so a four-month gap renders as one step and the line reads as continuous
 * activity across a recess that happened.
 *
 * ## Why the fill is zero and not null
 *
 * A missing month means the nightly sweep scored no activity in it, which for a
 * *monthly* row is the same statement as a zero: `recomputeScores` writes a row
 * per MP per swept month whether or not anything happened in it, so an absent
 * month is one nothing was recorded in. That differs from the *period* row,
 * where `mp-score-panel.tsx` renders "no row" as "not yet scored" rather than as
 * a zero — there the distinction is between an unscored MP and an inactive one,
 * and there is no surrounding series to place it in.
 *
 * The interior of the range only. Months before the first row and after the last
 * are not invented: the MP's mandate may have started mid-period (§6.2's
 * mid-period overhang), and padding the front with zeroes would draw a flat line
 * through months they were not a member for.
 */
export type TrendPoint = {
  /** `YYYY-MM`. The x-axis key, and sortable as a string because it is padded. */
  month: string
  totalScore: number
  motionCount: number
  speechCount: number
  speechWordCount: number
  questionCount: number
  reportCount: number
  committeeCount: number
  billSponsorshipCount: number
  voteParticipationRate: number
  /** Named ballots in the month, by position — the stacked bar's segments. */
  voteYes: number
  voteNo: number
  voteAbstain: number
  voteInvalid: number
  voteAbsent: number
  /** Questions asked from the first month of the range through this one — the
   * cumulative area chart's series. Accumulated here rather than in the chart so
   * the running total and the monthly bars come from one pass over one list. */
  questionsCumulative: number
}

/** A month with no stored row: measured zero, not missing data. See the note on
 * `buildTrendSeries` for why that is the right reading here and the wrong one on
 * the period total. */
function emptyPoint(month: string): TrendPoint {
  return {
    month,
    totalScore: 0,
    motionCount: 0,
    speechCount: 0,
    speechWordCount: 0,
    questionCount: 0,
    reportCount: 0,
    committeeCount: 0,
    billSponsorshipCount: 0,
    voteParticipationRate: 0,
    voteYes: 0,
    voteNo: 0,
    voteAbstain: 0,
    voteInvalid: 0,
    voteAbsent: 0,
    questionsCumulative: 0,
  }
}

/** What `getMonthlyScoresByMP` returns per month, before gap-filling. */
export type MonthlyScoreRow = Omit<TrendPoint, "questionsCumulative">

export function buildTrendSeries(rows: readonly MonthlyScoreRow[]): TrendPoint[] {
  // Only months the shape allows. A row stored under an unpadded key — which
  // `monthWindow` now rejects, but older rows predate that guard — would
  // otherwise set the range's upper bound past every real month and fill the
  // chart with thousands of empty ones.
  const valid = rows.filter((row) => isTrendMonth(row.month))
  if (valid.length === 0) return []

  const byMonth = new Map(valid.map((row) => [row.month, row]))
  const sorted = [...byMonth.keys()].sort()
  const months = monthRange(sorted[0], sorted[sorted.length - 1])

  let questionsCumulative = 0
  return months.map((month) => {
    const row = byMonth.get(month)
    questionsCumulative += row?.questionCount ?? 0
    return { ...(row ?? emptyPoint(month)), month, questionsCumulative }
  })
}

// --- the chart tabs -------------------------------------------------------

/**
 * The five charts, as data.
 *
 * A table rather than five components, in the same spirit as `LEADERBOARDS` in
 * lib/leaderboards.ts and `SEATING_MODES` in lib/seating.ts: they differ in
 * which fields they read, what shape draws them, and which caveat they carry,
 * and are otherwise the same card. Five components is how the caveat ends up on
 * four of them.
 *
 * Three of the five carry one, and they are the three where a low bar could be
 * read as a finding the sources do not support — the same three structural
 * limits lib/scoring.ts sets out:
 *
 *  - **speeches** — §5.2: a segment is one turn at the floor, so question time
 *    inflates the count. The word count is drawn alongside rather than instead,
 *    for the reason the speeches leaderboard shows both.
 *  - **votes** — §4.4: named ballots are the exception in the Bundestag, so a
 *    month with no bar is overwhelmingly a month with no *named* vote.
 *  - **activity** — the score is a weighted sum whose weighting is a choice
 *    (lib/scoring.ts), and a line going up is worth less if the reader cannot
 *    see that.
 */
export type TrendChartKind = "line" | "bar" | "stackedBar" | "area"

/** One drawn series within a chart. `colorVar` is a CSS custom property from
 * app/globals.css rather than a literal, so a chart is themed by the same
 * palette as the rest of the site and dark mode needs no second table. */
export type TrendSeries = {
  /** Field of `TrendPoint` to plot. Typed against it, so a series naming a
   * field that is not there is a compile error rather than a flat line at zero
   * — recharts renders an unknown `dataKey` as nothing at all. */
  field: keyof Omit<TrendPoint, "month">
  labelKey: TranslationKey
  colorVar: string
}

export type TrendChart = {
  id: string
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  kind: TrendChartKind
  series: TrendSeries[]
  /** The structural limit on what this chart's shape means, if it has one.
   * `undefined` rather than an empty string, so a forgotten caveat is visibly
   * absent — the convention `Leaderboard.caveatKey` and `SeatingMode.caveatKey`
   * already follow. */
  caveatKey?: TranslationKey
  /** Renders the y-axis as a percentage. Only vote participation is a 0…1 rate;
   * every other series is a count or a score. */
  percentAxis?: boolean
}

export const TREND_CHARTS: readonly TrendChart[] = [
  {
    id: "activity",
    labelKey: "trends.chart.activity",
    descriptionKey: "trends.chart.activity.desc",
    kind: "line",
    // `--chart-5` is the brightest end of the monochrome ramp app/globals.css
    // defines for both themes — the one token that reads as a single emphasised
    // line rather than as one category among several.
    series: [{ field: "totalScore", labelKey: "score.total", colorVar: "--chart-5" }],
    caveatKey: "trends.caveat.score",
  },
  {
    id: "speeches",
    labelKey: "trends.chart.speeches",
    descriptionKey: "trends.chart.speeches.desc",
    kind: "bar",
    // Both, side by side, for the reason the speeches leaderboard shows both:
    // §5.2's finding is that the two disagree about who spoke most, and drawing
    // only the ranked one hides the disagreement rather than surfacing it.
    series: [
      { field: "speechCount", labelKey: "rankings.column.speeches", colorVar: "--chart-4" },
      { field: "speechWordCount", labelKey: "rankings.column.words", colorVar: "--chart-2" },
    ],
    caveatKey: "rankings.caveat.speechCount",
  },
  {
    id: "motions",
    labelKey: "trends.chart.motions",
    descriptionKey: "trends.chart.motions.desc",
    kind: "bar",
    // Bills beside motions: both are sponsorships counted from DIP activities
    // and `bucketFor` in lib/scoring.ts routes them to separate components, so
    // showing one without the other would under-report a month's paper output.
    series: [
      { field: "motionCount", labelKey: "rankings.column.motions", colorVar: "--chart-4" },
      { field: "billSponsorshipCount", labelKey: "rankings.column.bills", colorVar: "--chart-2" },
    ],
  },
  {
    id: "questions",
    labelKey: "trends.chart.questions",
    descriptionKey: "trends.chart.questions.desc",
    kind: "area",
    series: [
      { field: "questionsCumulative", labelKey: "trends.cumulative", colorVar: "--chart-3" },
    ],
  },
  {
    id: "votes",
    labelKey: "trends.chart.votes",
    descriptionKey: "trends.chart.votes.desc",
    kind: "stackedBar",
    /**
     * The five ballot positions, stacked in `vote-bar.tsx`'s order and its
     * colours — cast votes first in the order a result is read out, absence
     * last because it is not a position.
     *
     * `--vote-*` rather than the `--chart-*` ramp the other four charts use, and
     * deliberately: those tokens mean *magnitude*, and these mean *which way*.
     * §4.1 distinguishes `Enthaltung` (voted to abstain) from `nichtabgegeben`
     * (did not vote) and convex/schema.ts keeps them as separate values, so a
     * ramp that shaded them as neighbouring intensities would undo exactly the
     * distinction the data preserves.
     */
    series: [
      { field: "voteYes", labelKey: "vote.yes", colorVar: "--vote-yes" },
      { field: "voteNo", labelKey: "vote.no", colorVar: "--vote-no" },
      { field: "voteAbstain", labelKey: "vote.abstain", colorVar: "--vote-abstain" },
      { field: "voteInvalid", labelKey: "vote.invalid", colorVar: "--vote-invalid" },
      { field: "voteAbsent", labelKey: "vote.absent", colorVar: "--vote-absent" },
    ],
    caveatKey: "trends.caveat.namedVotes",
  },
]

/** The tab the panel opens on — the score, which is the one chart that
 * summarises the other four. */
export const DEFAULT_TREND_CHART_ID = "activity"

export function trendChartById(id: string): TrendChart | undefined {
  return TREND_CHARTS.find((chart) => chart.id === id)
}

/**
 * Whether a series has anything to draw.
 *
 * Used to tell "this MP recorded nothing in this window" from "this chart has no
 * data", which look identical once drawn: an axis with a flat line along zero
 * reads as a measured result, and for a chart whose every point is zero it is
 * not one. The panel renders the empty state instead, the same call
 * `mp-profile.tsx` made when it said trends were "planned" rather than drawing
 * an empty axis.
 */
export function hasTrendData(points: readonly TrendPoint[], chart: TrendChart): boolean {
  return points.some((point) => chart.series.some((series) => point[series.field] > 0))
}
