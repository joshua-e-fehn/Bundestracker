import { describe, expect, test } from "bun:test"
import type { MonthlyScoreRow } from "./trends"
import {
  buildTrendSeries,
  hasTrendData,
  isTrendMonth,
  monthRange,
  shiftMonth,
  TREND_CHARTS,
  trendChartById,
} from "./trends"

/**
 * Tests for the trend charts' month arithmetic.
 *
 * The same reason lib/heatmap.test.ts exists: this is the part that can be wrong
 * without looking wrong. A gap-filling bug draws a line straight from March to
 * June and it is still a line — it just claims two months of work that did not
 * happen. A year-boundary slip puts December before January and the chart still
 * renders, in the wrong order. Neither throws, and neither is visible by eye.
 */

/** A stored monthly row, with only the fields a test cares about set. */
function row(month: string, fields: Partial<MonthlyScoreRow> = {}): MonthlyScoreRow {
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
    ...fields,
  }
}

describe("isTrendMonth", () => {
  test("accepts a zero-padded YYYY-MM and nothing else", () => {
    expect(isTrendMonth("2026-06")).toBe(true)
    expect(isTrendMonth("2026-12")).toBe(true)
    expect(isTrendMonth("2026-01")).toBe(true)
  })

  test("rejects an unpadded month", () => {
    // The bug this guard exists for, and the same one `monthWindow` rejects in
    // convex/activityScores.ts: "2026-6" is a plausible month that sorts *above*
    // every real date in its year, so it would land at the right-hand end of
    // every chart regardless of when it happened.
    expect(isTrendMonth("2026-6")).toBe(false)
    expect(isTrendMonth("2026-1")).toBe(false)
  })

  test("rejects months outside 1…12 and shapes that are not months", () => {
    expect(isTrendMonth("2026-00")).toBe(false)
    expect(isTrendMonth("2026-13")).toBe(false)
    expect(isTrendMonth("2026")).toBe(false)
    expect(isTrendMonth("2026-06-18")).toBe(false)
    expect(isTrendMonth("")).toBe(false)
  })

  test("an unpadded month really would sort past every month in its year", () => {
    // Why the above matters, stated as the comparison the sort performs.
    expect("2026-6" > "2026-12").toBe(true)
  })
})

describe("shiftMonth", () => {
  test("steps forward and back within a year", () => {
    expect(shiftMonth("2026-06", 1)).toBe("2026-07")
    expect(shiftMonth("2026-06", -1)).toBe("2026-05")
    expect(shiftMonth("2026-06", 0)).toBe("2026-06")
  })

  test("carries across the year boundary in both directions", () => {
    // The case a truncating division gets wrong: -1 / 12 truncates to 0, so
    // January would step back to month zero of the same year.
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-01", -13)).toBe("2024-12")
    expect(shiftMonth("2026-12", 13)).toBe("2028-01")
  })

  test("always produces the padded form", () => {
    // A shift that emitted "2025-9" would poison every comparison downstream.
    for (const count of [-15, -5, -1, 0, 1, 5, 15]) {
      const shifted = shiftMonth("2026-06", count)
      expect(shifted).not.toBeNull()
      expect(isTrendMonth(shifted as string)).toBe(true)
    }
  })

  test("rejects a month it cannot parse rather than guessing", () => {
    expect(shiftMonth("2026-6", 1)).toBeNull()
    expect(shiftMonth("nonsense", 1)).toBeNull()
  })
})

describe("monthRange", () => {
  test("includes both ends", () => {
    expect(monthRange("2026-01", "2026-04")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"])
  })

  test("a single-month range is that month", () => {
    expect(monthRange("2026-06", "2026-06")).toEqual(["2026-06"])
  })

  test("spans a year boundary in order", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })

  test("an inverted or malformed range is empty rather than an exception", () => {
    // These bounds come from stored rows, and a chart with no months renders its
    // empty state — where a throw would take the whole profile page down.
    expect(monthRange("2026-06", "2026-01")).toEqual([])
    expect(monthRange("2026-6", "2026-09")).toEqual([])
    expect(monthRange("", "")).toEqual([])
  })

  test("a whole Wahlperiode is a chart-sized list", () => {
    // Four years. The cap exists for a corrupt bound, not for a real range.
    expect(monthRange("2025-03", "2029-03")).toHaveLength(49)
  })
})

describe("buildTrendSeries", () => {
  test("fills the months between two rows with zeroes", () => {
    // The bug this function exists for. Without the fill, a line chart's x-axis
    // is categorical — just the months present — so this gap renders as one
    // step and the line reads as continuous activity across a recess.
    const points = buildTrendSeries([
      row("2026-01", { totalScore: 10 }),
      row("2026-04", { totalScore: 40 }),
    ])
    expect(points.map((point) => point.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"])
    expect(points.map((point) => point.totalScore)).toEqual([10, 0, 0, 40])
  })

  test("sorts rows that arrive out of order", () => {
    const points = buildTrendSeries([row("2026-03"), row("2026-01"), row("2026-02")])
    expect(points.map((point) => point.month)).toEqual(["2026-01", "2026-02", "2026-03"])
  })

  test("does not invent months outside the range", () => {
    // An MP's mandate can start mid-period (§6.2's overhang), so padding the
    // front with zeroes would draw a flat line through months they were not a
    // member for.
    const points = buildTrendSeries([row("2026-05", { totalScore: 5 })])
    expect(points).toHaveLength(1)
    expect(points[0].month).toBe("2026-05")
  })

  test("accumulates questions across the whole range, gaps included", () => {
    const points = buildTrendSeries([
      row("2026-01", { questionCount: 2 }),
      row("2026-03", { questionCount: 3 }),
      row("2026-04", { questionCount: 1 }),
    ])
    // A cumulative series must never dip: the filled February carries January's
    // total forward rather than resetting to zero.
    expect(points.map((point) => point.questionsCumulative)).toEqual([2, 2, 5, 6])
  })

  test("drops a row stored under an unpadded month", () => {
    // Older rows predate `monthWindow`'s guard. One would otherwise set the
    // range's upper bound past every real month and fill the chart with
    // thousands of empty ones.
    const points = buildTrendSeries([row("2026-01"), row("2026-6"), row("2026-02")])
    expect(points.map((point) => point.month)).toEqual(["2026-01", "2026-02"])
  })

  test("no rows is an empty series, not a single empty month", () => {
    expect(buildTrendSeries([])).toEqual([])
    expect(buildTrendSeries([row("nonsense")])).toEqual([])
  })

  test("keeps the last row when a month appears twice", () => {
    // `(mpInternalId, wahlperiode, month)` is unique in the schema, so this is
    // defensive — but silently summing the two would be worse than picking one.
    const points = buildTrendSeries([
      row("2026-01", { totalScore: 10 }),
      row("2026-01", { totalScore: 20 }),
    ])
    expect(points).toHaveLength(1)
    expect(points[0].totalScore).toBe(20)
  })
})

describe("hasTrendData", () => {
  const votes = trendChartById("votes")
  const activity = trendChartById("activity")

  test("an all-zero series has nothing to draw", () => {
    // The distinction the empty state exists for: an axis with a flat line along
    // zero reads as a measured result, and for a chart of nothing but zeroes it
    // is not one.
    expect(activity).toBeDefined()
    expect(hasTrendData(buildTrendSeries([row("2026-01"), row("2026-02")]), activity!)).toBe(false)
  })

  test("one non-zero point anywhere is data", () => {
    const points = buildTrendSeries([row("2026-01"), row("2026-02", { totalScore: 3 })])
    expect(hasTrendData(points, activity!)).toBe(true)
  })

  test("an absence is a record, not a silence", () => {
    // The case that would be worst to get wrong. An MP who was recorded absent
    // for every ballot in the window has a real, published voting record —
    // §4.1's `nichtabgegeben` column — and the stacked bar exists to show it.
    // Treating "cast nothing" as "no data" would replace that record with
    // "nothing was recorded for this selection", which is the opposite claim
    // and the more flattering one.
    const points = buildTrendSeries([row("2026-01", { voteAbsent: 5 })])
    expect(hasTrendData(points, votes!)).toBe(true)
  })

  test("is answered per chart, not per MP", () => {
    // An MP with a score but no named ballot in the window: the activity chart
    // has something to say and the votes chart does not, and conflating them
    // would draw an empty stacked bar that reads as a chamber that abstained.
    const points = buildTrendSeries([row("2026-01", { totalScore: 12 })])
    expect(votes).toBeDefined()
    expect(hasTrendData(points, activity!)).toBe(true)
    expect(hasTrendData(points, votes!)).toBe(false)
  })
})

describe("TREND_CHARTS", () => {
  test("ids are unique, so a tab selects one chart", () => {
    const ids = TREND_CHARTS.map((chart) => chart.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every chart draws at least one series", () => {
    for (const chart of TREND_CHARTS) {
      expect(chart.series.length).toBeGreaterThan(0)
    }
  })

  test("the vote chart carries all five ballot positions", () => {
    // §4.1's one-hot columns. A stacked bar missing `absent` would show a month
    // of absences as a month of no ballots — the distinction convex/schema.ts
    // keeps `abstain` and `absent` separate to preserve.
    expect(votesFields()).toEqual(["voteYes", "voteNo", "voteAbstain", "voteInvalid", "voteAbsent"])
  })

  test("colours are CSS variables, so both themes are covered", () => {
    // A literal here would be a colour that only works in one theme — the whole
    // reason app/globals.css defines each token twice.
    for (const chart of TREND_CHARTS) {
      for (const series of chart.series) {
        expect(series.colorVar).toMatch(/^--[a-z0-9-]+$/)
      }
    }
  })

  test("the default tab names a chart that exists", () => {
    expect(trendChartById("activity")).toBeDefined()
    expect(trendChartById("no-such-chart")).toBeUndefined()
  })
})

function votesFields(): string[] {
  return (trendChartById("votes")?.series ?? []).map((series) => series.field)
}
