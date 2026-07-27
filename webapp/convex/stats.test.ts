import { describe, expect, test } from "bun:test"
import { peakConcurrentMandates } from "./stats"

/**
 * Tests for the chamber size of a period that has ended.
 *
 * `countMPs` counts open-ended mandates, which is right while a period is
 * running and reports **zero** once it is over: every row of a closed period
 * carries the dissolution as its `end`. Zero then sets `empty` on the stats,
 * and the home page says a fully-backfilled period has no data — a silent
 * failure, because zero is a number the UI renders happily.
 *
 * The replacement counts the largest number of mandates that overlapped on any
 * one day, which is the seat count rather than the row count. Worth testing on
 * its own for the same reason: every wrong answer here is a plausible one.
 */

const mandate = (start: string, end: string | null) => ({ datesInOffice: { start, end } })

describe("peakConcurrentMandates", () => {
  test("a seat vacated and refilled is one seat, not two", () => {
    // The whole point. Counting rows would say 2, and a period fifteen years
    // old has no published figure to check that against.
    expect(
      peakConcurrentMandates([
        mandate("2021-10-26", "2023-06-30"),
        mandate("2023-07-01", "2025-03-25"),
      ]),
    ).toBe(1)
  })

  test("mandates that genuinely overlap each count", () => {
    expect(
      peakConcurrentMandates([
        mandate("2021-10-26", "2025-03-25"),
        mandate("2021-10-26", "2025-03-25"),
        mandate("2023-01-01", "2025-03-25"),
      ]),
    ).toBe(3)
  })

  test("WP21's arithmetic: 635 rows, 5 departures, 5 replacements, 630 seats", () => {
    // §6.2's reconciliation, which is the figure the Bundestag publishes. The
    // live period reaches it through the open-mandate branch; this checks the
    // date sweep agrees, so the number does not move the day WP21 closes.
    const rows = [
      ...Array.from({ length: 630 }, () => mandate("2025-03-25", null)),
      // Five who left mid-period, each replaced the next day.
      ...Array.from({ length: 5 }, () => mandate("2025-03-25", "2026-01-31")),
    ]
    // Five of the 630 open rows stand in for the replacements who began later.
    rows.splice(0, 5, ...Array.from({ length: 5 }, () => mandate("2026-02-01", null)))

    expect(peakConcurrentMandates(rows)).toBe(630)
  })

  test("a mandate ending the day another begins is one seat", () => {
    // Ends are exclusive-by-one-day for exactly this: a same-day handover is a
    // succession, not a doubling.
    expect(
      peakConcurrentMandates([
        mandate("2021-10-26", "2023-06-30"),
        mandate("2023-06-30", "2025-03-25"),
      ]),
    ).toBe(1)
  })

  test("an unknown span counts throughout rather than not at all", () => {
    // The span is unknown, not empty — dropping these would under-report the
    // chamber on a partial ingest, which is the same call `countMPs` makes.
    expect(
      peakConcurrentMandates([{ datesInOffice: null }, mandate("2021-10-26", "2025-03-25")]),
    ).toBe(2)
  })

  test("no mandates is no seats", () => {
    expect(peakConcurrentMandates([])).toBe(0)
  })
})
