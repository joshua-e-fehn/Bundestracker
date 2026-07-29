import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { LOCALES } from "@/lib/i18n"
import { landNameFor } from "@/lib/laender"

/**
 * The state filter shows Land *names* and filters on Land *codes*.
 *
 * Two surfaces offer this filter — the roster's own control in
 * `mp-table.tsx` and the rankings' bar in `rankings-filters.tsx` — and the
 * invariant is the same on both: the option's `label` is translated, its
 * `value` is the raw `WKR_LAND` code the query compares against.
 *
 * Collapsing the two is a one-character edit (`value: label`) that typechecks
 * cleanly, renders correctly in German, and breaks only for an English reader,
 * only on selection, and only because `mps.federalState` holds `NW` and the
 * filter is now asking for `North Rhine-Westphalia`. The board would come back
 * empty and look like a Land nobody is from — the same failure GAP-021 already
 * shipped once, in a new place.
 *
 * The behavioural half is asserted directly below. The wiring half is asserted
 * against the source text, the technique `nav-sidebar.test.ts` and
 * `providers/theme-color.test.ts` use for a prop whose effect needs a real
 * layout engine: `bun test` has no DOM here, so rendering the select is not
 * available, and a check that the code reads the way it must is what is.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")

/** Comments stripped, so prose *describing* the rule cannot satisfy a check
 * looking for the rule being *applied* — these files discuss it at length. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const mpTable = strip(read("./mp-table.tsx"))
const rankingsFilters = strip(read("./rankings-filters.tsx"))

describe("the label is a name and the value is a code", () => {
  test("the two are never the same string for a known code", () => {
    // The property that makes the distinction matter at all. If every label
    // equalled its code, every test here would pass while the filter was
    // untranslated — so this is the premise the rest of the file rests on.
    for (const locale of LOCALES) {
      expect(landNameFor("NW", locale)).not.toBe("NW")
      expect(landNameFor("NDS", locale)).not.toBe("NDS")
    }
  })

  test("both surfaces build the option value from the code, not the label", () => {
    // `value: code` on the roster; `value: entry.value` on the rankings, where
    // `entry` is the server's `{ value, count }` and `value` is the raw code.
    expect(mpTable).toContain("value: code")
    expect(rankingsFilters).toContain("value: entry.value")
  })

  test("neither surface passes a translated name as a filter value", () => {
    // The specific regression: `value: label` or `value: landNameFor(...)`.
    for (const source of [mpTable, rankingsFilters]) {
      expect(source).not.toContain("value: label")
      expect(source).not.toMatch(/value:\s*landNameFor/)
    }
  })

  test("both surfaces translate the label through the one mapping", () => {
    // Not a second table, and not a raw code. `landNameFor` is the only
    // definition of "what do we call this Land", exactly as `stateOf` is the
    // only definition of "which Land is this".
    for (const source of [mpTable, rankingsFilters]) {
      expect(source).toMatch(/landNameFor\(/)
    }
  })

  test("both pass the reader's locale rather than assuming German", () => {
    // `landNameFor(code, "de")` would typecheck and would leave the English
    // site showing German Land names — the kind of miss that survives review
    // because the default locale is German and the page looks right.
    expect(mpTable).toMatch(/landNameFor\([^)]*,\s*locale\)/)
    expect(rankingsFilters).toMatch(/landNameFor\([^)]*,\s*locale\)/)
  })

  test("options are sorted by the label, in the reader's collation", () => {
    // The server sorts by code because it has no locale. Bavaria belongs under
    // B for an English reader and Bayern under B for a German one; `BY` sorts
    // between `BW` and `BE`, which is an order neither language reads.
    for (const source of [mpTable, rankingsFilters]) {
      expect(source).toMatch(/localeCompare\([^)]*locale\)/)
    }
  })
})

describe("the ordering the labels produce", () => {
  test("sorting by label differs from sorting by code, in both languages", () => {
    // Demonstrates the previous test is worth its weight rather than pinning a
    // no-op: with real WP21 codes the two orders genuinely disagree.
    const codes = ["BW", "BY", "BE", "HH", "HE"]
    const byCode = [...codes].sort((a, b) => a.localeCompare(b, "de"))
    for (const locale of LOCALES) {
      const byLabel = [...codes].sort((a, b) =>
        landNameFor(a, locale).localeCompare(landNameFor(b, locale), locale),
      )
      expect(byLabel, `label order should differ from code order (${locale})`).not.toEqual(byCode)
    }
  })

  test("the English order is the English alphabet's, not the German one's", () => {
    // `BY` → Bayern/Bavaria and `HE` → Hessen/Hesse sit in different places
    // once translated, which is the whole reason the sort takes a locale.
    const codes = ["NW", "BY", "SN"]
    const english = [...codes].sort((a, b) =>
      landNameFor(a, "en").localeCompare(landNameFor(b, "en"), "en"),
    )
    // Bavaria, North Rhine-Westphalia, Saxony.
    expect(english).toEqual(["BY", "NW", "SN"])

    const german = [...codes].sort((a, b) =>
      landNameFor(a, "de").localeCompare(landNameFor(b, "de"), "de"),
    )
    // Bayern, Nordrhein-Westfalen, Sachsen — same order here, which is why the
    // assertion above uses a set where the two genuinely diverge.
    expect(german).toEqual(["BY", "NW", "SN"])
  })
})
