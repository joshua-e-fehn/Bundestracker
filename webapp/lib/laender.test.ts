import { describe, expect, test } from "bun:test"
import { LOCALES } from "./i18n"
import { LAND_CODES, landNameFor, landNameOrNull } from "./laender"

/**
 * The `WKR_LAND` display mapping.
 *
 * Two properties are worth testing rather than eyeballing, and they pull in
 * opposite directions:
 *
 *  - **Completeness.** A code the table misses renders as a raw `SWH` in a
 *    dropdown — legible enough to survive review, useless to a reader. So the
 *    corpus's own code set is asserted below rather than described.
 *  - **Restraint.** The failure that matters more is a code mapped to the
 *    *wrong* Land, which is a plausible label on a real filter and nothing in
 *    the app would contradict it. Hence the era and merger assertions: they
 *    check the table against German constitutional history, which is the one
 *    thing available to check it against.
 */

/**
 * Every `WKR_LAND` value in the dump, measured on 2026-07-29 against version
 * `1777449783` (4 614 MDBs, 13 046 mandate rows).
 *
 * Hardcoded rather than derived: this is the *source's* vocabulary, and the
 * point of the assertion is to fail when the table and the corpus disagree. A
 * list computed from the table would agree with it by construction and test
 * nothing. When a future dump adds a code, this list is what has to be updated
 * — deliberately, with a name chosen for it.
 */
const CODES_IN_CORPUS = [
  // WP18–21
  "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV",
  "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
  // WP1–17
  "BWG", "BAY", "BLN", "BRA", "BRE", "HBG", "HES", "MBV",
  "NDS", "NRW", "RPF", "SLD", "SAC", "SAA", "SWH", "THÜ",
  // WP1 only — merged into Baden-Württemberg in 1952
  "BAD", "WBB", "WBH",
]

describe("the code table", () => {
  test("names every code the corpus actually contains", () => {
    // 35 non-empty codes for 16 Länder — the figure §6.2 of
    // docs/api-research.md gives, re-measured here.
    expect(CODES_IN_CORPUS.length).toBe(35)
    const missing = CODES_IN_CORPUS.filter((code) => !LAND_CODES.includes(code))
    expect(missing).toEqual([])
  })

  test("names nothing the corpus does not contain", () => {
    // The other direction, so the table cannot accumulate invented codes that
    // no assertion ever exercises.
    const extra = LAND_CODES.filter((code) => !CODES_IN_CORPUS.includes(code))
    expect(extra).toEqual([])
  })
})

describe("landNameFor — modern codes", () => {
  test("names the WP18–21 vocabulary", () => {
    expect(landNameFor("NW", "de")).toBe("Nordrhein-Westfalen")
    expect(landNameFor("BY", "de")).toBe("Bayern")
    expect(landNameFor("TH", "de")).toBe("Thüringen")
  })

  test("uses the English exonym where the Land has one", () => {
    expect(landNameFor("NW", "en")).toBe("North Rhine-Westphalia")
    expect(landNameFor("BY", "en")).toBe("Bavaria")
    expect(landNameFor("NI", "en")).toBe("Lower Saxony")
    expect(landNameFor("MV", "en")).toBe("Mecklenburg-Western Pomerania")
  })

  test("does not invent an English name where the Land has none", () => {
    // `Hessen` → `Hesse` is a real exonym; `Bremen` and `Hamburg` are not
    // translated by anyone, and rendering "Free Hanseatic City of Bremen" in a
    // filter would be a flourish rather than a translation.
    expect(landNameFor("HB", "en")).toBe("Bremen")
    expect(landNameFor("HH", "en")).toBe("Hamburg")
    expect(landNameFor("SL", "en")).toBe("Saarland")
    expect(landNameFor("BW", "en")).toBe("Baden-Württemberg")
  })
})

describe("landNameFor — historical codes", () => {
  test("names the WP1–17 vocabulary as the same Länder", () => {
    // The whole reason a historical period's filter is usable at all: `NRW` is
    // the same Land as `NW`, spelled the way its own era spelled it.
    expect(landNameFor("NRW", "de")).toBe("Nordrhein-Westfalen")
    expect(landNameFor("NDS", "de")).toBe("Niedersachsen")
    expect(landNameFor("SWH", "de")).toBe("Schleswig-Holstein")
    expect(landNameFor("THÜ", "en")).toBe("Thuringia")
  })

  test("an old code and its modern counterpart name the same Land", () => {
    // Asserted as a pair rather than as two literals: if either row is edited,
    // the two must move together or a period switch renames a state.
    const pairs = [
      ["NRW", "NW"], ["NDS", "NI"], ["BWG", "BW"], ["BAY", "BY"],
      ["HES", "HE"], ["RPF", "RP"], ["SWH", "SH"], ["HBG", "HH"],
      ["BRE", "HB"], ["SLD", "SL"], ["SAC", "SN"], ["SAA", "ST"],
      ["THÜ", "TH"], ["BLN", "BE"], ["BRA", "BB"], ["MBV", "MV"],
    ] as const
    for (const [old, modern] of pairs) {
      for (const locale of LOCALES) {
        expect(landNameFor(old, locale), `${old} vs ${modern} (${locale})`).toBe(
          landNameFor(modern, locale),
        )
      }
    }
    // All sixteen Länder are covered by that list, which is what makes it a
    // completeness check and not a sample.
    expect(pairs.length).toBe(16)
  })

  test("the pre-1952 states are named as themselves, not as Baden-Württemberg", () => {
    // These elected members to the *first* Bundestag and merged in 1952. The
    // dump agrees: all three appear in WP1 and nowhere else, and `BWG` starts
    // at WP2. Labelling a 1949 Württemberg-Baden mandate "Baden-Württemberg"
    // would assert a Land that did not yet exist.
    expect(landNameFor("BAD", "de")).toBe("Baden")
    expect(landNameFor("WBB", "de")).toBe("Württemberg-Baden")
    expect(landNameFor("WBH", "de")).toBe("Württemberg-Hohenzollern")
    expect(landNameFor("WBB", "de")).not.toBe(landNameFor("BWG", "de"))
  })

  test("no code is shared between the two eras", () => {
    // The premise that lets this be one flat table with no Wahlperiode
    // argument. Measured: the WP1–17 and WP18–21 vocabularies are disjoint, so
    // a code is unambiguous on its own. If a future period ever reuses an old
    // spelling, this fails — and the mapping genuinely would need a period.
    const modern = ["BW","BY","BE","BB","HB","HH","HE","MV","NI","NW","RP","SL","SN","ST","SH","TH"]
    const historical = [
      "BWG","BAY","BLN","BRA","BRE","HBG","HES","MBV",
      "NDS","NRW","RPF","SLD","SAC","SAA","SWH","THÜ","BAD","WBB","WBH",
    ]
    expect(modern.filter((code) => historical.includes(code))).toEqual([])
  })
})

describe("landNameFor — unknown codes", () => {
  test("an unrecognised code is shown as itself, never dropped", () => {
    // The same rule `parties.ts` applies to an unknown Fraktion. A code from a
    // future period should look like a raw code — a visible prompt to add it —
    // rather than vanish from the dropdown or borrow another Land's name.
    expect(landNameFor("XX", "de")).toBe("XX")
    expect(landNameFor("XX", "en")).toBe("XX")
  })

  test("lookup is exact, so a near-miss does not borrow a name", () => {
    // Case and whitespace are not normalised on purpose: the source emits
    // clean uppercase codes, so a lowercase one means something upstream is
    // wrong, and silently accepting it would hide that.
    expect(landNameFor("nw", "de")).toBe("nw")
    expect(landNameFor("N", "de")).toBe("N")
  })
})

describe("landNameOrNull — the absent case", () => {
  test("null and undefined stay null for the caller to render", () => {
    // 21 of WP21's 635 mandates carry no `WKR_LAND`, and rows written before
    // the column existed have no key at all. Neither gets a label here: a
    // filter omits the option, a profile line might print an em dash, and
    // deciding that here would force one of them to be wrong.
    for (const locale of LOCALES) {
      expect(landNameOrNull(null, locale)).toBeNull()
      expect(landNameOrNull(undefined, locale)).toBeNull()
    }
  })

  test("a blank code is absent rather than an unnamed option", () => {
    // Returning "" would put an empty row in every state dropdown.
    expect(landNameOrNull("", "de")).toBeNull()
    expect(landNameOrNull("   ", "de")).toBeNull()
  })

  test("a present code is named, and trimmed on the way", () => {
    expect(landNameOrNull("NW", "en")).toBe("North Rhine-Westphalia")
    expect(landNameOrNull(" NW ", "en")).toBe("North Rhine-Westphalia")
  })
})

describe("locale parity", () => {
  test("every code has a non-empty name in every locale", () => {
    // The rule lib/i18n.test.ts applies to the dictionaries, applied here for
    // the same reason: this table is edited a row at a time, and a missing
    // English name would render as `undefined` rather than as a fallback.
    for (const code of LAND_CODES) {
      for (const locale of LOCALES) {
        const name = landNameFor(code, locale)
        expect(name.length, `${code}.${locale}`).toBeGreaterThan(0)
        expect(name, `${code}.${locale}`).not.toBe("undefined")
      }
    }
  })

  test("no locale silently falls back to the code", () => {
    // The sharp version of the check above: a row added with only a German
    // name would return the code for `en`, which looks deliberate — unknown
    // codes do exactly that — and is not. A known code must never render as
    // itself in either language.
    for (const code of LAND_CODES) {
      for (const locale of LOCALES) {
        expect(landNameFor(code, locale), `${code}.${locale}`).not.toBe(code)
      }
    }
  })

  test("both locales are covered by LOCALES, so adding one is caught here", () => {
    // Guards the loops above: if `LOCALES` were empty or single, every parity
    // assertion would pass while checking one language.
    expect([...LOCALES].sort()).toEqual(["de", "en"])
  })
})
