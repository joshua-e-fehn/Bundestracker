import { describe, expect, test } from "bun:test"
import { dictionaries } from "./i18n"
import { isSeatingColorMode, seatingMode } from "./seating"
import {
  chapterAnchor,
  chapterCaveatKeys,
  SITZUNGSWOCHE_CHAPTERS,
  SKIP_TO_DATA_CHAPTER,
} from "./sitzungswoche"

/**
 * Tests for the narrative spine of /home-b.
 *
 * The failures this catches are the ones a browser would not report. A chapter
 * naming a colour mode that does not exist renders an uncoloured chamber rather
 * than throwing; a caveat key that is not in the dictionary prints its own key
 * onto the page; a skip link pointing at an unrendered anchor does nothing at
 * all, and does nothing for exactly the reader it exists for. None of these is
 * visible in review and none is a type error, because every one of them is a
 * string that is well-formed and wrong.
 */

describe("SITZUNGSWOCHE_CHAPTERS", () => {
  test("colours the chamber with a mode the map can actually paint", () => {
    // `satisfies` constrains these to `SeatingColorMode` at compile time; this
    // states the same thing against the runtime table, which is what
    // `seatColor` and the legend both switch on. A mode removed from
    // lib/seating.ts would leave the typecheck green only until the union
    // narrowed, and would leave the chamber unstyled at runtime.
    for (const chapter of SITZUNGSWOCHE_CHAPTERS) {
      expect(isSeatingColorMode(chapter.mode)).toBe(true)
      expect(seatingMode(chapter.mode)).toBeDefined()
    }
  })

  test("every string is in both dictionaries", () => {
    // `TranslationKey` already forbids a misspelling, but it cannot see that a
    // chapter's key was pointed at a *different* real key — and the German
    // dictionary is the schema, so a key present in `de` and missing from `en`
    // is a typecheck failure elsewhere and a silent German sentence here.
    for (const chapter of SITZUNGSWOCHE_CHAPTERS) {
      for (const key of [chapter.titleKey, chapter.leadKey, chapter.bodyKey]) {
        expect(dictionaries.de[key]).toBeTruthy()
        expect(dictionaries.en[key]).toBeTruthy()
        // And the two are actually different sentences rather than the German
        // pasted into `en` — the one way a bilingual page fails while passing
        // every structural check. Proper nouns would legitimately match, but
        // none of these keys is one.
        expect(dictionaries.en[key]).not.toBe(dictionaries.de[key])
      }
    }
  })

  test("carries a caveat on exactly the chapters whose picture could mislead", () => {
    // The seat positions are invented (§9), a named ballot is the exception
    // rather than the rule (§4.4), and a low activity score means "little
    // recorded" rather than "little done". The other two chapters inherit their
    // colour mode's caveat instead — see `chapterCaveatKeys`.
    const withOwn = SITZUNGSWOCHE_CHAPTERS.filter((chapter) => chapter.caveatKey !== undefined).map(
      (chapter) => chapter.id,
    )
    expect([...withOwn].sort()).toEqual(["arrival", "ballot", "record"])
  })

  test("no chapter is prose alone", () => {
    // The promise §7 of the research says is most likely to be quietly lost:
    // the narrative adds sentences around the dashboard, it does not replace a
    // section with a paragraph. A chapter with no `dataSection` is one that
    // turned a table into an anecdote.
    for (const chapter of SITZUNGSWOCHE_CHAPTERS) {
      expect(chapter.dataSection).toBeTruthy()
    }
    // And each section appears once: two chapters pointing at the same data
    // would render it twice on one page.
    const sections = SITZUNGSWOCHE_CHAPTERS.map((chapter) => chapter.dataSection)
    expect(new Set(sections).size).toBe(sections.length)
  })

  test("ids are unique and anchor-safe", () => {
    // The ids become DOM ids and URL fragments. A duplicate makes the skip link
    // ambiguous; a space or an umlaut makes the fragment unusable.
    const ids = SITZUNGSWOCHE_CHAPTERS.map((chapter) => chapter.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  test("the chamber is pinned for a bounded number of chapters", () => {
    // The concept pins the hemicycle for roughly three viewport heights, and a
    // long pin is exactly what makes a dashboard reader feel trapped. The pin
    // lasts as long as this list, so its length is the control — this is the
    // assertion that fails if someone adds a sixth chapter without revisiting
    // whether the arc should still be sticky through it.
    expect(SITZUNGSWOCHE_CHAPTERS.length).toBeLessThanOrEqual(5)
    expect(SITZUNGSWOCHE_CHAPTERS.length).toBeGreaterThanOrEqual(3)
  })
})

describe("chapterCaveatKeys", () => {
  test("merges the chapter's own caveat with its mode's", () => {
    const ballot = SITZUNGSWOCHE_CHAPTERS.find((chapter) => chapter.id === "ballot")
    if (ballot === undefined) throw new Error("the ballot chapter should exist")
    // Attendance carries §4.4's warning as a *mode*; the chapter adds the
    // named-vote note. Both are owed and neither is a restatement of the other.
    const keys = chapterCaveatKeys(ballot, seatingMode(ballot.mode)?.caveatKey)
    expect(keys).toContain("home.statNamedVotesNote")
    expect(keys).toContain("seating.attendanceCaveat")
  })

  test("a chapter whose mode carries nothing shows only its own", () => {
    const arrival = SITZUNGSWOCHE_CHAPTERS.find((chapter) => chapter.id === "arrival")
    if (arrival === undefined) throw new Error("the arrival chapter should exist")
    expect(seatingMode(arrival.mode)?.caveatKey).toBeUndefined()
    expect(chapterCaveatKeys(arrival, undefined)).toEqual(["seating.syntheticNotice"])
  })

  test("a chapter with no caveat of its own still inherits its mode's", () => {
    const tabled = SITZUNGSWOCHE_CHAPTERS.find((chapter) => chapter.id === "tabled")
    if (tabled === undefined) throw new Error("the tabled chapter should exist")
    // Who governs is in no Bundestag dataset, so the coalition colouring owes a
    // warning even though the chapter itself declares none.
    expect(chapterCaveatKeys(tabled, seatingMode(tabled.mode)?.caveatKey)).toEqual([
      "seating.coalitionCaveat",
    ])
  })

  test("does not show one caveat twice", () => {
    const record = SITZUNGSWOCHE_CHAPTERS.find((chapter) => chapter.id === "record")
    if (record === undefined) throw new Error("the record chapter should exist")
    // Nothing collides today; this is the guard for the day a chapter's key and
    // its mode's coincide, where two identical boxes would read as a fault.
    expect(chapterCaveatKeys(record, "home.bottomMPsCaveat")).toEqual(["home.bottomMPsCaveat"])
  })

  test("every caveat it can produce is a real bilingual string", () => {
    for (const chapter of SITZUNGSWOCHE_CHAPTERS) {
      for (const key of chapterCaveatKeys(chapter, seatingMode(chapter.mode)?.caveatKey)) {
        expect(dictionaries.de[key]).toBeTruthy()
        expect(dictionaries.en[key]).toBeTruthy()
      }
    }
  })
})

describe("the skip affordance", () => {
  test("points at a chapter that exists", () => {
    // A skip link whose target is not rendered fails silently, and it fails for
    // the returning reader it was written for — §7 of the research calls this
    // the requirement most likely to be quietly lost.
    const ids = SITZUNGSWOCHE_CHAPTERS.map((chapter) => chapter.id)
    expect(ids).toContain(SKIP_TO_DATA_CHAPTER)
  })

  test("skips past the opening narrative rather than to the top", () => {
    // Landing on chapter one is a link that appears to do nothing. The target
    // must be a later chapter, and one that carries data.
    const index = SITZUNGSWOCHE_CHAPTERS.findIndex((chapter) => chapter.id === SKIP_TO_DATA_CHAPTER)
    expect(index).toBeGreaterThan(0)
    expect(SITZUNGSWOCHE_CHAPTERS[index].dataSection).toBeTruthy()
  })

  test("the anchor is derived once for both the id and the href", () => {
    // The failure mode is a mismatch nobody sees: the section renders one
    // string as its `id` and the link points at another.
    expect(chapterAnchor(SKIP_TO_DATA_CHAPTER)).toBe(`kapitel-${SKIP_TO_DATA_CHAPTER}`)
    for (const chapter of SITZUNGSWOCHE_CHAPTERS) {
      expect(chapterAnchor(chapter.id)).toMatch(/^[a-z][a-z0-9-]*$/)
    }
    const anchors = SITZUNGSWOCHE_CHAPTERS.map((chapter) => chapterAnchor(chapter.id))
    expect(new Set(anchors).size).toBe(anchors.length)
  })
})
