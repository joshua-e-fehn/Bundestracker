import { describe, expect, test } from "bun:test"
import { MAX_SCORE_BATCH, monthWindow, scoreBatchSize } from "./activityScores"
import { pageLimit } from "./lib/ingest"

/**
 * Tests for the scoring window.
 *
 * `monthWindow` turns a `month` argument into the ISO date range every scoring
 * read is bounded by. It is worth testing on its own because its failure mode is
 * silent: a window that matches nothing produces a score of zero, and a zero is
 * a number the UI renders happily. Nothing throws, nothing logs, and the MP
 * simply looks idle for a month they worked.
 */

describe("monthWindow", () => {
  test("null covers the whole Wahlperiode", () => {
    // A closed range wide enough to contain any period, rather than an absent
    // bound — an open-ended range is the shape that eventually scans a table.
    const { from, to } = monthWindow(null)
    expect(from).toBe("1949-01-01")
    expect(to).toBe("2999-12-31")
    expect(from < "2026-06-18").toBe(true)
    expect(to > "2026-06-18").toBe(true)
  })

  test("a month spans its first to its real last day", () => {
    expect(monthWindow("2026-06")).toEqual({ from: "2026-06-01", to: "2026-06-30" })
    expect(monthWindow("2026-01")).toEqual({ from: "2026-01-01", to: "2026-01-31" })
  })

  test("February gets its real length, leap year included", () => {
    // The reason the bound is computed rather than written as "the 31st":
    // "2026-02-31" would sort correctly but silently admit a "2026-02-30" typo
    // from the source as if it were a date.
    expect(monthWindow("2026-02").to).toBe("2026-02-28")
    expect(monthWindow("2024-02").to).toBe("2024-02-29")
  })

  test("rejects an unpadded month rather than scoring it as zero", () => {
    // The bug this test exists for. "2026-6" parses to a valid year and month,
    // so a numeric check passes it — and then every bound built from it sorts
    // *above* every real date in that year, because "6" > "1" lexicographically.
    // The window matches nothing and the MP scores zero for a month they worked,
    // stored under a key no reader will ever query.
    expect(() => monthWindow("2026-6")).toThrow(/zero-padded/)
    expect(() => monthWindow("2026-1")).toThrow(/zero-padded/)
  })

  test("an unpadded bound really would sort past every date in its year", () => {
    // Why the above matters, stated as the comparison the index performs.
    expect("2026-6-01" > "2026-12-31").toBe(true)
  })

  test("rejects months outside 1…12", () => {
    expect(() => monthWindow("2026-00")).toThrow()
    expect(() => monthWindow("2026-13")).toThrow()
  })

  test("rejects shapes that are not YYYY-MM at all", () => {
    expect(() => monthWindow("2026")).toThrow()
    expect(() => monthWindow("2026-06-18")).toThrow()
    expect(() => monthWindow("June 2026")).toThrow()
    expect(() => monthWindow("")).toThrow()
  })

  test("every accepted window is a range the index can read", () => {
    // from ≤ to, and both are full ISO dates — the invariant every caller
    // depends on when it passes these to `.gte()`/`.lte()`.
    for (const month of ["2026-01", "2026-02", "2026-06", "2026-12"]) {
      const { from, to } = monthWindow(month)
      expect(from <= to).toBe(true)
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

/**
 * Tests for the score batch ceiling.
 *
 * `scoreBatchSize` is what keeps one `recomputeScores` call inside Convex's
 * ~16 000-document read limit. Worth testing for the same reason as
 * `monthWindow`: both failure modes are quiet. A batch that is too large throws
 * a read-limit error at 03:15 UTC where only the logs see it, and the sweep
 * stops mid-roster leaving most of the chamber on yesterday's scores; a batch
 * that clamps to zero or NaN reports `scored: 0` and terminates, which is
 * indistinguishable from a roster that has been fully scored.
 */
describe("scoreBatchSize", () => {
  test("defaults to the measured ceiling", () => {
    // The sweep passes an explicit size, but the HTTP backfill route may not.
    expect(scoreBatchSize(undefined)).toBe(MAX_SCORE_BATCH)
  })

  test("clamps above the ceiling rather than rejecting", () => {
    // A slice has a correct smaller answer — take fewer MPs, report a cursor —
    // unlike an oversized write batch, which `assertBatchSize` must reject so
    // the pipeline can chunk and retry.
    expect(scoreBatchSize(50)).toBe(MAX_SCORE_BATCH)
    expect(scoreBatchSize(700)).toBe(MAX_SCORE_BATCH)
  })

  test("passes through a smaller request", () => {
    expect(scoreBatchSize(1)).toBe(1)
    expect(scoreBatchSize(5)).toBe(5)
  })

  test("never returns zero, negative, or fractional", () => {
    // Zero is the dangerous one: `.slice(c, c)` is empty, so the call reports
    // `scored: 0` with `hasMore` false and the sweep stops believing it is done.
    expect(scoreBatchSize(0)).toBe(1)
    expect(scoreBatchSize(-5)).toBe(1)
    expect(scoreBatchSize(3.7)).toBe(3)
  })

  test("rejects NaN and Infinity rather than passing them to slice", () => {
    // NaN survives Math.min unchanged and would reach `.slice(cursor, NaN)` —
    // an empty slice that looks like a finished roster. `pageLimit` guards the
    // same way and for the same reason.
    expect(scoreBatchSize(Number.NaN)).toBe(MAX_SCORE_BATCH)
    expect(scoreBatchSize(Number.POSITIVE_INFINITY)).toBe(MAX_SCORE_BATCH)
  })

  test("is strictly tighter than pageLimit, which it deliberately does not use", () => {
    // The bug this function exists for. `pageLimit` clamps to MAX_PAGE = 700 —
    // raised so the roster could be listed in one page — which applied to a
    // score batch authorises the whole chamber in one transaction, the exact
    // shape `recomputeScores` exists to avoid. The two answer different
    // questions: how many rows may cross the wire, and how many transactions'
    // worth of reads may be attempted at once.
    expect(pageLimit(700)).toBeGreaterThan(scoreBatchSize(700))
    for (const requested of [25, 50, 700]) {
      expect(scoreBatchSize(requested)).toBeLessThanOrEqual(pageLimit(requested))
    }
  })

  test("the ceiling left headroom even at the cost that broke the sweep", () => {
    // Sized from the failure's own telemetry: 32 002 documents for 25 MPs is
    // ~1 280 per MP, because `month !== null` scored each member twice and
    // `voteParticipation` resolved a voteSheet per voteRecord. The assertion is
    // the arithmetic, so a future raise of MAX_SCORE_BATCH has to argue with it.
    //
    // Kept at the *old* per-MP figure deliberately: it is the pessimistic bound,
    // and a ceiling that is safe against the cost that actually broke production
    // is safe against the cost that replaced it.
    const PER_MP_BEFORE = 32_002 / 25
    const ROSTER_READ = 772
    expect(MAX_SCORE_BATCH * PER_MP_BEFORE + ROSTER_READ).toBeLessThan(16_000)
  })

  test("the roster read is no longer part of the per-slice cost", () => {
    // It used to be, and quadratically: the cursor was an offset and
    // `.take(cursor + batchSize + 1)` re-read every member already scored, so a
    // slice deep in the roster cost its whole prefix. Measured against a real
    // Convex backend on 600 rows: 9 documents at offset 0, 509 at offset 500.
    //
    // With a keyset cursor the read is `.gt("internalId", cursor)` and costs
    // `batchSize + 1` wherever it starts, so the sweep's total roster cost falls
    // from O(roster²/batch) to O(roster).
    const ROSTER = 635
    const slices = Math.ceil(ROSTER / MAX_SCORE_BATCH)
    const offsetForm = slices * (ROSTER / 2 + MAX_SCORE_BATCH + 1)
    const keysetForm = slices * (MAX_SCORE_BATCH + 1)
    expect(keysetForm).toBeLessThan(offsetForm / 10)
    // Per slice, the roster is a rounding error rather than a fixed tax.
    expect(MAX_SCORE_BATCH + 1).toBeLessThan(32_000 / 1000)
  })
})

/**
 * The month row and the period row come from one read of the period.
 *
 * `recomputeScores` writes both when a month is given, and they used to be two
 * independent gathers over windows where the first is a subset of the second —
 * so every source table was read twice per member, and the month's rows were
 * read a second time as part of the period's. That doubling is the "×2" in the
 * incident's ~1 280 documents per MP.
 *
 * `narrow` is what replaced it: the period is read once and each window is a
 * filter over rows already in memory. The property that has to hold is that
 * narrowing gives the same answer the narrower read would have — otherwise the
 * saving is bought with a wrong score. These assert that over the same rows.
 */
describe("narrowing a period to a month", () => {
  /** `narrow`'s date test, which is what the equivalence turns on. Both bounds
   * inclusive, matching `monthWindow` and the `.gte`/`.lte` index ranges. */
  const inWindow = (date: string, from: string, to: string) => date >= from && date <= to

  const rows = [
    { date: "2026-06-30" },
    { date: "2026-07-01" },
    { date: "2026-07-15" },
    { date: "2026-07-31" },
    { date: "2026-08-01" },
  ]

  test("a month's bounds are inclusive at both ends", () => {
    // The first and last day of the month are *in* it. An exclusive upper bound
    // would silently drop every ballot and speech on the 31st — a whole sitting
    // day, in the month with the most of them.
    const { from, to } = monthWindow("2026-07")
    const kept = rows.filter((row) => inWindow(row.date, from, to)).map((row) => row.date)
    expect(kept).toEqual(["2026-07-01", "2026-07-15", "2026-07-31"])
  })

  test("the period window keeps everything the month window keeps", () => {
    // The containment the whole optimisation rests on: if a month's window were
    // not a subset of the period's, reading the period once could not answer
    // both. Asserted rather than assumed, because `monthWindow(null)`'s bounds
    // are literal strings that a future edit could narrow.
    const month = monthWindow("2026-07")
    const period = monthWindow(null)
    for (const row of rows) {
      if (inWindow(row.date, month.from, month.to)) {
        expect(inWindow(row.date, period.from, period.to)).toBe(true)
      }
    }
  })

  test("every month of a period is inside the period window", () => {
    const period = monthWindow(null)
    for (const month of ["2025-03", "2025-12", "2026-01", "2026-07", "2029-11"]) {
      const { from, to } = monthWindow(month)
      expect(from >= period.from).toBe(true)
      expect(to <= period.to).toBe(true)
    }
  })

  test("months do not overlap, so narrowing twice cannot double-count", () => {
    // Consecutive months share no day. If they did, a row would be counted in
    // two months of the contribution graph while the period total counted it
    // once, and the graph would not sum to the total.
    const june = monthWindow("2026-06")
    const july = monthWindow("2026-07")
    expect(june.to < july.from).toBe(true)
  })
})
