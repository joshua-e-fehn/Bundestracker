import { describe, expect, test } from "bun:test"
import {
  drucksachePdfUrl,
  formatDate,
  fraktionClassName,
  initials,
  protocolPdfUrl,
} from "./bundestag"
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
    expect(fraktionClassName("CDU/CSU")).toContain("foreground")
    expect(fraktionClassName("SPD")).toContain("red")
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
