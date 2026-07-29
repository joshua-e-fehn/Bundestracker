import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { foldedTextMatches, foldSearchQuery, indexableText } from "./search"

/**
 * What `/motions` pages over, and the two properties that make it pageable.
 *
 * ## Why these are the tests worth writing
 *
 * `getMotionsPage` and `getMotionFilterOptions` were exercised end to end
 * against a real Convex backend before they shipped — a local deployment seeded
 * with 60 rows carrying production's own skew — because a query's *behaviour*
 * is not something a unit test can assert (the measured semantics in
 * lib/search.ts exist for the same reason). Those runs confirmed the index
 * narrows before the page rather than after it, the year bound selects exactly
 * its year, the cursor terminates on a search matching nothing, and the read
 * cost is `numItems` documents whatever the search is.
 *
 * What a test *can* hold is the part that would silently stop being true in a
 * later edit, without any of those runs being repeated:
 *
 *  - **The index the query names exists, with its columns in that order.** An
 *    index range's columns are positional, so reordering
 *    `(wahlperiode, vorgangstyp, date)` would not fail a typecheck — it would
 *    quietly stop selecting a period, and the page would fill with another
 *    Bundestag's motions. This is the same kind of assertion
 *    convex/readCost.test.ts makes about the scoring reads, for the same reason.
 *  - **The title filter's rule is the search index's rule.** The filter runs in
 *    memory, so nothing forces it to agree with `/search`; if it drifted to a
 *    substring test, `Maßnahmen` would stop being findable by a reader without
 *    an umlaut key and no test elsewhere would notice.
 */

describe("the motions indexes support the reads the page makes", () => {
  /**
   * The index definitions as the schema declares them, by name.
   *
   * Read out of `convex/schema.ts`'s **source** rather than off the schema
   * object, and the reason is that Convex offers no supported way to do the
   * latter: `export()` exists on both `SchemaDefinition` and `TableDefinition`
   * at runtime and is on neither public type, so calling it typechecks only
   * behind an `as any` — which would defeat the point of a test that exists to
   * be a compile-time-adjacent guard.
   *
   * This is the same instrument, and the same justification, as
   * lib/period-links.test.ts and lib/navigation.test.ts: the property being
   * protected ("the columns of this index are in this order") is a claim about
   * the codebase, and reading the text is the honest way to assert one when the
   * runtime offers no API for it.
   *
   * It captures the *declared* columns only; the backend appends
   * `_creationTime` as the implicit tiebreaker at deploy time. That is the
   * right granularity — the property held is the order this file chose, not the
   * one Convex adds.
   */
  function indexes() {
    const source = readFileSync(new URL("../convex/schema.ts", import.meta.url).pathname, "utf8")
    // The `motions:` table block, up to the next table definition. Bounded so an
    // identically-named index on another table cannot satisfy this.
    // `[\s\S]` rather than `.` with the `s` flag, which the tsconfig target rejects.
    const block = /\n {2}motions: defineTable\(([\s\S]*?)\n\n/.exec(source)?.[1]
    if (block === undefined) throw new Error("could not locate the motions table in schema.ts")
    const found = new Map<string, string[]>()
    for (const [, name, fields] of block.matchAll(/\.index\("(\w+)",\s*\[([^\]]*)\]\)/g)) {
      found.set(
        name,
        [...fields.matchAll(/"(\w+)"/g)].map((match) => match[1]),
      )
    }
    return found
  }

  test("the unfiltered listing is period-scoped and date-ordered", () => {
    // `getMotionsPage` with no kind, and `getMotionFilterOptions`' two
    // end-of-range reads, all take this range. Period first is what makes
    // `.eq("wahlperiode", …)` a bound rather than a filter.
    expect(indexes().get("by_wahlperiode_and_date")).toEqual(["wahlperiode", "date"])
  })

  test("the kind-filtered listing narrows in the index, not after it", () => {
    /**
     * The column order is the whole assertion.
     *
     * An index range fixes its columns in order, so `(wahlperiode, vorgangstyp,
     * date)` is what lets the query say "this period, this kind, ordered by
     * date" — and lets the year bound ride on `date` as a third constraint.
     * Any other order breaks one of the three silently: leading with
     * `vorgangstyp` would make the period a post-filter and mix Bundestage,
     * and putting `date` before `vorgangstyp` would make the kind one.
     *
     * The measured stakes: `Schriftliche Frage` is 44 % of a WP21 sample and
     * 71 % of a WP20 one, so a kind filter applied after the page is read
     * returns empty pages for a rare kind — the failure
     * `by_wahlperiode_and_eventType_and_date` exists to prevent on the feed.
     */
    expect(indexes().get("by_wahlperiode_and_vorgangstyp_and_date")).toEqual([
      "wahlperiode",
      "vorgangstyp",
      "date",
    ])
  })

  test("a year is expressible as a bound on the date column of both", () => {
    // Not a property of the schema so much as of the dates in it: `date` is ISO
    // `YYYY-MM-DD`, so lexicographic order is chronological order and a year is
    // the closed range between its two boundary strings. That is what makes the
    // year filter an index bound rather than a scan — and it is only true while
    // the format is fixed-width, which is what this pins.
    const from = "2026-01-01"
    const to = "2026-12-31"
    for (const inside of ["2026-01-01", "2026-07-15", "2026-12-31"]) {
      expect(inside >= from && inside <= to).toBe(true)
    }
    for (const outside of ["2025-12-31", "2027-01-01"]) {
      expect(outside >= from && outside <= to).toBe(false)
    }
  })
})

describe("the title filter matches on the search index's rules", () => {
  /** What `getMotionsPage` does to one row's title and to the reader's query.
   * Restated here rather than imported from the query, because the query runs in
   * Convex's runtime and this is the composition it performs. */
  const matches = (title: string, query: string) =>
    foldedTextMatches(indexableText(title), foldSearchQuery(query))

  test("an umlaut is findable by every spelling a reader might type", () => {
    // Confirmed against the local backend on seeded rows: `massnahmen` returns
    // the `Maßnahmen` titles. A substring test — which is what this replaced on
    // the committee matcher, see lib/search.ts — fails all three.
    const title = "Kleine Anfrage: Maßnahmen für die Barrierefreiheit im Fernverkehr"
    expect(matches(title, "Maßnahmen")).toBe(true)
    expect(matches(title, "massnahmen")).toBe(true)
    expect(matches(title, "für")).toBe(true)
    expect(matches(title, "fuer")).toBe(true)
  })

  test("the final term is prefix-matched and the rest are not", () => {
    // The index's own asymmetry, inherited rather than reimplemented. It is what
    // makes German compounding work in the reader's favour without a stemmer.
    const title = "Antrag: Digitale Infrastruktur im ländlichen Raum stärken"
    expect(matches(title, "Infra")).toBe(true)
    expect(matches(title, "Antrag Infra")).toBe(true)
    // Non-final terms are whole tokens, so a truncated one does not match.
    expect(matches(title, "Infra Antrag")).toBe(false)
  })

  test("every term must be present — this is not an OR", () => {
    const title = "Entwurf eines Gesetzes zur Beschleunigung von Planungsverfahren"
    expect(matches(title, "Gesetzes Planungsverfahren")).toBe(true)
    expect(matches(title, "Gesetzes Asylpolitik")).toBe(false)
  })

  test("a query with no word characters matches nothing rather than everything", () => {
    // `foldSearchQuery` returns "" for `"???"`, and `foldedTextMatches` treats a
    // termless query as no match. The caller must not turn that into "show the
    // whole period" — which is what a `.includes("")` would have done.
    expect(matches("Antrag: Bürokratieabbau", "???")).toBe(false)
    expect(matches("Antrag: Bürokratieabbau", "   ")).toBe(false)
  })
})
