import { describe, expect, test } from "bun:test"
import type { QueryCtx } from "./_generated/server"
import { recordingCtx } from "./lib/readRecorder.testing"
import { getFractionSizes, listPeriods } from "./mps"
import { getChamberStats, peakConcurrentMandates } from "./stats"

/**
 * Convex's `query()` wraps the handler as `_handler` — visible at runtime
 * even though the public type does not expose it. The two other Convex
 * suites in this tree that need to invoke a real handler (`votes.test.ts`
 * for backfill outcomes) do it by extracting the handler as a named
 * exported function; that pattern is heavier for a handful of read-only
 * assertions. Reaching for `_handler` here is a scoped local cast per test
 * — the alternative is a refactor that peels every counter handler out to
 * a `*_Handler` sibling, which the review flagged as unnecessary for M1.
 */
type QueryHandler<TArgs, TResult> = (ctx: QueryCtx, args: TArgs) => Promise<TResult>
function handlerOf<TArgs, TResult>(fn: unknown): QueryHandler<TArgs, TResult> {
  return (fn as { _handler: QueryHandler<TArgs, TResult> })._handler
}

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
 * clean WP21 backfill would. `docs/historical-coverage.md`'s "A pre-existing
 * discrepancy this exposed" section (near the end of the file at the time
 * of writing) reports `getChamberStats` = 642 and `getFractionSizes` = 647
 * on a specific historical run. That is a *data* condition — residual rows
 * from an earlier ingest that the pipeline no longer overwrites — and a
 * Convex test cannot see it. The paragraph in the doc concludes correctly
 * that "both figures are larger than the source, which points at ingested
 * rows rather than at the counting"; a periodic operator check runs the
 * roster import fresh and de-dupes. Reference by section rather than by
 * line number because a doc edit shifts numbered lines quietly.
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

/**
 * The seat-vs-mandate invariant, held at the caller level — the shape M1
 * called out.
 *
 * The suite above pins `peakConcurrentMandates` (the helper) and the pure
 * arithmetic of a WP21-shaped fixture. That is not the same as pinning what
 * each *query* returns. The review's concrete regression: change `countMPs`
 * (stats.ts:140-151) from `peakConcurrentMandates(rows)` to `rows.length`
 * — a plausible "simplification" that swaps seats for rows. The helper is
 * untouched, so the pure suite passes; but `getChamberStats.mps.count`
 * would silently flip from 630 to 635 for WP21 and the home page's hero
 * would start contradicting the Bundestag's own published chamber size.
 *
 * These three tests exercise the actual caller handlers over a
 * WP21-shaped mandate fixture (5 same-day successions on a 630-seat
 * chamber = 635 rows, 630 seats) so a refactor that swaps the source in
 * `countMPs` or that reroutes `getFractionSizes` /
 * `listPeriods[].mandates` through `peakConcurrentMandates` fails at the
 * query boundary. `getChamberStats`'s tally over `activityScores`
 * (speeches, motions, questions, namedVotes) is not the subject here; the
 * fixture holds empty rows for those tables and the counts read as zero,
 * which is fine — the assertion is on `.mps.count` alone.
 */
describe("chamber-count queries preserve their own semantics", () => {
  /** WP21-shaped mandate fixture: 625 opened mandates + 5 same-day
   * successions (5 rows that ended 2026-01-31, replaced by 5 that opened
   * 2026-02-01). Total rows = 635, peak-concurrent = 630. */
  function wp21Roster() {
    const opened = Array.from({ length: 625 }, (_, i) => ({
      _id: `mp-open-${i}`,
      wahlperiode: 21,
      fraktion: i % 2 === 0 ? "SPD" : "CDU/CSU",
      datesInOffice: { start: "2025-03-25", end: null } as { start: string; end: string | null },
    }))
    const departed = Array.from({ length: 5 }, (_, i) => ({
      _id: `mp-dep-${i}`,
      wahlperiode: 21,
      fraktion: "SPD",
      datesInOffice: { start: "2025-03-25", end: "2026-01-31" } as {
        start: string
        end: string | null
      },
    }))
    const replaced = Array.from({ length: 5 }, (_, i) => ({
      _id: `mp-rep-${i}`,
      wahlperiode: 21,
      fraktion: "SPD",
      datesInOffice: { start: "2026-02-01", end: null } as { start: string; end: string | null },
    }))
    return [...opened, ...departed, ...replaced]
  }

  test("getChamberStats.mps.count returns seats (peak-concurrent), not mandate rows", async () => {
    // A refactor that swapped `peakConcurrentMandates(rows)` for
    // `rows.length` in countMPs would flip this to 635 and fail here — the
    // whole point of M1. The fixture's 5 departed rows all have `end` set
    // and 5 replacements are still open, so on this live-period fixture
    // (open > 0) `countMPs` takes the open-count branch and returns 630.
    const mps = wp21Roster()
    const { ctx } = recordingCtx({ mps, voteSheets: [], motions: [], questions: [], activityScores: [] })
    const stats = await handlerOf<{ wahlperiode: number }, { mps: { count: number; exact: boolean } }>(
      getChamberStats,
    )(ctx, { wahlperiode: 21 })
    // 630 sitting members, not the 635 mandate rows. This is what the
    // Bundestag publishes as chamber size.
    expect(stats.mps).toEqual({ count: 630, exact: true })
  })

  test("getChamberStats over a closed period returns the peak-concurrent seat count", async () => {
    // The other branch of countMPs: a closed period has every mandate row
    // carrying an `end`, so the open-count filter yields 0 and the branch
    // falls through to `peakConcurrentMandates`. A regression that stopped
    // computing the sweep on the closed path would report 0 for every
    // historical period and set `empty: true`, which the home page renders
    // as "no data for this Wahlperiode".
    const rows = [
      { _id: "wp20-a", wahlperiode: 20, fraktion: "SPD", datesInOffice: { start: "2021-10-26", end: "2025-03-25" } },
      { _id: "wp20-b", wahlperiode: 20, fraktion: "CDU/CSU", datesInOffice: { start: "2021-10-26", end: "2023-06-30" } },
      { _id: "wp20-c", wahlperiode: 20, fraktion: "CDU/CSU", datesInOffice: { start: "2023-07-01", end: "2025-03-25" } },
    ]
    const { ctx } = recordingCtx({ mps: rows, voteSheets: [], motions: [], questions: [], activityScores: [] })
    const stats = await handlerOf<{ wahlperiode: number }, { mps: { count: number; exact: boolean }; empty: boolean }>(
      getChamberStats,
    )(ctx, { wahlperiode: 20 })
    // 3 mandate rows, 2 concurrent seats (b hands over to c on 2023-06-30
    // → 2023-07-01, a stays throughout). A regression to `rows.length`
    // would report 3 seats for a two-seat chamber.
    expect(stats.mps).toEqual({ count: 2, exact: true })
    expect(stats.empty).toBe(false)
  })

  test("getFractionSizes preserves mandate-row counts, not seat counts", async () => {
    // The sibling assertion: `getFractionSizes` counts *rows* per group,
    // and the sum is deliberately allowed to exceed
    // `getChamberStats.mps.count` because the two answer different
    // questions. A refactor that reached for `peakConcurrentMandates`
    // inside `getFractionSizes` would silently move it to the seat side,
    // and the home page's per-group cards would then disagree with the
    // seating arc (which walks every mandate row).
    const mps = wp21Roster()
    const rows = await handlerOf<{ wahlperiode: number }, Array<{ fraktion: string; count: number }>>(
      getFractionSizes,
    )(ctx({ mps }), { wahlperiode: 21 })
    const total = rows.reduce((sum, row) => sum + row.count, 0)
    // 635 mandate rows, not 630 seats. The row count is the contract; a
    // per-group card that reported 630 would leave the 5 mid-period
    // replacements invisible.
    expect(total).toBe(635)
  })

  test("listPeriods[].mandates preserves mandate-row counts, not seat counts", async () => {
    // The third caller in the seat-vs-row triangle. The period selector
    // shows `{count} Mandate` per period — deliberately labelled "Mandate"
    // rather than "Sitze" — and a refactor that fed the same
    // `peakConcurrentMandates` output would make the selector's number
    // silently disagree with the seating arc it links to.
    const mps = wp21Roster()
    const result = await handlerOf<
      Record<string, never>,
      { periods: Array<{ wahlperiode: number; mandates: number; scored: boolean }>; current: number | null }
    >(listPeriods)(ctx({ mps, activityScores: [] }), {})
    expect(result.periods).toHaveLength(1)
    expect(result.periods[0].wahlperiode).toBe(21)
    // 635, not 630. Same contract as getFractionSizes.
    expect(result.periods[0].mandates).toBe(635)
    expect(result.current).toBe(21)
  })

  /** Recording ctx wrapped as a positional call, so the assertions above
   * stay legible. `handlerOf` returns the raw handler; the ctx it needs
   * is the fake `recordingCtx` produces. */
  function ctx(tables: Record<string, Array<Record<string, unknown> & { _id: string }>>) {
    return recordingCtx(tables).ctx
  }
})
