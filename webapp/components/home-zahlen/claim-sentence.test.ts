import { describe, expect, test } from "bun:test"
import { splitWords } from "./claim-sentence"
import { dictionaries, LOCALES } from "@/lib/i18n"

/**
 * Tests for the claim sentence's word split.
 *
 * The only logic in a component that is otherwise markup, and worth testing on
 * its own because all three of its failure modes are silent — none throws, and
 * the component renders something plausible in every case:
 *
 *  - **Losing a separator.** The sentence still renders, with two words run
 *    together or a line break in the wrong place. German copy here uses
 *    non-breaking spaces and em dashes, and a naive `split(" ")` normalises
 *    them away without complaint.
 *  - **Numbering from the array index rather than counting words.** The array
 *    alternates words and gaps, so the stagger runs at half the cadence
 *    `WORD_STAGGER` states. It still looks like a stagger — just the wrong one
 *    — which is exactly the kind of thing a later reader "fixes" by changing
 *    the constant.
 *  - **Emitting an empty part.** An empty span with a transition delay is
 *    invisible and shifts every word after it by one step.
 *
 * The rendering is deliberately not tested, matching hero-animation.test.ts:
 * there is no DOM in `bun test` here, and what would be asserted is class names
 * and CSS custom properties, which restates the source rather than checking it.
 * The brightening has to be looked at, and the reduced-motion path is a media
 * query the browser resolves.
 */

/** Rebuilding the sentence from the parts must give back the input, exactly.
 * The single property that matters most: whatever the split does internally, the
 * reader must see the sentence that was written. */
function rejoin(sentence: string): string {
  return splitWords(sentence)
    .map((part) => part.text)
    .join("")
}

describe("splitWords", () => {
  test("separates words from the whitespace between them", () => {
    expect(splitWords("Vier Zahlen")).toEqual([
      { text: "Vier", wordIndex: 0 },
      { text: " ", wordIndex: null },
      { text: "Zahlen", wordIndex: 1 },
    ])
  })

  test("numbers words consecutively, ignoring the gaps", () => {
    const words = splitWords("eins zwei drei vier").filter((part) => part.wordIndex !== null)
    expect(words.map((part) => part.wordIndex)).toEqual([0, 1, 2, 3])
  })

  test("never emits an empty part", () => {
    // Leading and trailing whitespace are what `split` turns into empty strings
    // at the ends of the array — the case the `.filter` exists for.
    for (const sentence of ["  padded  ", "\n\nZeilen\n", " ", ""]) {
      for (const part of splitWords(sentence)) {
        expect(part.text.length).toBeGreaterThan(0)
      }
    }
  })

  test("an empty sentence produces no parts", () => {
    expect(splitWords("")).toEqual([])
  })

  test("keeps punctuation attached to its word", () => {
    // Splitting on punctuation as well would brighten "Bundestages" and "."
    // separately, which reads as a full stop arriving late.
    const parts = splitWords("Bundestages. Was")
    expect(parts[0]).toEqual({ text: "Bundestages.", wordIndex: 0 })
  })

  test("an em dash set off by spaces is its own word", () => {
    // Deliberate: this copy uses spaced em dashes as a clause break, and a dash
    // that brightened together with the word before it would lag half a beat
    // behind the clause it opens.
    expect(splitWords("Untergrenzen — wo").map((part) => part.text)).toEqual([
      "Untergrenzen",
      " ",
      "—",
      " ",
      "wo",
    ])
  })

  test("preserves a non-breaking space rather than normalising it", () => {
    // German typography puts one before a unit, and it is the character that
    // stops "630 Sitze" breaking across a line. `\s` matches it, so it lands in
    // a separator part — and must come back out unchanged.
    const sentence = "630 Sitze"
    expect(rejoin(sentence)).toBe(sentence)
    expect(splitWords(sentence)[1].text).toBe(" ")
  })

  test("rejoining every shipped claim sentence returns it unchanged", () => {
    // The property that matters, checked against the real copy in both
    // languages rather than against a fixture — these are the exact strings the
    // page splits, and they are where an unusual character will actually appear.
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        if (!key.startsWith("homeC.claim")) continue
        expect(rejoin(value), `${locale}.${key}`).toBe(value)
      }
    }
  })

  test("the five claim sentences exist in both locales and are short enough to read", () => {
    // The stagger is `WORD_STAGGER` per word, so a sentence's length is also its
    // duration: at 45 ms, 40 words would take 1.8 s to finish brightening, which
    // is past the reader rather than with them. This is the guard on copy
    // growing until the effect stops tracking the eye.
    for (const locale of LOCALES) {
      const claims = Object.entries(dictionaries[locale]).filter(([key]) =>
        key.startsWith("homeC.claim"),
      )
      expect(claims.length, locale).toBe(5)
      for (const [key, value] of claims) {
        const words = splitWords(value).filter((part) => part.wordIndex !== null)
        expect(words.length, `${locale}.${key}`).toBeLessThanOrEqual(32)
      }
    }
  })
})
