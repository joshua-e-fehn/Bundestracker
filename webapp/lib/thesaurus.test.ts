import { describe, expect, test } from "bun:test"
import { foldSearchQuery } from "./search"
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
