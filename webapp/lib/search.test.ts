import { describe, expect, test } from "bun:test"
import { foldedTextMatches, foldSearchQuery, indexableText } from "./search"

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

/**
 * The in-memory stand-in for the index, used by `convex/search.ts` for the two
 * things the index cannot reach: a committee name, and an MP's recorded trade.
 *
 * Every assertion here is a rule *measured against a real search index* (see
 * the module header) rather than a rule invented for this function. That is the
 * property worth testing: the moment these diverge, a keyword becomes findable
 * in a committee name and unfindable in a motion title, and nothing on the page
 * would say so.
 *
 * Both arguments are written through the same functions the callers use, so a
 * change to the folding rule fails here rather than silently changing what the
 * roster can be searched by.
 */
describe("foldedTextMatches", () => {
  /** As `convex/search.ts` calls it: text through `indexableText`, query
   * through `foldSearchQuery`. */
  function matches(text: string, query: string): boolean {
    return foldedTextMatches(indexableText(text), foldSearchQuery(query))
  }

  test("prefix-matches the final term, as the index does", () => {
    // The index's own behaviour, and the reason lib/thesaurus.ts stores German
    // roots: `klima` reaches `Klimaschutzgesetz` for free.
    expect(matches("Rechtsanwältin", "rechtsanwalt")).toBe(true)
    expect(matches("Klimaschutzgesetz", "klima")).toBe(true)
    // …and not the other way round. A document word is not a prefix of the
    // query.
    expect(matches("Klima", "klimaschutzgesetz")).toBe(false)
  })

  test("folds umlauts on both sides", () => {
    // The whole point of indexing both spellings: a reader without an umlaut
    // key types the long form as often as the bare vowel.
    for (const query of ["Rechtsanwältin", "Rechtsanwaeltin", "Rechtsanwaltin"]) {
      expect(matches("Rechtsanwältin", query), query).toBe(true)
    }
    expect(matches("Ökonom", "okonom")).toBe(true)
    expect(matches("Ökonom", "oekonom")).toBe(true)
  })

  test("requires every term of a multi-word query", () => {
    // `ausschuss umwelt` must not match a committee that is only one of them.
    expect(matches("Ausschuss für Umwelt und Naturschutz", "ausschuss umwelt")).toBe(true)
    expect(matches("Ausschuss für Inneres", "ausschuss umwelt")).toBe(false)
  })

  test("matches regardless of the order the words appear in", () => {
    // A document is a bag of tokens to the index, and this stands in for it.
    expect(matches("Ausschuss für Umwelt und Naturschutz", "umwelt ausschuss")).toBe(true)
  })

  test("does not match across a token boundary", () => {
    // The false positive the substring test this replaced actually had: a
    // needle spanning two words matched the joined token string. `wertarzt` is
    // a substring of "facharzt … tierarzt" only if the tokens are run together.
    expect(matches("Facharzt Tierarzt", "ztti")).toBe(false)
    expect(matches("Rechtsanwalt Notar", "waltnotar")).toBe(false)
  })

  test("matches a two-word query whose words are not adjacent in the index", () => {
    // The regression the substring test would have: `indexableText` emits
    // tokens in first-seen order with each umlaut expansion beside its own
    // word, so two words the reader typed together are frequently separated in
    // the indexed string. `for` here sits between them.
    const indexed = indexableText("Ausschuss für Umwelt")
    expect(indexed.split(" ")).toContain("fur")
    expect(foldedTextMatches(indexed, foldSearchQuery("ausschuss umwelt"))).toBe(true)
  })

  test("an empty query matches nothing, and neither does empty text", () => {
    // Not "matches everything": an empty query is not a search, exactly as
    // `foldSearchQuery`'s own note says. And an MP with no recorded trade must
    // not be returned by every search on the site.
    expect(foldedTextMatches(indexableText("Rechtsanwalt"), "")).toBe(false)
    expect(foldedTextMatches("", foldSearchQuery("rechtsanwalt"))).toBe(false)
    expect(foldedTextMatches(indexableText(""), foldSearchQuery("anything"))).toBe(false)
  })

  test("agrees with the index on what a whole word is", () => {
    // Punctuation and digits split the same way on both sides, because both go
    // through `words()`.
    expect(matches("Rechtsanwalt, selbstständig", "selbststandig")).toBe(true)
    expect(matches("Diplom-Ingenieur (FH)", "ingenieur")).toBe(true)
  })
})
