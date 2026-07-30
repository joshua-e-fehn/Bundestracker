import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-shape assertions for the freshness widget.
 *
 * A full DOM render is not what this needs to guard: `useQuery` reaches for
 * Convex on mount and there is no mocked Convex layer here (see
 * `webapp/components/providers/theme-color.test.ts` for the same trade-off
 * the codebase already makes). The regressions worth pinning are shape
 * regressions — that the widget reads *ingestion* timestamps rather than the
 * feed's, that it renders an honest empty state rather than nothing, and
 * that the `<time>` element carries a machine-readable `dateTime` alongside
 * the human phrase. Each of these is a source-string check the way
 * `webapp/app/page.test.ts` is.
 */

const WIDGET = readFileSync(join(import.meta.dir, "data-as-of.tsx"), "utf8")

describe("DataAsOf widget", () => {
  test("reads the ingestion timestamp, not the feed's date-of-record", () => {
    // The whole reason this widget can exist honestly (see the header):
    // `getLatestIngestTime` is derived from `_creationTime` on
    // `activityEvents`, which is stamped on insert and does not bump on
    // re-ingest. Reading a feed row's `date` instead would produce a claim
    // about the *chamber's* activity — which is why lib/relative-time.ts
    // documents that trap explicitly.
    expect(WIDGET).toMatch(/api\.activityEvents\.getLatestIngestTime/)
    expect(WIDGET).not.toMatch(/api\.feed\.getFeed\b/)
    expect(WIDGET).not.toMatch(/getActivityCalendar/)
  })

  test("renders an honest 'unknown' branch instead of hiding when null", () => {
    // A fresh deployment with no pipeline run must not silently render
    // nothing — that would let a broken cron stay invisible on every page.
    // See the widget's header. The i18n key `footer.dataAsOfUnknown` is the
    // string; the check is that the widget references it.
    expect(WIDGET).toMatch(/footer\.dataAsOfUnknown/)
    // The value is `unknown` in English so a reader who cannot translate the
    // German phrase can still tell a truthful empty from a bug.
    const i18n = readFileSync(join(import.meta.dir, "../lib/i18n.ts"), "utf8")
    expect(i18n).toMatch(/"footer\.dataAsOfUnknown":\s*"Daten Stand: unbekannt"/)
    expect(i18n).toMatch(/"footer\.dataAsOfUnknown":\s*"Data as of: unknown"/)
  })

  test("wraps the phrase in a <time> with dateTime and a human-readable title", () => {
    // The vague reading is always paired with two exact ones, targeting
    // different audiences:
    //  - `dateTime={isoUtc}` — the machine-readable ISO in UTC. A screen
    //    reader that announces dates from `<time>`, a Selenium check, a
    //    browser's built-in "reveal date" gesture all reach it.
    //  - `title={humanAbsolute}` — the locale-formatted absolute string
    //    for the mouse-hover tooltip. A raw ISO with milliseconds is
    //    technically correct and practically unreadable; the reader who
    //    hovers wants a date, not a serialised timestamp.
    expect(WIDGET).toMatch(/<time[\s\S]{0,400}dateTime=\{isoUtc\}/)
    expect(WIDGET).toMatch(/<time[\s\S]{0,400}title=\{humanAbsolute\}/)
    // ISO comes from `toISOString()` and stays UTC — the two are the
    // whole point of splitting the attributes.
    expect(WIDGET).toMatch(/toISOString\(\)/)
    // The human-readable form uses Intl.DateTimeFormat in the reader's
    // locale, spelled out with dateStyle + timeStyle so a tooltip reads
    // as a sentence rather than a serialisation. A regression that put
    // the ISO into `title` would drop these two markers together.
    expect(WIDGET).toMatch(/Intl\.DateTimeFormat\(locale/)
    expect(WIDGET).toMatch(/dateStyle:\s*"long"/)
    expect(WIDGET).toMatch(/timeStyle:\s*"short"/)
  })

  test("does not fabricate a timestamp — no Date.now for the datum itself", () => {
    // `Date.now()` is used to compute the *now* against which the relative
    // phrase is measured (that is honest). It must not be used as the datum
    // — i.e. no `latest ?? Date.now()` or similar. The guard: `Date.now`
    // may appear (for the relative-time reference) but not on a fallback
    // for the query result.
    expect(WIDGET).not.toMatch(/latest\s*\?\?\s*Date\.now/)
    expect(WIDGET).not.toMatch(/latest\s*\|\|\s*Date\.now/)
  })

  test("renders nothing (not a skeleton) while the query is loading", () => {
    // The footer is chrome; a row that grows on hydration would shove the
    // disclaimer down. The header documents this. The check: the widget
    // returns null for the `undefined` (still-loading) branch.
    expect(WIDGET).toMatch(/if \(latest === undefined[^)]*\) return null/)
  })

  test("the line itself names what the number is about — no bare 'vor 2 Stunden'", () => {
    // A screen reader announcing only "vor 2 Stunden" would read as if a
    // parliamentary event had happened. Both branches guard against this by
    // rendering the "Daten Stand: …" / "Data as of …" phrase itself — the
    // label is content, not an aria-label. The widget must reference the
    // labelled key rather than a bare relative-time phrase.
    expect(WIDGET).toMatch(/footer\.dataAsOf(?!Unknown|Label)/)
    const i18n = readFileSync(join(import.meta.dir, "../lib/i18n.ts"), "utf8")
    // Both dictionaries carry the labelled phrase — the German "Daten
    // Stand" prefix and the English "Data as of" prefix — and *both* use
    // the same colon punctuation, so a screen reader hears the label as a
    // noun-phrase followed by a value. A future edit that flipped
    // `footer.dataAsOf` to a bare `{when}` (or dropped the colon on one
    // locale) would fail here.
    expect(i18n).toMatch(/"footer\.dataAsOf":\s*"Daten Stand: \{when\}"/)
    expect(i18n).toMatch(/"footer\.dataAsOf":\s*"Data as of: \{when\}"/)
    // …and the sibling `footer.dataAsOfUnknown` uses the same colon
    // punctuation in both. If a future edit added a colon to one and
    // removed it from the other, the widget would render two visually
    // different shapes for the same slot.
    expect(i18n).toMatch(/"footer\.dataAsOfUnknown":\s*"Daten Stand: unbekannt"/)
    expect(i18n).toMatch(/"footer\.dataAsOfUnknown":\s*"Data as of: unknown"/)
  })
})
