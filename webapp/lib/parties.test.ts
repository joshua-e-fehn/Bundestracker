import { describe, expect, test } from "bun:test"
import {
  foldFractionSizes,
  PARTY_KEYS,
  partyByKey,
  partyColor,
  partyFor,
  partyKeyColor,
  partyLabel,
} from "./parties"

/**
 * The cases here are the spellings docs/api-research.md actually observed in the
 * sources, not invented variations. Each source spells a Fraktion differently
 * (§6.4) and the protocol XML adds a non-breaking space (§5.2); a normaliser
 * that only handles the tidy short form would pass a hand-written test and fail
 * on real data.
 */

describe("partyFor", () => {
  test("recognises the short forms the vote sheets print", () => {
    // §4.1, column 3: `CDU/CSU`, `BÜ90/GR`, `Die Linke`, `Fraktionslos`.
    expect(partyFor("CDU/CSU").key).toBe("cdu-csu")
    expect(partyFor("SPD").key).toBe("spd")
    expect(partyFor("BÜ90/GR").key).toBe("gruene")
    expect(partyFor("Die Linke").key).toBe("linke")
    expect(partyFor("AfD").key).toBe("afd")
    expect(partyFor("FDP").key).toBe("fdp")
    expect(partyFor("Fraktionslos").key).toBe("fraktionslos")
  })

  test("recognises the long forms Stammdaten publishes", () => {
    // §6.4: the legal name, with spaced hyphens inside it.
    expect(
      partyFor("Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union").key,
    ).toBe("cdu-csu")
    expect(partyFor("Fraktion der Sozialdemokratischen Partei Deutschlands").key).toBe("spd")
    expect(partyFor("Fraktion der Freien Demokratischen Partei").key).toBe("fdp")
  })

  test("recognises the DIP spelling of the Greens", () => {
    expect(partyFor("BÜNDNIS 90/DIE GRÜNEN").key).toBe("gruene")
    expect(partyFor("Fraktion BÜNDNIS 90/DIE GRÜNEN").key).toBe("gruene")
  })

  test("survives the protocol XML's non-breaking space", () => {
    // §5.2 records this exact string: a \xa0 after BÜNDNIS and a stray space
    // after the slash. Equality against the DIP spelling would miss it.
    expect(partyFor("BÜNDNIS 90/ DIE GRÜNEN").key).toBe("gruene")
  })

  test("folds umlauts, so GRUENEN and GRÜNEN agree", () => {
    expect(partyFor("Bündnis 90/Die Grünen").key).toBe("gruene")
    expect(partyFor("Buendnis 90/Die Gruenen").key).toBe("gruene")
  })

  test("is case- and whitespace-insensitive", () => {
    expect(partyFor("  cdu/csu  ").key).toBe("cdu-csu")
    expect(partyFor("fraktionslos").key).toBe("fraktionslos")
    expect(partyFor("FRAKTIONSLOS").key).toBe("fraktionslos")
  })

  test("does not mistake 'Christlich - Sozialen' for the SPD", () => {
    // The long CDU/CSU form contains "Sozialen"; `spd` matches on
    // "sozialdemokrat", and the union is checked first regardless.
    expect(
      partyFor("Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union").key,
    ).not.toBe("spd")
  })

  test("an MP without a group is fraktionslos, not unknown", () => {
    // Checked ahead of the party names: a leaver may still be recorded with a
    // string that mentions the group they left.
    expect(partyFor("fraktionslos (ehem. AfD)").key).toBe("fraktionslos")
  })

  test("falls back to unknown rather than throwing", () => {
    // The failure mode this exists to prevent is a new Fraktion silently
    // rendering in some other party's colours.
    expect(partyFor("Neue Partei 2029").key).toBe("unknown")
    expect(partyFor("").key).toBe("unknown")
    expect(partyFor(null).key).toBe("unknown")
    expect(partyFor(undefined).key).toBe("unknown")
    expect(partyFor("   ").key).toBe("unknown")
  })
})

describe("partyLabel", () => {
  test("normalises a recognised group to one spelling", () => {
    expect(partyLabel("Fraktion BÜNDNIS 90/DIE GRÜNEN")).toBe("Grüne")
    expect(partyLabel("BÜ90/GR")).toBe("Grüne")
    expect(
      partyLabel("Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union"),
    ).toBe("CDU/CSU")
  })

  test("shows an unrecognised group verbatim", () => {
    // Showing the raw value is how a missing matcher becomes visible, instead
    // of everything unfamiliar collapsing into one anonymous dash.
    expect(partyLabel("Neue Partei 2029")).toBe("Neue Partei 2029")
  })

  test("falls back to a dash when there is nothing to show", () => {
    expect(partyLabel(null)).toBe("—")
    expect(partyLabel("  ")).toBe("—")
  })
})

describe("partyColor", () => {
  test("returns a themable variable reference, not a literal colour", () => {
    expect(partyColor("SPD")).toBe("var(--party-spd)")
    expect(partyColor("Neue Partei 2029")).toBe("var(--party-unknown)")
  })

  test("every party key has a distinct colour variable", () => {
    const vars = PARTY_KEYS.map((key) => partyColor(key === "cdu-csu" ? "CDU/CSU" : key))
    expect(new Set(vars).size).toBe(PARTY_KEYS.length)
  })
})

describe("partyKeyColor", () => {
  test("agrees with partyColor for every key", () => {
    // The two must not diverge: `partyColor` takes a Fraktion string and folds
    // it, this takes the key directly, and the party pages use both — a badge
    // beside a chart that coloured the same group differently would look like a
    // rendering bug rather than a lookup bug.
    for (const key of PARTY_KEYS) {
      expect(partyKeyColor(key)).toBe(`var(${partyByKey(key).colorVar})`)
    }
  })

  test("skips the label round trip that reads as if labels were the identity", () => {
    // What nine call sites were doing: key → label → substring match → key. It
    // works, and it invites the conclusion that a label is a safe thing to key a
    // colour on, which the header of this module exists to deny.
    expect(partyKeyColor("cdu-csu")).toBe(partyColor("CDU/CSU"))
    expect(partyKeyColor("gruene")).toBe(partyColor("BÜNDNIS 90/DIE GRÜNEN"))
  })

  test("every key still has a distinct colour", () => {
    expect(new Set(PARTY_KEYS.map(partyKeyColor)).size).toBe(PARTY_KEYS.length)
  })
})

describe("foldFractionSizes", () => {
  test("merges the casing split production actually holds", () => {
    // The exact rows `getFractionSizes` returned for WP21 on 2026-07-27. The
    // home page rendered the last two as separate legend entries — "Fraktionslos
    // 1" and "Fraktionslos 3", same colour, seats split — while /seating and
    // /parties showed the correct merged 4.
    const folded = foldFractionSizes([
      { fraktion: "CDU/CSU", count: 213 },
      { fraktion: "AfD", count: 151 },
      { fraktion: "SPD", count: 124 },
      { fraktion: "BÜNDNIS 90/DIE GRÜNEN", count: 89 },
      { fraktion: "Die Linke", count: 66 },
      { fraktion: "Fraktionslos", count: 3 },
      { fraktion: "fraktionslos", count: 1 },
    ])

    expect(folded).toHaveLength(6)
    expect(folded.map((entry) => partyLabel(entry.fraktion))).toEqual([
      "CDU/CSU",
      "AfD",
      "SPD",
      "Grüne",
      "Die Linke",
      "Fraktionslos",
    ])
    expect(folded.at(-1)?.count).toBe(4)
  })

  test("conserves the total seat count", () => {
    // The property that matters beyond the one known split: folding may merge
    // entries but must never lose or invent a seat, or the hero's "635 Sitze"
    // would disagree with the legend beside it.
    const sizes = [
      { fraktion: "Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union", count: 200 },
      { fraktion: "CDU/CSU", count: 13 },
      { fraktion: "BÜ90/GR", count: 40 },
      { fraktion: "BÜNDNIS\u00a090/ DIE GRÜNEN", count: 49 },
      { fraktion: "Fraktionslos", count: 3 },
      { fraktion: "fraktionslos", count: 1 },
    ]
    const total = sizes.reduce((sum, entry) => sum + entry.count, 0)
    const folded = foldFractionSizes(sizes)

    expect(folded.reduce((sum, entry) => sum + entry.count, 0)).toBe(total)
    // The long Stammdaten form, the short form and both Grüne spellings each
    // collapse — three groups from six rows.
    expect(folded).toHaveLength(3)
  })

  test("keeps an unrecognised group as its own entry", () => {
    // A new Fraktion must render as itself rather than merging into `unknown`
    // with some other unrecognised group — the header's rule that an unmatched
    // value is displayed, not discarded. Two unknowns do merge, which is the
    // honest limit of a fold keyed on the party: neither has an identity this
    // module can tell apart.
    const folded = foldFractionSizes([
      { fraktion: "SPD", count: 10 },
      { fraktion: "BSW", count: 5 },
    ])
    expect(folded).toHaveLength(2)
    expect(partyLabel(folded[1].fraktion)).toBe("BSW")
  })

  test("leaves the caller's ordering alone", () => {
    // Insertion order is preserved, so the query's largest-first sort survives
    // and the biggest group still leads the legend.
    const folded = foldFractionSizes([
      { fraktion: "SPD", count: 124 },
      { fraktion: "AfD", count: 151 },
    ])
    expect(folded.map((entry) => entry.fraktion)).toEqual(["SPD", "AfD"])
  })

  test("returns nothing for nothing", () => {
    expect(foldFractionSizes([])).toEqual([])
  })
})
