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

  test("wraps the phrase in a <time> with dateTime and title", () => {
    // The vague reading is always paired with the exact one — a screen
    // reader, a browser 'reveal date' gesture and a hovering mouse all reach
    // the same ISO string. Without `dateTime` the `<time>` is decoration;
    // without `title` a mouse reader has to click to know.
    expect(WIDGET).toMatch(/<time[\s\S]{0,200}dateTime=\{iso\}/)
    expect(WIDGET).toMatch(/<time[\s\S]{0,200}title=\{iso\}/)
    // ISO string is what dateTime expects; the loose match tolerates the
    // exact shape the implementation may take, as long as it comes from a
    // `Date(...).toISOString()`.
    expect(WIDGET).toMatch(/toISOString\(\)/)
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
    // Stand" prefix and the English "Data as of" prefix. A future edit
    // that flipped `footer.dataAsOf` to a bare `{when}` would fail here.
    expect(i18n).toMatch(/"footer\.dataAsOf":\s*"Daten Stand: \{when\}"/)
    expect(i18n).toMatch(/"footer\.dataAsOf":\s*"Data as of \{when\}"/)
  })
})
