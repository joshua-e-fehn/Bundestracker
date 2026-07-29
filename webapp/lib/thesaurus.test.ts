import { describe, expect, test } from "bun:test"
import { occupationFields } from "./bundestag"
import { foldedTextMatches, foldSearchQuery, indexableText } from "./search"
import { expandQuery, thesaurusTerms } from "./thesaurus"

describe("thesaurus entries", () => {
  /**
   * The guard the module header calls for by name.
   *
   * Every term is looked up with a key that has been through `foldSearchQuery`,
   * so a term written here with an umlaut, an uppercase letter or an `ß` is one
   * no query can ever reach. The failure is silent — the search keeps working
   * in one language and stops working in the other — which is exactly the kind
   * of bug a test has to catch.
   */
  test("every term is already in folded form", () => {
    for (const term of thesaurusTerms()) {
      expect(foldSearchQuery(term), `"${term}" is not folded`).toBe(term)
    }
  })

  test("expansion is symmetric", () => {
    // Built from groups rather than pairs precisely so this cannot fail, which
    // is why it is worth asserting: it pins the property the construction
    // provides, so a future hand-written map would fail here rather than work
    // in German only.
    for (const term of thesaurusTerms()) {
      for (const other of expandQuery(term)) {
        expect(expandQuery(other), `${term} → ${other} is one-way`).toContain(term)
      }
    }
  })

  test("no term expands to itself", () => {
    for (const term of thesaurusTerms()) {
      expect(expandQuery(term)).not.toContain(term)
    }
  })
})

describe("expandQuery", () => {
  test("crosses the language boundary in both directions", () => {
    // The requirement Wave 9 names explicitly.
    expect(expandQuery("lawyer")).toContain("rechtsanwalt")
    expect(expandQuery("rechtsanwalt")).toContain("lawyer")
    expect(expandQuery("climate")).toContain("klima")
    expect(expandQuery("klima")).toContain("climate")
  })

  test("expands each word of a multi-word query", () => {
    const expanded = expandQuery("renewable energy")
    expect(expanded).toContain("erneuerbar")
    expect(expanded).toContain("energie")
  })

  test("prefers a whole-phrase entry over its parts", () => {
    // "kleine anfrage" is a named instrument; expanding it as "small" + "query"
    // would bury the one right answer under the generic senses of both words.
    expect(expandQuery("kleine anfrage")).toEqual(["minor interpellation"])
  })

  test("returns nothing for a term the lexicon does not know", () => {
    // The normal case: the lexicon covers what a reader crosses a language
    // boundary with, not the corpus.
    expect(expandQuery("zzzznotaword")).toEqual([])
    expect(expandQuery("")).toEqual([])
  })

  test("German entries are roots, so the index's prefix rule reaches compounds", () => {
    // `miet` rather than `Miete` — see the module header. The index
    // prefix-matches the final query term, so the root reaches `Mietrecht` and
    // `Mietpreisbremse` where the inflected noun would not.
    expect(expandQuery("rent")).toContain("miet")
    expect(expandQuery("tax")).toContain("steuer")
  })

  test("keeps politically loaded terms apart", () => {
    // Which word a motion uses is itself a political choice; collapsing the two
    // would make the search assert an equivalence the drafters avoided.
    expect(expandQuery("migration")).not.toContain("asyl")
    expect(expandQuery("asyl")).not.toContain("migration")
  })
})

/**
 * The lexicon against the roster field it was written for — the whole of
 * GAP-010, asserted end to end.
 *
 * The gap was not that the table was wrong. `expandQuery("lawyer")` already
 * returned `rechtsanwalt`, and the tests above already proved it. The failure
 * was one layer down: `mps.occupation` and `mps.profession` sit on the roster
 * row, which carries no search index and produces no feed event, so the term
 * the lexicon produced had nothing to match against. Measured live during the
 * audit: `lawyer` → 0 results, `Rechtsanwalt` → 5, and those 5 were motion
 * titles rather than the lawyers in the chamber.
 *
 * So these run the reader's actual path — fold, expand, match the roster
 * string — rather than any one stage of it. The professions section of the
 * lexicon is the part with the best data behind it (Stammdaten's `BERUF` covers
 * 94.3 % of the roster) and was the part that reached nobody.
 */
describe("profession queries reach the roster", () => {
  /** What convex/search.ts does with one MP: the reader's query plus its
   * lexicon expansion, each tried against every recorded trade. */
  function finds(mp: { occupation?: string | null; profession?: string | null }, query: string) {
    const folded = foldSearchQuery(query)
    const terms = [folded, ...expandQuery(folded)]
    return occupationFields(mp).some((value) =>
      terms.some((term) => foldedTextMatches(indexableText(value), term)),
    )
  }

  test("an English query reaches the German trade", () => {
    // The requirement Wave 9 names, and the measurement GAP-010 records.
    expect(finds({ profession: "Rechtsanwalt" }, "lawyer")).toBe(true)
    expect(finds({ profession: "Ärztin" }, "doctor")).toBe(true)
    expect(finds({ occupation: "Landwirt" }, "farmer")).toBe(true)
    expect(finds({ profession: "Diplom-Ingenieur" }, "engineer")).toBe(true)
  })

  test("and the German query still does", () => {
    // The direction that was already meant to work. Both, because a lexicon
    // that fixed one by breaking the other would be no better.
    expect(finds({ profession: "Rechtsanwalt" }, "Rechtsanwalt")).toBe(true)
    expect(finds({ profession: "Rechtsanwältin" }, "Rechtsanwalt")).toBe(true)
    expect(finds({ profession: "Rechtsanwältin" }, "Rechtsanwältin")).toBe(true)
  })

  test("reaches a trade the profile label does not show", () => {
    // The reason the matching reads every field rather than `occupationOf`'s
    // one: a sitting member's `occupation` is frequently the mandate itself.
    expect(finds({ occupation: "MdB", profession: "Rechtsanwältin" }, "lawyer")).toBe(true)
  })

  test("an MP with nothing recorded is found by nothing", () => {
    // Unknown, not unemployed — and emphatically not "matches every query",
    // which is what an empty haystack plus a permissive matcher would give.
    expect(finds({}, "lawyer")).toBe(false)
    expect(finds({ occupation: null, profession: null }, "lawyer")).toBe(false)
    expect(finds({ occupation: "", profession: "  " }, "lawyer")).toBe(false)
  })

  test("a trade nobody holds finds nobody", () => {
    expect(finds({ profession: "Rechtsanwalt" }, "farmer")).toBe(false)
    expect(finds({ profession: "Rechtsanwalt" }, "zzzznotaword")).toBe(false)
  })
})
