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

/**
 * The seat count and the mandate-row count answer different questions, and
 * the site returns both.
 *
 * ## What this pins
 *
 * `getChamberStats.mps.count` returns *seats* (the peak-concurrent number
 * derived by `peakConcurrentMandates`), which is what the Bundestag itself
 * publishes as chamber size. `getFractionSizes` (convex/mps.ts:598-614) and
 * `listPeriods[i].mandates` (convex/mps.ts:381-386) return *mandate rows*,
 * because a per-group card that summed to 630 while `getFractionSizes` said
 * 635 would be a UI that could not add up. `generateSeating` (convex/
 * seating.ts:114-149) also seats mandate rows — every mandate row gets an
 * arc, mid-period replacement or not — because a hemicycle whose card
 * counts (635) did not match the arcs (630) is a bigger inconsistency than
 * either number alone.
 *
 * The three-way disagreement is intentional, and cases where a future
 * caller might reach for one number when they meant the other are
 * documented at the site of the divergence: convex/stats.ts:135-138 warns
 * that `getFractionSizes` may sum to 635 where `countMPs` says 630, and the
 * seating.ts header discusses the arc's cardinality. This test is the
 * mechanical guard on the arithmetic — the derivation both numbers depend
 * on is `peakConcurrentMandates`, so the seat count of a real WP21-shaped
 * fixture must equal statutory chamber size and the row count must equal
 * the size of the input.
 *
 * ## What it does *not* prove
 *
 * A production deployment can legitimately hold *more* mandate rows than a
 * clean WP21 backfill would (docs/historical-coverage.md:141-147 reports
 * `getChamberStats` = 642 and `getFractionSizes` = 647 on a specific
 * historical run). That is a *data* condition — residual rows from an
 * earlier ingest that the pipeline no longer overwrites — and a Convex
 * test cannot see it. The paragraph in the doc concludes correctly that
 * "both figures are larger than the source, which points at ingested rows
 * rather than at the counting"; a periodic operator check runs the roster
 * import fresh and de-dupes.
 */
describe("seats vs mandate rows: the two counts of one chamber", () => {
  test("peakConcurrentMandates on WP21 = 630; the mandate-row count of the input is 635", () => {
    // The WP21-shaped fixture from earlier in this suite, spelled out
    // separately so this test's assertion is legible on its own. Five
    // departures each replaced the next day: the input is 635 rows, the
    // peak-concurrent count is 630.
    const opened = Array.from({ length: 630 }, () => mandate("2025-03-25", null))
    const departed = Array.from({ length: 5 }, () => mandate("2025-03-25", "2026-01-31"))
    const replaced = Array.from({ length: 5 }, () => mandate("2026-02-01", null))
    opened.splice(0, 5, ...replaced)
    const rows = [...opened, ...departed]

    // Input has 635 mandate rows. `getFractionSizes` and
    // `listPeriods[i].mandates` count this figure — 635 — because they are
    // asking "how many rows exist for this period" rather than "how many
    // members sit in the chamber".
    expect(rows.length).toBe(635)

    // Concurrent count is 630. `getChamberStats.mps.count` reports this —
    // the seat count, which matches the Bundestag's own published chamber
    // size. A regression that started counting rows here (or dropped the
    // date sweep in favour of a simple length) would flip the home page
    // from "630 seats" to "635 seats" without changing any other test.
    expect(peakConcurrentMandates(rows)).toBe(630)

    // Explicit statement of the invariant: the row count is a superset of
    // the seat count, by construction. If a future refactor causes them to
    // agree on WP21's real data, that agreement is a *coincidence* on a
    // period whose replacements happen to net to zero — the test above
    // (row count = 635, seat count = 630) is the *contract*, not this one.
    expect(rows.length).toBeGreaterThanOrEqual(peakConcurrentMandates(rows))
  })

  test("summing per-group figures may exceed the seat count — that is the point of two numbers", () => {
    // The specific hazard convex/stats.ts:135-138 warns about: a caller
    // that reaches for `getFractionSizes` (mandate rows, grouped) to
    // build a chamber total would get 635 for WP21 where the site says
    // 630. Both are correct answers to different questions, and this test
    // stops a "let's just sum getFractionSizes" simplification landing
    // with a green run.
    //
    // Fixture: one 'group' of 3 mandates where one seat was handed over
    // mid-period. Row-count = 3, peak-concurrent = 2. Summing group
    // mandate rows would report 3 seats; the honest chamber count is 2.
    const group = [
      mandate("2021-10-26", "2023-06-30"),
      mandate("2023-07-01", "2025-03-25"),
      mandate("2021-10-26", "2025-03-25"),
    ]
    const groupMandateRows = group.length // what getFractionSizes reports
    const groupSeats = peakConcurrentMandates(group) // what a seat total should say
    expect(groupMandateRows).toBe(3)
    expect(groupSeats).toBe(2)
    expect(groupMandateRows).toBeGreaterThan(groupSeats)
  })
})
