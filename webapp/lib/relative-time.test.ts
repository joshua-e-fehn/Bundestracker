import { describe, expect, test } from "bun:test"
import {
  absoluteDate,
  parseIsoDate,
  relativeDay,
  relativeParts,
  relativeTime,
} from "./relative-time"

/**
 * Tests for the relative timestamps.
 *
 * Two things here are worth pinning. The **thresholds** decide which of
 * thirteen dictionary keys a duration selects, and an off-by-one at a boundary
 * renders "vor 1 Tagen" or skips a bucket — wrong text, no error. And
 * `relativeDay` must be stable across a whole calendar day, because the feed
 * stores days rather than timestamps: a label that flips from "gestern" to "vor
 * 1 Tag" partway through an afternoon is a bug nobody would think to look for.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe("relativeParts — thresholds", () => {
  test("under a minute is 'just now'", () => {
    expect(relativeParts(0).key).toBe("time.justNow")
    expect(relativeParts(59_999).key).toBe("time.justNow")
  })

  test("singular and plural split at the right counts", () => {
    expect(relativeParts(MINUTE)).toEqual({ key: "time.minuteAgo", count: 1 })
    expect(relativeParts(2 * MINUTE)).toEqual({ key: "time.minutesAgo", count: 2 })
    expect(relativeParts(HOUR)).toEqual({ key: "time.hourAgo", count: 1 })
    expect(relativeParts(2 * HOUR)).toEqual({ key: "time.hoursAgo", count: 2 })
    expect(relativeParts(DAY)).toEqual({ key: "time.yesterday", count: 1 })
    expect(relativeParts(2 * DAY)).toEqual({ key: "time.daysAgo", count: 2 })
    expect(relativeParts(7 * DAY)).toEqual({ key: "time.weekAgo", count: 1 })
    expect(relativeParts(14 * DAY)).toEqual({ key: "time.weeksAgo", count: 2 })
    expect(relativeParts(30 * DAY)).toEqual({ key: "time.monthAgo", count: 1 })
    expect(relativeParts(90 * DAY)).toEqual({ key: "time.monthsAgo", count: 3 })
    expect(relativeParts(365 * DAY)).toEqual({ key: "time.yearAgo", count: 1 })
    expect(relativeParts(800 * DAY)).toEqual({ key: "time.yearsAgo", count: 2 })
  })

  test("each boundary hands over cleanly, with no skipped bucket", () => {
    // The minute before each threshold must still belong to the smaller unit.
    expect(relativeParts(59 * MINUTE).key).toBe("time.minutesAgo")
    expect(relativeParts(23 * HOUR).key).toBe("time.hoursAgo")
    expect(relativeParts(6 * DAY).key).toBe("time.daysAgo")
    expect(relativeParts(29 * DAY).key).toBe("time.weeksAgo")
    expect(relativeParts(364 * DAY).key).toBe("time.monthsAgo")
  })

  test("no plural key is ever emitted with a count of one", () => {
    // What an off-by-one would produce: "vor 1 Tagen".
    const plurals = new Set([
      "time.minutesAgo",
      "time.hoursAgo",
      "time.daysAgo",
      "time.weeksAgo",
      "time.monthsAgo",
      "time.yearsAgo",
    ])
    for (let hours = 0; hours < 24 * 800; hours += 7) {
      const { key, count } = relativeParts(hours * HOUR)
      if (plurals.has(key)) {
        expect(count, `${key} at ${hours}h`).toBeGreaterThan(1)
      }
    }
  })

  test("a future instant reads as 'just now' rather than a negative count", () => {
    // The sources publish the odd forward-dated record (a scheduled sitting),
    // and "in -3 days" is worse than a small imprecision.
    expect(relativeParts(-5 * DAY).key).toBe("time.justNow")
  })
})

describe("relativeTime — rendering", () => {
  const now = Date.parse("2026-07-26T12:00:00Z")

  test("renders German by default and English on request", () => {
    expect(relativeTime(now - 3 * HOUR, now, "de")).toBe("vor 3 Stunden")
    expect(relativeTime(now - 3 * HOUR, now, "en")).toBe("3 hours ago")
    expect(relativeTime(now - DAY, now, "de")).toBe("gestern")
    expect(relativeTime(now - DAY, now, "en")).toBe("yesterday")
  })

  test("substitutes the count into the plural forms", () => {
    expect(relativeTime(now - 5 * DAY, now, "de")).toBe("vor 5 Tagen")
    expect(relativeTime(now - 5 * DAY, now, "en")).toBe("5 days ago")
  })
})

describe("parseIsoDate", () => {
  test("accepts exactly YYYY-MM-DD, anchored at UTC midnight", () => {
    expect(parseIsoDate("2026-07-26")).toBe(Date.parse("2026-07-26T00:00:00Z"))
  })

  test("rejects everything else rather than absorbing it", () => {
    // `Date.parse` would accept most of these. The pipeline emits one shape, so
    // anything else is a bug better surfaced than rendered as a plausible date.
    for (const value of ["2026-7-26", "26.07.2026", "2026-07-26T10:00:00Z", "July 26 2026", ""]) {
      expect(parseIsoDate(value), value).toBeNull()
    }
  })
})

describe("relativeDay — whole days", () => {
  test("today reads the same at every hour of the day", () => {
    // The property that matters: the feed stores a day, so its label must not
    // change as the clock moves through that day.
    const labels = new Set<string>()
    for (let hour = 0; hour < 24; hour++) {
      labels.add(
        relativeDay(
          "2026-07-26",
          Date.parse(`2026-07-26T${String(hour).padStart(2, "0")}:30:00Z`),
          "de",
        ),
      )
    }
    expect(labels.size).toBe(1)
    expect([...labels][0]).toBe("gerade eben")
  })

  test("yesterday stays 'gestern' all day", () => {
    const labels = new Set<string>()
    for (let hour = 0; hour < 24; hour++) {
      labels.add(
        relativeDay(
          "2026-07-25",
          Date.parse(`2026-07-26T${String(hour).padStart(2, "0")}:30:00Z`),
          "de",
        ),
      )
    }
    expect(labels.size).toBe(1)
    expect([...labels][0]).toBe("gestern")
  })

  test("counts whole calendar days, not fractions", () => {
    const now = Date.parse("2026-07-26T09:00:00Z")
    expect(relativeDay("2026-07-23", now, "de")).toBe("vor 3 Tagen")
    expect(relativeDay("2026-07-23", now, "en")).toBe("3 days ago")
  })

  test("an unparseable date shows itself rather than hiding", () => {
    // A date the parser rejects is a pipeline bug; rendering it beats an
    // em-dash, and beats silently substituting today.
    expect(relativeDay("26.07.2026", Date.now(), "de")).toBe("26.07.2026")
  })
})

describe("absoluteDate — the tooltip", () => {
  test("renders in the reader's locale", () => {
    expect(absoluteDate("2026-07-26", "de")).toBe("26. Juli 2026")
    expect(absoluteDate("2026-07-26", "en")).toBe("July 26, 2026")
  })

  test("does not shift the day across a timezone", () => {
    // The bug forcing UTC prevents: a stored YYYY-MM-DD rendered in local time
    // reads as the previous day for readers west of Greenwich.
    expect(absoluteDate("2026-01-01", "de")).toBe("1. Januar 2026")
  })
})
