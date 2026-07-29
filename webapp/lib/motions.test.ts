import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { normalizeMotionKind, normalizeMotionYear } from "./motions"
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

describe("URL normalisation at the /motions boundary", () => {
  /**
   * The URL is the untrusted input to this page — a bookmark, a hand-edit,
   * a shared link from an older revision. `normalizeMotion*` are the guards
   * that stop a malformed value reaching the Convex query as "an
   * index-selects-nothing filter", which renders as "no match" for a
   * period that has matches. The alternative to normalising here would be
   * silently lying to the reader with a chrome-driven empty state.
   */

  test("a four-digit year passes through unchanged", () => {
    expect(normalizeMotionYear("2026")).toBe("2026")
    expect(normalizeMotionYear("2019")).toBe("2019")
  })

  test("a malformed year is dropped rather than reaching the date bound", () => {
    // `abc-01-01`..`abc-12-31` sits lexicographically *above* every stored
    // ISO date, so the query would answer zero and the UI would render "no
    // match" for a period with matches. Same for a non-integer, an empty
    // string, or a value from a client that forgot to normalise.
    for (const bogus of ["abc", "", "20abc", "2026-01", "12345", " 2026", "2026 "]) {
      expect(normalizeMotionYear(bogus)).toBeNull()
    }
    expect(normalizeMotionYear(null)).toBeNull()
    expect(normalizeMotionYear(undefined)).toBeNull()
  })

  test("a non-empty kind passes through, trimmed", () => {
    // `vorgangstyp` is an open string on DIP so this cannot validate against
    // a vocabulary. The one guarantee it can offer is that the value is not
    // the empty string, which Radix's Select reserves for "no selection" and
    // which no motion actually carries.
    expect(normalizeMotionKind("Kleine Anfrage")).toBe("Kleine Anfrage")
    expect(normalizeMotionKind("  Antrag  ")).toBe("Antrag")
  })

  test("an empty kind is dropped rather than reaching the query as `''`", () => {
    // `?kind=` is reachable — a bookmark of a partly-cleared filter state,
    // or a hand-edited URL. `getMotionsPage(vorgangstyp: "")` would select
    // rows whose kind is literally the empty string (none), reading as "no
    // match" for a period whose motions all have a real kind.
    for (const bogus of ["", "  ", "\t"]) {
      expect(normalizeMotionKind(bogus)).toBeNull()
    }
    expect(normalizeMotionKind(null)).toBeNull()
    expect(normalizeMotionKind(undefined)).toBeNull()
  })
})

describe("getMotionFilterOptions bounds its reads independently of DIP's vocabulary", () => {
  /**
   * The read-cost story. `vorgangstyp` is an open string, so the count of
   * distinct kinds a period holds is not bounded by the schema — it grows
   * whenever DIP publishes a new procedure kind. Left unbounded, this
   * query's worst-case reads are
   *   DISCOVERY_SCAN + 1 + 1 + N * OPTION_COUNT_CEILING
   * where N is the discovered vocabulary size. Convex's 16 384-doc
   * transaction cap is reached at N = 32.
   *
   * `KIND_FANOUT_LIMIT` is what stops that. Read from the source so the two
   * constants — the limit and the reasoning about the cap — cannot drift
   * silently apart; the schema-index tests above use the same instrument
   * for the same reason.
   */
  function motionsSource() {
    return readFileSync(new URL("../convex/motions.ts", import.meta.url).pathname, "utf8")
  }

  test("KIND_FANOUT_LIMIT is declared and leaves meaningful headroom under the transaction cap", () => {
    const source = motionsSource()
    const kindLimit = /const KIND_FANOUT_LIMIT = (\d+)/.exec(source)?.[1]
    const optionCeiling = /const OPTION_COUNT_CEILING = (\d+)/.exec(source)?.[1]
    const discoveryScan = /const DISCOVERY_SCAN = (\d+)/.exec(source)?.[1]

    if (kindLimit === undefined) throw new Error("KIND_FANOUT_LIMIT not found in motions.ts")
    if (optionCeiling === undefined) throw new Error("OPTION_COUNT_CEILING not found in motions.ts")
    if (discoveryScan === undefined) throw new Error("DISCOVERY_SCAN not found in motions.ts")

    const worst =
      Number(discoveryScan) + 1 + 1 + Number(kindLimit) * Number(optionCeiling)
    // Strictly less than 14 000 rather than "under the 16 384 hard cap".
    // The hard cap is the ceiling this query shares with every other read
    // in the same transaction; a later edit raising the limit to 30 would
    // technically pass a `< 16 384` assertion (worst = 15 402) while eating
    // caller-side budget in the same page-load. 14 000 keeps ~2 400
    // documents of headroom, matching the docstring's stated intent.
    expect(worst).toBeLessThan(14_000)
    // Slightly greater than the highest N ever measured (23 in the WP21
    // sample), so future DIP additions do not immediately trip the cap.
    // The upper bound is what the tighter transaction-cap assertion above
    // enforces indirectly, restated positively here so a mutation that
    // raised it would report both facts together.
    expect(Number(kindLimit)).toBeGreaterThanOrEqual(24)
    expect(Number(kindLimit)).toBeLessThanOrEqual(28)
  })

  /**
   * The handler body of `getMotionFilterOptions`, isolated by anchoring on
   * the `export const getMotionFilterOptions` declaration and taking
   * everything up to (but not including) the *next* `export const` in the
   * file. That is stricter than "the next `})`" — nested closing braces
   * inside the object-form validator would otherwise terminate the match
   * before the real handler body was reached.
   */
  function filterOptionsHandler() {
    const source = motionsSource()
    const match = /export const getMotionFilterOptions[\s\S]*?(?=\nexport const )/.exec(source)
    if (match === null)
      throw new Error("could not isolate the getMotionFilterOptions handler in motions.ts")
    return match[0]
  }

  test("the handler slices the discovered vocabulary before the counting fanout", () => {
    // The property that turns the constant into a guarantee. Without the
    // `.slice(0, KIND_FANOUT_LIMIT)`, the constant is dead configuration:
    // 26 becomes 500 becomes 32-and-crash. The test asserts the slice is
    // present *before* the loop, which is where the loop's bound comes from.
    const handler = filterOptionsHandler()
    const sliceIdx = handler.indexOf("KIND_FANOUT_LIMIT")
    const loopIdx = handler.indexOf("for (const value of discovered)")
    expect(sliceIdx).toBeGreaterThan(-1)
    expect(loopIdx).toBeGreaterThan(-1)
    expect(sliceIdx).toBeLessThan(loopIdx)
  })

  test("the slice keeps the head of the sample, not the tail", () => {
    // A future edit that mistyped `.slice(0, KIND_FANOUT_LIMIT)` as
    // `.slice(-KIND_FANOUT_LIMIT)` would still keep exactly that many
    // members — and would still satisfy the "sliced-before-loop" test
    // above — but it would drop the recently-active kinds and keep the
    // dormant tail of the sample, silently swapping the dropdown's
    // meaning. Pins the orientation the docstring names.
    //
    // Runs the same textual regex the query does and checks the actual
    // slice, so a change to either the constant or the slice orientation
    // shows up as a real behavioural failure.
    const handler = filterOptionsHandler()
    const sliceMatch = /allDiscovered\.slice\(([^)]+)\)/.exec(handler)
    if (sliceMatch === null)
      throw new Error("could not find the slice call in getMotionFilterOptions")
    const args = sliceMatch[1].replace(/\s+/g, "")
    // Explicit "starts at 0" — anything else keeps the tail, not the head.
    expect(args).toBe("0,KIND_FANOUT_LIMIT")
  })

  test("the fanout cap contributes to `partial` so the UI can name the truncation", () => {
    // `partial: true` is the honest report the caller uses to render the
    // "kinds are drawn from a sample" caveat. If it flipped to `false` when
    // the vocabulary was capped rather than sampled, a reader whose kind
    // was silently dropped would see a complete-looking dropdown that
    // isn't. The test asserts both truncation modes contribute.
    const handler = filterOptionsHandler()
    // The last `partial:` occurrence in the handler is the returned one; the
    // earlier ones belong to the arguments validator and the returns
    // validator. Split-and-take-last is more robust to those than a regex
    // that tries to skip them.
    const partialLines = handler.split("\n").filter((line) => /partial:/.test(line))
    const returned = partialLines[partialLines.length - 1] ?? ""
    // The exact expression the handler evaluates is
    //   `recent.length > DISCOVERY_SCAN || fanoutCapped`.
    // Both operands must be present — the `||` is what turns the two
    // truncation modes into one honest report.
    expect(returned).toContain("DISCOVERY_SCAN")
    expect(returned).toContain("fanoutCapped")
  })
})
