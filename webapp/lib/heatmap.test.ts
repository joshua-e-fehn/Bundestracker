import { describe, expect, test } from "bun:test"
import {
  buildHeatmapWeeks,
  HEATMAP_LEVELS,
  HEATMAP_RAMP,
  heatmapLevel,
  monthLabels,
  twelveMonthWindow,
} from "./heatmap"

/**
 * Tests for the contribution grid's calendar arithmetic.
 *
 * This is the part of the heatmap that can be wrong without looking wrong. An
 * off-by-one in the Monday alignment shifts every cell by a day and still
 * renders a plausible grid; a timezone slip moves an MP's whole record back a
 * day for readers west of Greenwich and nowhere else. Neither throws, and
 * neither is visible by eye — which is what these are for.
 */

describe("heatmapLevel", () => {
  test("nothing is level 0 and one thing never is", () => {
    // The distinction the whole grid exists to draw. A single event on an
    // otherwise quiet day must not render as an empty cell, however busy the
    // MP's busiest day was.
    expect(heatmapLevel(0, 40)).toBe(0)
    expect(heatmapLevel(1, 40)).toBe(1)
    expect(heatmapLevel(1, 1000)).toBe(1)
  })

  test("the busiest day is the top level", () => {
    expect(heatmapLevel(12, 12)).toBe(HEATMAP_LEVELS)
    expect(heatmapLevel(6, 12)).toBe(2)
  })

  test("an empty window has no levels to assign", () => {
    // max = 0 happens for a real MP with no recorded activity. Dividing by it
    // would make every cell NaN, which indexes the colour ramp at `undefined`
    // and renders unstyled rather than empty.
    expect(heatmapLevel(0, 0)).toBe(0)
    expect(heatmapLevel(3, 0)).toBe(0)
  })
})

describe("HEATMAP_RAMP", () => {
  test("has a colour for every level heatmapLevel can return", () => {
    // The two constants are set independently — one is a count, the other a
    // list — and nothing but this ties them together. A ramp one short indexes
    // at `undefined` for the busiest day in the window, so the cell that
    // matters most renders unstyled: the failure lands on the one day the
    // reader is looking for, and only for MPs busy enough to reach the top
    // level. Hence `+ 1`: level 0 is "nothing happened" and is a real step.
    expect(HEATMAP_RAMP).toHaveLength(HEATMAP_LEVELS + 1)
    for (let level = 0; level <= HEATMAP_LEVELS; level++) {
      expect(HEATMAP_RAMP[level]).toBeString()
    }
  })

  test("is a class list, not a var() list", () => {
    // Both consumers pass these to `className`. A `var(--chart-1)` here would
    // typecheck, render nothing, and look like a data problem rather than a
    // palette one — and Tailwind only emits classes it finds as literal source
    // text, which is why the ramp is spelled out rather than built from a
    // template.
    for (const cls of HEATMAP_RAMP) {
      expect(cls).toMatch(/^bg-chart-[1-5]$/)
    }
  })
})

describe("twelveMonthWindow", () => {
  test("starts on the first of the month eleven months back", () => {
    // Whole columns under the month labels, rather than a window that starts
    // mid-month and puts every label a few days off its column.
    expect(twelveMonthWindow(new Date(Date.UTC(2026, 6, 26)))).toEqual({
      from: "2025-08-01",
      to: "2026-07-26",
    })
  })

  test("crosses a year boundary without arithmetic on the year", () => {
    expect(twelveMonthWindow(new Date(Date.UTC(2026, 0, 15)))).toEqual({
      from: "2025-02-01",
      to: "2026-01-15",
    })
  })
})

describe("buildHeatmapWeeks", () => {
  test("columns are ISO weeks, Monday first", () => {
    // 2026-06-01 is a Monday, 2026-06-14 a Sunday: exactly two full weeks.
    const weeks = buildHeatmapWeeks([], "2026-06-01", "2026-06-14")
    expect(weeks).toHaveLength(2)
    expect(weeks[0].days).toHaveLength(7)
    expect(weeks[0].days[0].date).toBe("2026-06-01")
    expect(weeks[0].days[6].date).toBe("2026-06-07")
    expect(weeks[1].days[0].date).toBe("2026-06-08")
  })

  test("a window opening mid-week gives a short first column", () => {
    // 2026-06-03 is a Wednesday. The days before it are outside the window, so
    // they are omitted rather than emitted as zeroes — a padded cell would be
    // indistinguishable from a real day on which the MP did nothing.
    const weeks = buildHeatmapWeeks([], "2026-06-03", "2026-06-14")
    expect(weeks[0].days.map((day) => day.date)).toEqual([
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ])
  })

  test("a window closing mid-week gives a short last column", () => {
    const weeks = buildHeatmapWeeks([], "2026-06-01", "2026-06-10")
    expect(weeks).toHaveLength(2)
    expect(weeks[1].days.map((day) => day.date)).toEqual(["2026-06-08", "2026-06-09", "2026-06-10"])
  })

  test("counts land on their own day and absent days become zero", () => {
    const weeks = buildHeatmapWeeks(
      [
        { date: "2026-06-02", count: 3 },
        { date: "2026-06-05", count: 1 },
      ],
      "2026-06-01",
      "2026-06-07",
    )
    expect(weeks[0].days.map((day) => day.count)).toEqual([0, 3, 0, 0, 1, 0, 0])
  })

  test("counts outside the window are ignored, not clamped in", () => {
    // The window is this function's argument, not the query's. A stray row from
    // outside it must not be folded onto the nearest edge day, where it would
    // read as activity that happened then.
    const weeks = buildHeatmapWeeks(
      [
        { date: "2026-05-30", count: 9 },
        { date: "2026-06-03", count: 2 },
      ],
      "2026-06-01",
      "2026-06-07",
    )
    const total = weeks.flatMap((week) => week.days).reduce((sum, day) => sum + day.count, 0)
    expect(total).toBe(2)
  })

  test("a Sunday start is one day, not a whole week", () => {
    // The `(getUTCDay() + 6) % 7` conversion exists for this: `getUTCDay()` is
    // 0 for Sunday, which is six days *into* an ISO week, not zero. Reading it
    // raw would back the cursor up seven days and prepend a phantom column.
    const weeks = buildHeatmapWeeks([], "2026-06-07", "2026-06-07")
    expect(weeks).toHaveLength(1)
    expect(weeks[0].days).toEqual([{ date: "2026-06-07", count: 0 }])
  })

  test("a full year of days is accounted for exactly once", () => {
    // The guard against the class of bug this file exists for: a day duplicated
    // or dropped at a week boundary changes no cell's colour, so it is invisible
    // until someone counts.
    const { from, to } = twelveMonthWindow(new Date(Date.UTC(2026, 6, 26)))
    const days = buildHeatmapWeeks([], from, to).flatMap((week) => week.days)
    expect(new Set(days.map((day) => day.date)).size).toBe(days.length)
    expect(days[0].date).toBe(from)
    expect(days[days.length - 1].date).toBe(to)
  })

  test("an inverted or malformed window is empty rather than infinite", () => {
    expect(buildHeatmapWeeks([], "2026-06-14", "2026-06-01")).toEqual([])
    expect(buildHeatmapWeeks([], "2026-6-1", "2026-06-14")).toEqual([])
  })
})

describe("monthLabels", () => {
  test("labels the first column each month appears in", () => {
    const weeks = buildHeatmapWeeks([], "2026-05-25", "2026-07-05")
    const labels = monthLabels(weeks)
    expect(labels.map((label) => label.month)).toEqual(["2026-05", "2026-06", "2026-07"])
    // May opens the first column; June's first day (the 1st) is a Monday, so it
    // opens the second.
    expect(labels[0].weekIndex).toBe(0)
    expect(labels[1].weekIndex).toBe(1)
  })

  test("a month sharing a column with the previous one gets no second label", () => {
    // 2026-08-01 is a Saturday, so it sits in July's last column. One column
    // cannot carry two labels legibly, and the earlier month owns it.
    const weeks = buildHeatmapWeeks([], "2026-07-27", "2026-08-02")
    expect(monthLabels(weeks).map((label) => label.month)).toEqual(["2026-07"])
  })
})
