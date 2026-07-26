import { describe, expect, test } from "bun:test"
import { segmentWidths } from "./vote-bar"

/**
 * Tests for the stacked bar's widths.
 *
 * The arithmetic has two jobs that pull against each other: every non-zero
 * segment must be wide enough to see, and the row must still sum to 100 %. Both
 * fail silently. A segment below a device pixel makes a lone dissenter vanish
 * from a 630-seat ballot; a row summing over 100 overflows its container and
 * pushes the last segment out of view. Neither throws, and both look like a
 * rendering quirk rather than a lost vote.
 */

const EMPTY = { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }

/** Widths must always add up to the full track, whatever the floor did. */
function sum(widths: Record<string, number>): number {
  return Object.values(widths).reduce((acc, value) => acc + value, 0)
}

describe("segmentWidths", () => {
  test("proportional when every segment is comfortably visible", () => {
    const widths = segmentWidths({ ...EMPTY, yes: 300, no: 300 })
    expect(widths.yes).toBeCloseTo(50, 6)
    expect(widths.no).toBeCloseTo(50, 6)
    expect(sum(widths)).toBeCloseTo(100, 6)
  })

  test("a single dissenting vote in a full chamber stays visible", () => {
    // 1 of 630 is 0.16 % — narrower than one device pixel on a phone, so
    // without the floor the one MP who voted against would not be drawn at all.
    const widths = segmentWidths({ ...EMPTY, yes: 629, no: 1 })
    expect(widths.no).toBeGreaterThanOrEqual(1.2)
    expect(sum(widths)).toBeCloseTo(100, 6)
  })

  test("widening a sliver takes the space from segments that can spare it", () => {
    const widths = segmentWidths({ ...EMPTY, yes: 629, no: 1 })
    // The majority still reads as overwhelming — it gives up the sliver's
    // width, not a visually meaningful share.
    expect(widths.yes).toBeGreaterThan(95)
  })

  test("zero stays zero — the floor is for votes that exist", () => {
    // A position nobody took must not be drawn. Flooring every segment would
    // put a visible red block on a unanimous ballot.
    const widths = segmentWidths({ ...EMPTY, yes: 630 })
    expect(widths.no).toBe(0)
    expect(widths.abstain).toBe(0)
    expect(widths.invalid).toBe(0)
    expect(widths.absent).toBe(0)
    expect(widths.yes).toBeCloseTo(100, 6)
  })

  test("all five positions still sum to the full track", () => {
    const widths = segmentWidths({ yes: 1, no: 1, abstain: 1, invalid: 1, absent: 626 })
    expect(sum(widths)).toBeCloseTo(100, 6)
    for (const key of ["yes", "no", "abstain", "invalid"] as const) {
      expect(widths[key]).toBeGreaterThanOrEqual(1.2)
    }
  })

  test("a ballot with no records is all zeroes, not a full bar", () => {
    // The caller renders this as an empty track. Returning 100 % of anything
    // would claim a result for a ballot whose records have not loaded.
    expect(segmentWidths(EMPTY)).toEqual(EMPTY)
  })

  test("every segment at the floor is still exactly 100 %", () => {
    // Five segments floored at 1.2 % sum to 6 %, far under 100 — the surplus
    // branch must not fire, and the widths must not be left un-normalised.
    const widths = segmentWidths({ yes: 1, no: 1, abstain: 1, invalid: 1, absent: 1 })
    expect(sum(widths)).toBeCloseTo(100, 6)
    expect(widths.yes).toBeCloseTo(20, 6)
  })

  test("negative counts cannot drag the bar below zero", () => {
    // Not expected from the database, but a negative width is a CSS error that
    // renders as a missing segment rather than as bad data.
    const widths = segmentWidths({ ...EMPTY, yes: 10, no: -5 })
    for (const value of Object.values(widths)) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})
