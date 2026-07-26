import { describe, expect, test } from "bun:test"
import { monthWindow } from "./activityScores"

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
