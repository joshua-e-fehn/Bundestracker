import { describe, expect, test } from "bun:test"
import { foldSearchQuery, indexableText } from "./search"

/**
 * `foldName`'s own tests live in lib/bundestag.test.ts, where they were written
 * alongside the roster filter that uses it. These cover the search half of the
 * module — the folding that decides what the Convex index can find.
 *
 * The properties asserted here are not stylistic. Convex's `searchIndex` folds
 * case and nothing else (measured — see the module header), so every umlaut
 * case below is a query that finds nothing at all if the expansion breaks.
 */

describe("indexableText", () => {
  test("folds case and diacritics so the index can be queried without them", () => {
    const text = indexableText("Änderung des Klimaschutzgesetzes")
    expect(text).toContain("anderung")
    expect(text).toContain("klimaschutzgesetzes")
  })

  test("emits both German spellings of an umlaut", () => {
    // The whole reason this function exists: a reader may type any of the
    // three, and the index folds none of them together on its own.
    const text = indexableText("Förderung")
    expect(text).toContain("forderung")
    expect(text).toContain("foerderung")
  })

  test("emits ss for ß, which NFD leaves intact", () => {
    const text = indexableText("Großstädte")
    expect(text).toContain("grossstadte")
    expect(text).toContain("grossstaedte")
  })

  test("adds no second token for a word without an umlaut", () => {
    // A duplicate would cost index space and distort term frequency — which is
    // part of Convex's relevance score — while matching nothing new.
    expect(indexableText("Antrag").split(" ")).toEqual(["antrag"])
  })

  test("joins several fields and drops nulls", () => {
    const text = indexableText("Titel", null, "Beschreibung", undefined)
    expect(text).toContain("titel")
    expect(text).toContain("beschreibung")
    // "null" is a word, and it would be one every undescribed record matched.
    expect(text).not.toContain("null")
  })

  test("deduplicates repeated words", () => {
    expect(indexableText("Antrag Antrag", "antrag")).toBe("antrag")
  })

  test("splits on punctuation but keeps digits", () => {
    const text = indexableText("Ausschuss für Umwelt, Naturschutz — Drucksache 21/7327")
    expect(text).toContain("umwelt")
    expect(text).toContain("naturschutz")
    expect(text).toContain("21")
    expect(text).toContain("7327")
    expect(text).not.toContain(",")
  })

  test("keeps non-German diacritics as one word", () => {
    // `\w` would cut this into three fragments; `\p{L}` does not.
    expect(indexableText("Özoğuz")).toContain("ozoguz")
  })

  test("is empty for text with no word characters", () => {
    expect(indexableText("—  ,", null)).toBe("")
  })
})

describe("foldSearchQuery", () => {
  test("reduces every spelling of a query to the one the index holds", () => {
    // The asymmetry the module header describes: the document emits both
    // spellings, the query emits one, and they meet at the canonical form.
    expect(foldSearchQuery("Förderung")).toBe("forderung")
    expect(foldSearchQuery("Foerderung")).toBe("foerderung")
    expect(foldSearchQuery("Forderung")).toBe("forderung")
  })

  test("every query spelling is present in the indexed text", () => {
    const indexed = indexableText("Rechtsanwälte").split(" ")
    for (const spelling of ["Rechtsanwälte", "Rechtsanwaelte", "Rechtsanwalte"]) {
      expect(indexed).toContain(foldSearchQuery(spelling))
    }
  })

  test("normalises whitespace and case", () => {
    expect(foldSearchQuery("  Klima   Schutz ")).toBe("klima schutz")
  })

  test("is empty for a query with no words", () => {
    // Callers must treat this as "no search": Convex's `.search("")` is a query
    // with no terms, and what it returns answers nothing.
    expect(foldSearchQuery("???")).toBe("")
    expect(foldSearchQuery("   ")).toBe("")
  })
})
