import { describe, expect, test } from "bun:test"
import {
  drucksachePdfUrl,
  formatDate,
  fraktionClassName,
  initials,
  occupationFields,
  occupationOf,
  protocolPdfUrl,
  stateOf,
} from "./bundestag"
import { partyColor, partyFor } from "./parties"
import { foldName } from "./search"

/**
 * Tests for the document links and the display fallbacks.
 *
 * Two things here are worth a test rather than an eye. The URL builders
 * reproduce formulas §8 of docs/api-research.md verified against real
 * documents, and their failure mode is a link to the *wrong* paper rather than
 * a broken one — a reader cannot tell those apart. And `initials` is what
 * roughly two rows in three actually render (§6.5 measured portrait coverage at
 * 36.5 %), so it is the common path, not the fallback.
 */

describe("drucksachePdfUrl", () => {
  test("reproduces the worked example from the research", () => {
    // §8's own example: 21/7327 → btd/21/073/2107327.pdf. The number is padded
    // to five digits and the directory block is number // 100 padded to three.
    expect(drucksachePdfUrl("21/7327")).toBe("https://dserver.bundestag.de/btd/21/073/2107327.pdf")
  })

  test("pads a low paper number in both places", () => {
    expect(drucksachePdfUrl("21/42")).toBe("https://dserver.bundestag.de/btd/21/000/2100042.pdf")
  })

  test("refuses a bare number rather than guessing a period", () => {
    // §5.1: Bundesrat papers carry a bare running number with no `wp/` prefix.
    // Assuming the current period would produce a valid-looking URL pointing at
    // a different document, which is worse than no link at all.
    expect(drucksachePdfUrl("1067")).toBeNull()
    expect(drucksachePdfUrl("")).toBeNull()
    expect(drucksachePdfUrl(null)).toBeNull()
    expect(drucksachePdfUrl("21/7327 (neu)")).toBeNull()
  })
})

describe("protocolPdfUrl", () => {
  test("matches the pattern the pipeline uses for the XML", () => {
    // pipeline/src/bundestrack/api/protocols.py:101 builds the same address
    // with a .xml extension; §5.1 verified it against all 86 WP21 protocols.
    expect(protocolPdfUrl(21, 90)).toBe("https://dserver.bundestag.de/btp/21/21090.pdf")
    expect(protocolPdfUrl(20, 177)).toBe("https://dserver.bundestag.de/btp/20/20177.pdf")
  })

  test("pads the sitting number to three digits", () => {
    // Unpadded, WP21 sitting 9 would be `219.pdf` — which is WP2, sitting 19.
    expect(protocolPdfUrl(21, 9)).toBe("https://dserver.bundestag.de/btp/21/21009.pdf")
  })
})

describe("initials", () => {
  test("drops academic titles", () => {
    // Stammdaten carries titles inside the display name. An initial of "Dr" is
    // not an initial of anyone.
    expect(initials("Dr. Hülya Düber")).toBe("HD")
    expect(initials("Prof. Dr. Lars Castellucci")).toBe("LC")
  })

  test("drops the ortsZusatz disambiguator", () => {
    // `(Fulda)` distinguishes two MPs named Brand; it is not part of a name.
    expect(initials("Michael Brand (Fulda)")).toBe("MB")
  })

  test("handles a name particle and a single name", () => {
    expect(initials("Konstantin von Notz")).toBe("KN")
    expect(initials("Cansel")).toBe("C")
  })

  test("drops a leading particle so the first letter is the given name's", () => {
    // §4.1 files `von`/`van`/`de` under a column headed `Titel`. The rule came
    // from lib/format.ts when the two implementations were merged; without it
    // half the aristocracy shares the initials "V".
    expect(initials("Alexander von der Leyen")).toBe("AL")
    expect(initials("Christian de Vries")).toBe("CV")
  })

  test("splits a hyphenated surname on the hyphen", () => {
    // `Strack-Zimmermann` is one surname of two parts; a reader expects the
    // last of them.
    expect(initials("Marie-Agnes Strack-Zimmermann")).toBe("MZ")
  })

  test("never returns an empty label", () => {
    // `mpLabel` in convex/mps.ts falls back to the internal id for a missing
    // mandate (§7.3's Stammdaten lag), so a blank can reach here. An empty
    // avatar reads as a rendering bug rather than as missing data.
    expect(initials("")).toBe("?")
    expect(initials("   ")).toBe("?")
  })
})

describe("fraktionClassName", () => {
  test("matches the short form the vote sheets and DIP use", () => {
    // CDU/CSU is the one group deliberately styled from the neutral foreground
    // ramp rather than from its own `--party-*` token — black is both its
    // colour and the page's text colour. See `PARTY_STYLES`.
    expect(fraktionClassName("CDU/CSU")).toContain("foreground")
    // Asserted as the *token*, not as a hue. This line used to read
    // `.toContain("red")` against a `text-red-700` from a second party palette
    // that lived in this module; the palette now has one home in
    // lib/parties.ts, and naming the token is what keeps this test honest —
    // "red" would still pass if the SPD were given the wrong red.
    expect(fraktionClassName("SPD")).toContain("party-spd")
  })

  test("agrees with the palette every other component reads", () => {
    // The regression this whole consolidation was for: `FraktionBadge` (the
    // roster table, the profile header) styled itself from this function while
    // `PartyBadge` (the cards, the feed, the vote table, the rankings) styled
    // itself from `partyColor`, and the two held *different* colours for the
    // same group. One MP's AfD badge was Tailwind `sky` on /mps and
    // `--party-afd` on /rankings.
    //
    // Asserting the two agree, rather than asserting a literal, is what stops
    // them drifting apart again: a colour changed in one place now has to be
    // changed in the other or this fails.
    for (const fraktion of ["SPD", "AfD", "Die Linke", "BÜNDNIS 90/DIE GRÜNEN", "FDP"]) {
      const { key } = partyFor(fraktion)
      expect(fraktionClassName(fraktion)).toContain(`party-${key}`)
      expect(partyColor(fraktion)).toBe(`var(--party-${key})`)
    }
  })

  test("matches Stammdaten's long form too", () => {
    // §6.4's exact example, and the bug this test was written for: `cdu` is not
    // a substring of "Christlich Demokratischen Union", so matching the short
    // form alone rendered every Stammdaten-spelled row neutral — which looks
    // like a decision rather than a miss.
    expect(
      fraktionClassName("Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union"),
    ).toBe(fraktionClassName("CDU/CSU"))
    expect(fraktionClassName("Fraktion der Sozialdemokratischen Partei Deutschlands")).toBe(
      fraktionClassName("SPD"),
    )
    expect(fraktionClassName("Fraktion BÜNDNIS 90/DIE GRÜNEN")).toBe(
      fraktionClassName("BÜNDNIS 90/DIE GRÜNEN"),
    )
  })

  test("a long form containing another group's word is not misfiled", () => {
    // "Sozialdemokratischen Partei Deutschlands" contains `deutschland`, so the
    // AfD is matched on the whole phrase; the Greens' long form opens with
    // BÜNDNIS 90, so the BSW is matched on `wagenknecht`.
    expect(fraktionClassName("Fraktion der Sozialdemokratischen Partei Deutschlands")).not.toBe(
      fraktionClassName("AfD"),
    )
    expect(fraktionClassName("Fraktion BÜNDNIS 90/DIE GRÜNEN")).not.toBe(fraktionClassName("BSW"))
  })

  test("an unknown group is neutral, not uncoloured", () => {
    // Falling through is intended: a group is legible without its colour, and
    // inventing one would assert a party identity the data does not carry.
    expect(fraktionClassName("fraktionslos")).toContain("muted")
    expect(fraktionClassName("")).toContain("muted")
  })
})

/**
 * The one place that decides what "occupation" means, tested as one rule read
 * two ways.
 *
 * `occupationOf` labels an MP and `occupationFields` gives the search every
 * answer to match against. They must not be two rules: a search that matched on
 * `profession` while the page printed `occupation` would put a card on the
 * screen whose evidence contradicts the line beside it, which is the failure
 * `7e48f4a` introduced this function to prevent and the one `convex/search.ts`
 * had until the occupation index landed.
 *
 * The missing-data cases are the load-bearing half. All three absences — key
 * absent, null, and an empty string — mean *unknown*, and every one of them
 * occurs: the columns are `v.optional` in storage (convex/schema.ts), the
 * enrichment stage nulls what it did not reach, and both sources emit blanks.
 * Unknown is not "unemployed", so nothing here may invent a value.
 */
describe("occupationFields", () => {
  test("returns the current answer before the former one", () => {
    // abgeordnetenwatch's `occupation` is what they do now; Stammdaten's
    // `BERUF` is the trade practised before the mandate. The order is what
    // `occupationOf` takes its head from.
    expect(occupationFields({ occupation: "MdB", profession: "Rechtsanwältin" })).toEqual([
      "MdB",
      "Rechtsanwältin",
    ])
  })

  test("carries both, so the search can match a trade the label does not show", () => {
    // The recall case this function exists for. An MP whose `occupation` reads
    // "MdB" is still a lawyer, and there are enough of them that matching only
    // the label would make the profession lexicon — lib/thesaurus.ts's largest
    // section — reach almost nobody.
    const fields = occupationFields({ occupation: "MdB", profession: "Rechtsanwältin" })
    expect(fields).toContain("Rechtsanwältin")
    expect(occupationOf({ occupation: "MdB", profession: "Rechtsanwältin" })).toBe("MdB")
  })

  test("deduplicates when both sources say the same thing", () => {
    // The common case: the two columns agree far more often than they differ.
    // Two copies would count as two matches and print the same line twice.
    expect(occupationFields({ occupation: "Landwirt", profession: "Landwirt" })).toEqual([
      "Landwirt",
    ])
  })

  test("an absent key, a null and an empty string are all unknown", () => {
    // Three states, one meaning. `v.optional` in storage makes the first
    // reachable, the enrichment stage makes the second, and both sources emit
    // the third.
    expect(occupationFields({})).toEqual([])
    expect(occupationFields({ occupation: null, profession: null })).toEqual([])
    expect(occupationFields({ occupation: "", profession: "   " })).toEqual([])
  })

  test("falls back past an empty current answer rather than reporting nothing", () => {
    // An empty `occupation` is not an answer, so it must not shadow a
    // `profession` that is one.
    expect(occupationFields({ occupation: "  ", profession: "Ärztin" })).toEqual(["Ärztin"])
    expect(occupationOf({ occupation: "  ", profession: "Ärztin" })).toBe("Ärztin")
  })

  test("trims, because the label and the index both take it verbatim", () => {
    expect(occupationFields({ profession: "  Lehrerin  " })).toEqual(["Lehrerin"])
  })
})

describe("occupationOf", () => {
  test("is the head of the precedence, so the label cannot disagree with it", () => {
    // Asserting the relationship rather than a literal: a change to the
    // ordering has to change both or this fails, which is what keeps the search
    // from matching on a word the page then declines to print.
    for (const mp of [
      { occupation: "MdB", profession: "Rechtsanwältin" },
      { occupation: null, profession: "Landwirt" },
      { occupation: "Ärztin", profession: null },
      { occupation: null, profession: null },
      {},
    ]) {
      expect(occupationOf(mp)).toBe(occupationFields(mp)[0] ?? null)
    }
  })

  test("is null when nothing is recorded, never an empty string or a dash", () => {
    // The callers narrow on truthiness and render *nothing* — an omitted line
    // on the tooltip, a dash in a table cell. An empty string would render as a
    // present-but-blank value, which reads as data that failed to load.
    expect(occupationOf({})).toBeNull()
    expect(occupationOf({ occupation: null, profession: null })).toBeNull()
    expect(occupationOf({ occupation: "", profession: "" })).toBeNull()
  })
})

describe("formatDate", () => {
  test("renders the stored calendar day, not a shifted one", () => {
    // The stored dates are days with no time, so they are parsed as midnight
    // UTC. Formatting in local time moves every date back a day for readers
    // west of Greenwich — and only for them.
    expect(formatDate("2026-06-12", "de")).toBe("12. Juni 2026")
    expect(formatDate("2026-01-01", "en")).toBe("January 1, 2026")
  })

  test("passes through a string that is not a date", () => {
    // Rendering the raw value keeps a source oddity visible; an empty cell
    // reads as "no date recorded", which is a different claim.
    expect(formatDate("2026-02-31", "de")).toBe("2026-02-31")
    expect(formatDate("", "de")).toBe("")
  })
})

describe("foldName", () => {
  test("folds the diacritics the two official sources disagree on", () => {
    // §6.1: DIP writes `Özoguz` where Stammdaten writes `Özoğuz`. A reader
    // typing either — or neither — should find the MP.
    expect(foldName("Özoğuz")).toBe(foldName("Ozoguz"))
    expect(foldName("Salihović")).toBe(foldName("Salihovic"))
  })

  test("ß folds to ss", () => {
    // Before decomposition, because `ß` has no combining form: NFD leaves it
    // intact, so folding after would leave `Strauß` and `Strauss` apart.
    expect(foldName("Strauß")).toBe("strauss")
    expect(foldName("Strauß")).toBe(foldName("Strauss"))
  })

  test("is case- and whitespace-insensitive", () => {
    expect(foldName("  MERZ ")).toBe("merz")
  })
})

describe("stateOf", () => {
  /**
   * The federal state is a stored column now (`mps.federalState`), and this
   * function is the one place every surface reads it through.
   *
   * It replaced a regex over the constituency *name*, which looked like a
   * partial answer and was not one: measured against the real Stammdaten dump,
   * **0** of 13 046 `WKR_NAME` values end in a parenthetical, so it returned
   * null for every MP who has ever sat. Both state filters were wired end to
   * end and never rendered. That is the bug these tests exist to keep fixed —
   * and none of them could have caught it, which is why the *shape* of the
   * unknown case is asserted here and the coverage claim is measured in
   * `test_pipeline_transform.py` against the source instead.
   */
  test("returns the code the source published", () => {
    expect(stateOf("BW")).toBe("BW")
    expect(stateOf("NW")).toBe("NW")
  })

  test("a mandate the source states no Land for is unknown, not a guess", () => {
    // 21 of WP21's 635 mandates: list members with no constituency block at
    // all. The pipeline sends this as an explicit null.
    expect(stateOf(null)).toBeNull()
  })

  test("a row written before the column existed reads as unknown too", () => {
    // The stored column is `v.optional`, so a mandate ingested by an older
    // pipeline has no key and reads back as `undefined`. Folded together with
    // null: both mean "we cannot say", and a roster re-post converts one into
    // the other. Distinguishing them in the UI would surface a fact about the
    // ingest history rather than about the member.
    expect(stateOf(undefined)).toBeNull()
  })

  test("an empty or blank code is unknown rather than a filterable value", () => {
    // Stammdaten emits `<TAG/>` for absent and the parser maps that to None,
    // so a blank arriving here means something upstream stored whitespace.
    // Returning it would put an unlabelled option in every state dropdown.
    expect(stateOf("")).toBeNull()
    expect(stateOf("   ")).toBeNull()
  })

  test("a historical period's own vocabulary passes through unchanged", () => {
    // ⚠ 35 distinct codes across the corpus for 16 Länder: WP1–17 write `NDS`
    // and `THÜ` where WP18–21 write `NI` and `TH` (§6.2). Normalising here
    // would need a per-period table and would rename entities that no longer
    // exist (`WBB`, Württemberg-Baden). Every filter is period-scoped and
    // builds its options from the data, so the raw code is the right answer.
    expect(stateOf("NDS")).toBe("NDS")
    expect(stateOf("THÜ")).toBe("THÜ")
    expect(stateOf("BWG")).toBe("BWG")
  })

  test("a constituency name is no longer mistaken for a state", () => {
    // The old implementation's whole input. `Brand (Fulda)` is the case it
    // guarded against — a town in the parenthetical slot, not a Land — and
    // `Ludwigsburg (BW)` is the shape it was written for and the corpus never
    // contains. Neither is a state code, and passing either here now means a
    // caller is reading the wrong column.
    expect(stateOf("Ludwigsburg (BW)")).toBe("Ludwigsburg (BW)")
    expect(stateOf("Brand (Fulda)")).toBe("Brand (Fulda)")
  })
})
