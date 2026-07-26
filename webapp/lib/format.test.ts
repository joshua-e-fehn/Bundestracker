import { describe, expect, test } from "bun:test"
import {
  formatApproximateCount,
  formatCount,
  formatDate,
  formatDateShort,
  formatPercent,
  formatScore,
  initials,
} from "./format"

/**
 * The separator assertions are the point of this file. German writes `1.234`
 * where English writes `1,234`, so the same string means a thousand-fold
 * difference depending on the reader — a formatting bug here is a data bug on
 * the page. Non-breaking spaces vary between ICU versions, so the tests assert
 * on the separators and digits rather than on exact whole strings where that
 * would make them brittle.
 */

describe("formatCount", () => {
  test("groups thousands the way each locale does", () => {
    expect(formatCount(1234, "de")).toBe("1.234")
    expect(formatCount(1234, "en")).toBe("1,234")
  })

  test("leaves small numbers alone", () => {
    expect(formatCount(0, "de")).toBe("0")
    expect(formatCount(630, "de")).toBe("630")
    expect(formatCount(630, "en")).toBe("630")
  })

  test("rounds rather than truncating", () => {
    expect(formatCount(1234.6, "en")).toBe("1,235")
  })

  test("renders a non-finite value as a dash, never as 'NaN'", () => {
    // "NaN" on a stat card reads as a label rather than as missing data.
    expect(formatCount(Number.NaN, "de")).toBe("—")
    expect(formatCount(Number.POSITIVE_INFINITY, "en")).toBe("—")
  })
})

describe("formatApproximateCount", () => {
  test("marks a bounded count as a floor", () => {
    // convex/stats.ts returns {count, exact}; an inexact total must never be
    // shown as if it were complete.
    expect(formatApproximateCount(5000, false, "de")).toBe("5.000+")
    expect(formatApproximateCount(5000, false, "en")).toBe("5,000+")
  })

  test("leaves an exact count unmarked", () => {
    expect(formatApproximateCount(1015, true, "de")).toBe("1.015")
  })
})

describe("formatScore", () => {
  test("shows one decimal place in each locale's notation", () => {
    expect(formatScore(1234.56, "de")).toBe("1.234,6")
    expect(formatScore(1234.56, "en")).toBe("1,234.6")
  })

  test("pads a whole number to one decimal, so a column stays aligned", () => {
    expect(formatScore(42, "en")).toBe("42.0")
  })

  test("renders a non-finite score as a dash", () => {
    expect(formatScore(Number.NaN, "de")).toBe("—")
  })
})

describe("formatPercent", () => {
  test("renders a 0…1 rate as a whole percentage", () => {
    expect(formatPercent(0.876, "en")).toBe("88%")
    expect(formatPercent(1, "en")).toBe("100%")
  })

  test("distinguishes zero from missing", () => {
    // 0 % is a real answer — "voted in none of them". Missing is a dash.
    expect(formatPercent(0, "en")).toBe("0%")
    expect(formatPercent(Number.NaN, "en")).toBe("—")
  })
})

describe("formatDate", () => {
  test("renders a long date in each locale", () => {
    expect(formatDate("2026-07-26", "de")).toBe("26. Juli 2026")
    expect(formatDate("2026-07-26", "en")).toBe("26 July 2026")
  })

  test("does not shift the day in timezones behind UTC", () => {
    // The regression this guards: `new Date("2026-07-26")` is UTC midnight,
    // which is the 25th anywhere west of Greenwich. Dates in the schema are
    // calendar days with no time, so the day must be stable.
    expect(formatDate("2026-01-01", "en")).toBe("1 January 2026")
    expect(formatDate("2026-12-31", "en")).toBe("31 December 2026")
  })

  test("returns the input unchanged when it is not an ISO date", () => {
    // Better a visible raw value than the string "Invalid Date".
    expect(formatDate("not-a-date", "de")).toBe("not-a-date")
    expect(formatDate("26.07.2026", "de")).toBe("26.07.2026")
  })
})

describe("formatDateShort", () => {
  test("renders the compact form for dense lists", () => {
    expect(formatDateShort("2026-07-26", "de")).toBe("26.07.2026")
    expect(formatDateShort("2026-07-26", "en")).toBe("26/07/2026")
  })
})

describe("initials", () => {
  test("takes the first and last name parts", () => {
    // Most MPs have no portrait — §6.5 puts Commons coverage at 36.5 % of WP21
    // — so this is the common case, not the edge case.
    expect(initials("Olaf Scholz")).toBe("OS")
    expect(initials("Annalena Baerbock")).toBe("AB")
  })

  test("skips name particles", () => {
    // §4.1: the vote sheets file `von`/`van`/`de` under a column headed
    // `Titel`, which does not hold academic titles. Without this, half the
    // aristocracy shares the initials "V".
    expect(initials("Marie-Agnes Strack-Zimmermann")).toBe("MZ")
    expect(initials("Alexander von der Leyen")).toBe("AL")
    expect(initials("Christian de Vries")).toBe("CV")
  })

  test("ignores a parenthesised disambiguator", () => {
    // Stammdaten spells the ortsZusatz inline, as in `Brand (Fulda)` (§6.2).
    expect(initials("Michael Brand (Fulda)")).toBe("MB")
  })

  test("handles a single name and an empty one", () => {
    expect(initials("Cher")).toBe("C")
    expect(initials("")).toBe("?")
    expect(initials("   ")).toBe("?")
  })
})
