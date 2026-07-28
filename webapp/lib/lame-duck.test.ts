import { describe, expect, test } from "bun:test"
import {
  ELECTORAL_TERMS,
  isLameDuckVote,
  LAME_DUCK_MAINTAINED_AS_OF,
  lameDuckWindow,
} from "./lame-duck"

/**
 * Tests for the lame-duck window.
 *
 * Same premise as lib/seating.test.ts: this is a part that can be wrong without
 * looking wrong. The flag renders as a small badge either way — a window shifted
 * by one period, or an interval closed at the wrong end, produces a page that
 * looks entirely normal while labelling the wrong parliament. Nothing throws.
 *
 * The boundaries get the most attention here for that reason. An off-by-one at
 * `constitutedOn` puts the badge on the *incoming* Bundestag's first sitting,
 * which is the exact inverse of the claim.
 */

describe("ELECTORAL_TERMS", () => {
  test("WP21 is the current Bundestag — elected 2025, constituted 2025-03-25", () => {
    // The numbering this codebase uses everywhere (GOVERNING_PARTIES in
    // lib/seating.ts, the WP21 mandates in convex/seedDev.ts). Asserted rather
    // than assumed: describing these periods by year is off by one from the
    // Wahlperiode number, and getting it wrong moves the window onto the wrong
    // chamber without failing anything else.
    expect(ELECTORAL_TERMS[21]).toEqual({
      electedOn: "2025-02-23",
      constitutedOn: "2025-03-25",
    })
  })

  test("every term constitutes after it was elected, within 30 days", () => {
    // Art. 39(2) GG: the new Bundestag convenes at the latest on the thirtieth
    // day after the election. A row violating that is a typo in a maintained
    // table, which is the failure mode a hand-kept list actually has.
    for (const [wahlperiode, term] of Object.entries(ELECTORAL_TERMS)) {
      expect(term.constitutedOn > term.electedOn, `WP${wahlperiode}`).toBe(true)
      const days =
        (Date.parse(`${term.constitutedOn}T00:00:00Z`) -
          Date.parse(`${term.electedOn}T00:00:00Z`)) /
        86_400_000
      expect(days, `WP${wahlperiode}`).toBeLessThanOrEqual(30)
    }
  })

  test("dates are ISO YYYY-MM-DD, so string order is chronological", () => {
    // The whole module compares dates as strings — the schema's convention. A
    // `1.3.2025` slipping into the table would compare as less than every ISO
    // date and silently open the window to the beginning of time.
    for (const term of Object.values(ELECTORAL_TERMS)) {
      expect(term.electedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(term.constitutedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(LAME_DUCK_MAINTAINED_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("lameDuckWindow", () => {
  test("reads the successor's dates, not the period's own", () => {
    // WP20 became a lame duck when WP21 was elected. Its own 2021 dates say
    // nothing about that, and reading them would be the obvious wrong
    // implementation.
    expect(lameDuckWindow(20)).toEqual({
      electedOn: "2025-02-23",
      constitutedOn: "2025-03-25",
    })
  })

  test("the current Bundestag has no window — its successor is unelected", () => {
    expect(lameDuckWindow(21)).toBeNull()
  })

  test("an unmaintained period has no window rather than a guessed one", () => {
    expect(lameDuckWindow(17)).toBeNull()
    expect(lameDuckWindow(99)).toBeNull()
  })
})

describe("isLameDuckVote", () => {
  test("the Sondervermögen vote is flagged", () => {
    // 2025-03-18: the outgoing WP20 Bundestag amending the Basic Law, twenty-three
    // days after the election that replaced it and seven before its successor
    // convened. The case the whole module exists for.
    expect(isLameDuckVote("2025-03-18", 20)).toBe(true)
  })

  test("election day itself is not flagged", () => {
    // The term has not turned over at any point during polling.
    expect(isLameDuckVote("2025-02-23", 20)).toBe(false)
  })

  test("the constitutive sitting is not flagged", () => {
    // ⚠ The boundary that matters most. On 2025-03-25 the old term *ends* and
    // the new Bundestag convenes — flagging that date would put the badge on
    // the newly elected chamber, the exact inverse of the claim.
    expect(isLameDuckVote("2025-03-25", 20)).toBe(false)
    // And the day before it, which is inside the window, still is.
    expect(isLameDuckVote("2025-03-24", 20)).toBe(true)
  })

  test("the day after the election is flagged", () => {
    expect(isLameDuckVote("2025-02-24", 20)).toBe(true)
  })

  test("an ordinary WP20 ballot is not flagged", () => {
    expect(isLameDuckVote("2024-11-13", 20)).toBe(false)
    expect(isLameDuckVote("2022-06-02", 20)).toBe(false)
  })

  test("a WP21 ballot is never flagged, whatever its date", () => {
    // No successor, no window — including for a date that falls inside WP20's.
    // The period is what decides whose ballot it was, not the calendar.
    expect(isLameDuckVote("2025-03-18", 21)).toBe(false)
    expect(isLameDuckVote("2026-07-01", 21)).toBe(false)
  })

  test("WP19's window is WP20's election, not WP21's", () => {
    // The chain: each period is checked against its own successor. A single
    // shared window would flag every historical ballot in March 2025.
    expect(isLameDuckVote("2021-10-05", 19)).toBe(true)
    expect(isLameDuckVote("2021-10-26", 19)).toBe(false)
    expect(isLameDuckVote("2025-03-18", 19)).toBe(false)
  })

  test("an unmaintained period flags nothing", () => {
    expect(isLameDuckVote("2013-10-01", 17)).toBe(false)
  })
})
