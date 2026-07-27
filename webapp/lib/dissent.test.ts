import { describe, expect, test } from "bun:test"
import { DISSENT_BADGE_RATE, DISSENT_MIN_BALLOTS, dissentRate, isNotableDissenter } from "./dissent"

/**
 * Tests for reading a dissent tally.
 *
 * `isNotableDissenter` decides whether a badge appears beside a named person's
 * face in every list on the site, so the cases that matter are the ones where
 * the honest answer is *no mark*: nobody has voted yet, or somebody has voted
 * once and broken with their group. Both produce a confident, wrong badge under
 * the obvious implementation (`dissents / cast > 0.05`), and neither throws.
 */

describe("dissentRate", () => {
  test("is the share of votes cast", () => {
    expect(dissentRate({ dissents: 3, ballotsCast: 60 })).toBe(0.05)
  })

  test("no votes cast has no rate — null, not zero", () => {
    // Zero would say "voted, always with the group" about a member who has not
    // voted at all. See `voteParticipation` in convex/votes.ts, same choice.
    expect(dissentRate({ dissents: 0, ballotsCast: 0 })).toBeNull()
  })

  test("a negative or non-finite denominator has no rate", () => {
    expect(dissentRate({ dissents: 1, ballotsCast: -4 })).toBeNull()
    expect(dissentRate({ dissents: 1, ballotsCast: Number.NaN })).toBeNull()
  })

  test("never dissenting is a real zero, not an absence", () => {
    expect(dissentRate({ dissents: 0, ballotsCast: 120 })).toBe(0)
  })
})

describe("isNotableDissenter", () => {
  test("marks a member above the rate with enough votes behind it", () => {
    expect(isNotableDissenter({ dissents: 8, ballotsCast: 100 })).toBe(true)
  })

  test("does not mark a member below the rate", () => {
    expect(isNotableDissenter({ dissents: 1, ballotsCast: 100 })).toBe(false)
  })

  test("does not mark a newcomer whose single vote broke with the group", () => {
    // The case the threshold exists for: a 100 % rate over one ballot would
    // otherwise carry the loudest mark on the site.
    expect(isNotableDissenter({ dissents: 1, ballotsCast: 1 })).toBe(false)
  })

  test("does not mark a member with no votes at all", () => {
    expect(isNotableDissenter({ dissents: 0, ballotsCast: 0 })).toBe(false)
  })

  test("an absent tally is not a zero", () => {
    // A member the backfill has not reached. Absent means unmeasured, and an
    // unmeasured member is not a loyal one.
    expect(isNotableDissenter(null)).toBe(false)
    expect(isNotableDissenter(undefined)).toBe(false)
  })

  test("the two constants are the same statement: one dissent in twenty", () => {
    // Exactly at both bounds, which is deliberately inclusive — see the note on
    // `DISSENT_MIN_BALLOTS`.
    expect(isNotableDissenter({ dissents: 1, ballotsCast: DISSENT_MIN_BALLOTS })).toBe(true)
    expect(1 / DISSENT_MIN_BALLOTS).toBe(DISSENT_BADGE_RATE)
  })

  test("one fewer ballot than the floor is not marked, however high the rate", () => {
    expect(isNotableDissenter({ dissents: 19, ballotsCast: DISSENT_MIN_BALLOTS - 1 })).toBe(false)
  })
})
