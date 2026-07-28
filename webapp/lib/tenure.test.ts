import { describe, expect, test } from "bun:test"
import {
  DAYS_PER_MONTH,
  MIN_TENURE_DAYS,
  normalisedScore,
  tenureDays,
  tenureMonths,
} from "./tenure"

/**
 * Tests for the tenure denominator.
 *
 * The failure mode here is the one lib/dissent.test.ts guards against in the
 * other direction: a rate computed over a denominator nobody checked. A member
 * with four days in office and one motion ranks first on a board built to be
 * fairer than the totals — and the page looks completely normal while doing it.
 *
 * The null-versus-zero distinction gets its own block. It is the difference
 * between "cannot be ranked" and "ranked last", and collapsing the two would
 * reintroduce the exact bias the normalised board exists to remove.
 */

const TODAY = "2026-07-28"

describe("tenureDays", () => {
  test("an open span counts to today — still serving", () => {
    // §6.2's open end. 2026-07-28 minus 2025-03-25, inclusive of both.
    expect(tenureDays({ start: "2025-03-25", end: null }, TODAY)).toBe(491)
  })

  test("a closed span counts to its end, not to today", () => {
    // The member left; their exposure stopped. Counting to today would shrink
    // a departed member's rate every day they are not there.
    expect(tenureDays({ start: "2025-03-25", end: "2025-06-25" }, TODAY)).toBe(93)
  })

  test("both endpoints are inclusive", () => {
    expect(tenureDays({ start: "2026-07-01", end: "2026-07-01" }, TODAY)).toBe(1)
    expect(tenureDays({ start: "2026-07-01", end: "2026-07-02" }, TODAY)).toBe(2)
  })

  test("a missing span is null, not zero", () => {
    expect(tenureDays(null, TODAY)).toBeNull()
    expect(tenureDays(undefined, TODAY)).toBeNull()
  })

  test("an unparseable date is null rather than a guess", () => {
    expect(tenureDays({ start: "25.03.2025", end: null }, TODAY)).toBeNull()
    expect(tenureDays({ start: "2025-03-25", end: "not a date" }, TODAY)).toBeNull()
    expect(tenureDays({ start: "2025-03-25", end: null }, "nonsense")).toBeNull()
  })

  test("a span ending before it starts is null, not negative", () => {
    // A source error. Null keeps it out of every ranking; a clamp to zero would
    // report it as "no exposure", which is a different claim.
    expect(tenureDays({ start: "2025-06-25", end: "2025-03-25" }, TODAY)).toBeNull()
  })

  test("a leap day inside the span is counted", () => {
    // 2028 is a leap year — the arithmetic is on epoch milliseconds, so this is
    // really checking that no calendar walk was introduced later.
    expect(tenureDays({ start: "2028-02-28", end: "2028-03-01" }, "2028-12-31")).toBe(3)
  })
})

describe("tenureMonths", () => {
  test("a 30-day month is the unit", () => {
    expect(tenureMonths({ start: "2026-01-01", end: "2026-01-30" }, TODAY)).toBe(1)
    expect(DAYS_PER_MONTH).toBe(30)
  })

  test("null propagates from tenureDays", () => {
    expect(tenureMonths(null, TODAY)).toBeNull()
  })
})

describe("normalisedScore", () => {
  test("divides the total by months in office", () => {
    // 300 points over 60 days = 2 months = 150 per month.
    expect(normalisedScore(300, { start: "2026-01-01", end: "2026-03-01" }, TODAY)).toBe(150)
  })

  test("the late-joiner case — the reason the board exists", () => {
    // Two members, one score each. The one who served half as long did the same
    // work in half the time, and only the normalised figure says so.
    const fullTerm = { start: "2025-03-25", end: null }
    const lateJoiner = { start: "2026-01-25", end: null }
    const full = normalisedScore(400, fullTerm, TODAY)
    const late = normalisedScore(400, lateJoiner, TODAY)
    expect(full).not.toBeNull()
    expect(late).not.toBeNull()
    expect(late as number).toBeGreaterThan(full as number)
  })

  test("a tenure below the floor is null, not a huge rate", () => {
    // ⚠ The guard that matters. Four days and one motion would otherwise be
    // 7.5 per month — the top of a board designed to correct for short service.
    expect(normalisedScore(1, { start: "2026-07-25", end: null }, TODAY)).toBeNull()
    expect(MIN_TENURE_DAYS).toBe(30)
  })

  test("exactly the floor is ranked", () => {
    // 30 days inclusive is 2026-06-29…2026-07-28.
    expect(normalisedScore(60, { start: "2026-06-29", end: null }, TODAY)).toBe(60)
  })

  test("an unknown tenure is null — not last place", () => {
    // The distinction the whole feature rests on: "cannot be ranked" is not
    // "scored nothing". A zero here would seat the member at the bottom of the
    // normalised board, which is the bias it exists to remove.
    expect(normalisedScore(500, null, TODAY)).toBeNull()
    expect(normalisedScore(500, undefined, TODAY)).toBeNull()
  })

  test("a zero total over a real tenure is zero, not null", () => {
    // The genuinely inactive long-serving member. This one *is* rankable, and
    // collapsing it into the null case would hide the board's true bottom.
    expect(normalisedScore(0, { start: "2025-03-25", end: null }, TODAY)).toBe(0)
  })

  test("a non-finite total is null rather than NaN", () => {
    // NaN sorts unpredictably and renders as "NaN" on the page — the same guard
    // `resolveWeights` puts on a custom weight.
    expect(normalisedScore(Number.NaN, { start: "2025-03-25", end: null }, TODAY)).toBeNull()
    expect(
      normalisedScore(Number.POSITIVE_INFINITY, { start: "2025-03-25", end: null }, TODAY),
    ).toBeNull()
  })

  test("rounds to two places, like computeScore", () => {
    // Sorted on, so an unrounded float orders two identical rates on the last
    // bit. 100 / (91/30) = 32.967...
    expect(normalisedScore(100, { start: "2026-01-01", end: "2026-04-01" }, TODAY)).toBe(32.97)
  })
})
