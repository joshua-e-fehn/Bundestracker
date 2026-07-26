import { describe, expect, test } from "bun:test"
import {
  AGE_GROUP_KEYS,
  ageOn,
  EVENT_TYPES,
  inAgeGroup,
  isEventType,
  isMonth,
  previousMonth,
  RANKING_METRICS,
} from "./taxonomy"

/**
 * Tests for the shared vocabularies.
 *
 * The age helpers and `previousMonth` both fail quietly rather than loudly: a
 * wrong age puts an MP in the wrong bracket and the leaderboard still renders,
 * and a wrong previous month makes the rising board compare against an empty
 * month, which reads as "everyone improved enormously" rather than as an error.
 */

const NOW = Date.parse("2026-07-26T12:00:00Z")

describe("ageOn", () => {
  test("counts completed years", () => {
    expect(ageOn("1986-07-26", NOW)).toBe(40)
    expect(ageOn("1986-01-01", NOW)).toBe(40)
  })

  test("a birthday later this year has not happened yet", () => {
    // The off-by-one that would shift a whole bracket: 1986-12-31 is 39, not 40.
    expect(ageOn("1986-12-31", NOW)).toBe(39)
    expect(ageOn("1986-07-27", NOW)).toBe(39)
  })

  test("the birthday itself counts", () => {
    expect(ageOn("2000-07-26", NOW)).toBe(26)
  })

  test("an absent or malformed date is null, not zero", () => {
    // Zero would put every undated MP in the youngest bracket — a claim the
    // source does not support. §6.5-style gaps are common enough to matter.
    expect(ageOn(null, NOW)).toBeNull()
    expect(ageOn("", NOW)).toBeNull()
    expect(ageOn("1986", NOW)).toBeNull()
    expect(ageOn("26.07.1986", NOW)).toBeNull()
  })

  test("an implausible age is null rather than a number", () => {
    expect(ageOn("1750-01-01", NOW)).toBeNull()
    expect(ageOn("2040-01-01", NOW)).toBeNull()
  })
})

describe("inAgeGroup", () => {
  test("brackets are inclusive at both ends", () => {
    expect(inAgeGroup("1996-07-26", "30s", NOW)).toBe(true) // exactly 30
    expect(inAgeGroup("1987-07-26", "30s", NOW)).toBe(true) // exactly 39
    expect(inAgeGroup("1986-07-26", "30s", NOW)).toBe(false) // 40
  })

  test("70plus is open at the top", () => {
    expect(inAgeGroup("1956-07-26", "70plus", NOW)).toBe(true)
    expect(inAgeGroup("1930-07-26", "70plus", NOW)).toBe(true)
  })

  test("an unknown age is in no bracket at all", () => {
    // The rule the filter depends on: an unknown age is not an age, so it is
    // excluded rather than defaulted into one.
    for (const group of AGE_GROUP_KEYS) {
      expect(inAgeGroup(null, group, NOW), group).toBe(false)
    }
  })

  test("the brackets partition every real age exactly once", () => {
    // No age falls in two brackets, and none falls in none — which is what
    // makes the counts on the filter dropdown add up to the roster.
    for (let age = 0; age <= 100; age++) {
      const birthYear = 2026 - age
      const birthDate = `${birthYear}-01-01`
      const matches = AGE_GROUP_KEYS.filter((group) => inAgeGroup(birthDate, group, NOW))
      expect(matches.length, `age ${age}`).toBe(1)
    }
  })
})

describe("previousMonth", () => {
  test("steps back one month", () => {
    expect(previousMonth("2026-07")).toBe("2026-06")
  })

  test("crosses a year boundary", () => {
    expect(previousMonth("2026-01")).toBe("2025-12")
  })

  test("always zero-pads", () => {
    // The bug this prevents, documented in convex/activityScores.ts: "2026-6"
    // sorts *above* every real date in its year, so the window matches nothing
    // and the board reads as a month nobody worked.
    expect(previousMonth("2026-10")).toBe("2026-09")
    expect(previousMonth("2026-02")).toBe("2026-01")
    for (let month = 1; month <= 12; month++) {
      const value = previousMonth(`2026-${String(month).padStart(2, "0")}`)
      expect(value, `from month ${month}`).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    }
  })

  test("rejects a month that is not zero-padded YYYY-MM", () => {
    expect(previousMonth("2026-6")).toBeNull()
    expect(previousMonth("2026-13")).toBeNull()
    expect(previousMonth("2026")).toBeNull()
    expect(previousMonth("2026-07-01")).toBeNull()
  })
})

describe("isMonth", () => {
  test("accepts padded months in range and nothing else", () => {
    expect(isMonth("2026-01")).toBe(true)
    expect(isMonth("2026-12")).toBe(true)
    expect(isMonth("2026-00")).toBe(false)
    expect(isMonth("2026-13")).toBe(false)
    expect(isMonth("2026-1")).toBe(false)
  })
})

describe("vocabularies", () => {
  test("event types are unique and recognised by their own guard", () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length)
    for (const type of EVENT_TYPES) {
      expect(isEventType(type), type).toBe(true)
    }
    expect(isEventType("hearing")).toBe(false)
  })

  test("ranking metrics are unique", () => {
    expect(new Set(RANKING_METRICS).size).toBe(RANKING_METRICS.length)
  })
})
