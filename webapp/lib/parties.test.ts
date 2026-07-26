import { describe, expect, test } from "bun:test"
import { PARTY_KEYS, partyColor, partyFor, partyLabel } from "./parties"

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
    expect(partyFor("Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union").key).not.toBe(
      "spd",
    )
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
