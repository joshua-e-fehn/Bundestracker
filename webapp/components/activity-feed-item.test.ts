import { describe, expect, test } from "bun:test"
import { type FeedEvent, referenceHref } from "./activity-feed-item"

/**
 * Tests for the feed's reference link.
 *
 * Worth testing on its own because nothing else can catch it being wrong. The
 * padding rules in §8 of docs/api-research.md turn `21/7327` into
 * `btd/21/073/2107327.pdf`; an off-by-one in either pad produces a URL that is
 * the right shape, the right length and entirely plausible — and 404s. The
 * typecheck sees a string either way, and a reviewer reading the arithmetic has
 * to do the division in their head.
 *
 * The helper still builds a whole `FeedEvent` even though `referenceHref` now
 * takes only the reference pair: the point of these cases is that a *real* feed
 * row produces the right URL, and narrowing the fixture to the two fields under
 * test would stop catching a caller that passes the wrong ones.
 */

function event(overrides: Partial<FeedEvent>): FeedEvent {
  return {
    id: "e1",
    mpInternalId: "bt-0001",
    eventType: "motion",
    date: "2026-07-10",
    title: "Antrag",
    description: null,
    referenceId: null,
    referenceType: null,
    name: "Beispiel Abgeordnete",
    fraktion: "SPD",
    photoUrl: null,
    ...overrides,
  }
}

describe("referenceHref — Drucksachen", () => {
  test("reproduces the worked example from §8", () => {
    // The one example the research spells out end to end: 21/7327 →
    // btd/21/073/2107327.pdf. Block is 7327 ÷ 100 = 73, padded to 073; the
    // paper is 21 followed by 7327 padded to five digits.
    expect(referenceHref(event({ referenceType: "drucksache", referenceId: "21/7327" }))).toBe(
      "https://dserver.bundestag.de/btd/21/073/2107327.pdf",
    )
  })

  test("pads a low paper number in both places", () => {
    // The case where both pads matter at once: block 0, number 1.
    expect(referenceHref(event({ referenceType: "drucksache", referenceId: "21/1" }))).toBe(
      "https://dserver.bundestag.de/btd/21/000/2100001.pdf",
    )
  })

  test("a block boundary lands in the right directory", () => {
    // 99 and 100 are the numbers an off-by-one in the division separates.
    expect(referenceHref(event({ referenceType: "drucksache", referenceId: "21/99" }))).toBe(
      "https://dserver.bundestag.de/btd/21/000/2100099.pdf",
    )
    expect(referenceHref(event({ referenceType: "drucksache", referenceId: "21/100" }))).toBe(
      "https://dserver.bundestag.de/btd/21/001/2100100.pdf",
    )
  })

  test("rejects a Bundesrat-style bare number instead of misparsing it", () => {
    // §5.1's warning: Bundesrat numbering is a bare running number, and a
    // split("/") on one yields a plausible wrong URL rather than an error.
    expect(referenceHref(event({ referenceType: "drucksache", referenceId: "1067" }))).toBeNull()
  })

  test("rejects anything that is not two runs of digits", () => {
    for (const id of ["21/", "/7327", "21/73a7", "21/73/27", "", "  "]) {
      expect(referenceHref(event({ referenceType: "drucksache", referenceId: id })), id).toBeNull()
    }
  })
})

describe("referenceHref — protocols", () => {
  test("reproduces the protocol example from §5.1", () => {
    // 21/90 → btp/21/21090.pdf, the form verified against all 86 WP21 records.
    expect(referenceHref(event({ referenceType: "plenarprotokoll", referenceId: "21/90" }))).toBe(
      "https://dserver.bundestag.de/btp/21/21090.pdf",
    )
  })

  test("pads the sitting number to three digits", () => {
    expect(referenceHref(event({ referenceType: "plenarprotokoll", referenceId: "21/5" }))).toBe(
      "https://dserver.bundestag.de/btp/21/21005.pdf",
    )
    expect(referenceHref(event({ referenceType: "plenarprotokoll", referenceId: "21/123" }))).toBe(
      "https://dserver.bundestag.de/btp/21/21123.pdf",
    )
  })
})

describe("referenceHref — no link", () => {
  test("an event with no source row has no reference", () => {
    expect(referenceHref(event({ referenceType: "drucksache", referenceId: null }))).toBeNull()
  })

  test("id spaces naming a row rather than a document produce no link", () => {
    // A Convex id and a DIP activity id both identify a row. There is no public
    // URL for either, and inventing one would 404.
    for (const type of ["motions", "voteSheets", "aktivitaet", "vorgang", null]) {
      expect(
        referenceHref(event({ referenceType: type, referenceId: "12345" })),
        String(type),
      ).toBeNull()
    }
  })

  test("every produced URL is on the Bundestag document server", () => {
    // The link leaves the app, so where it goes is a claim about provenance.
    for (const [type, id] of [
      ["drucksache", "21/7327"],
      ["plenarprotokoll", "21/90"],
    ] as const) {
      const href = referenceHref(event({ referenceType: type, referenceId: id }))
      expect(href).not.toBeNull()
      expect(href?.startsWith("https://dserver.bundestag.de/")).toBe(true)
    }
  })
})
