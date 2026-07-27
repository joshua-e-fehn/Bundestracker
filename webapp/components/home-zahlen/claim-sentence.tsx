"use client"

import { Fragment, useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"
import { useRevealOnScroll } from "@/lib/use-reveal-on-scroll"
import { cn } from "@/lib/utils"

/**
 * The large sentence that opens each chapter, brightening word by word as the
 * reader arrives.
 *
 * The narrative spine of app/home-c/page.tsx and the page's only real effect.
 * The mechanic is americabydesign.gov's, verified from its shipped bundle
 * during the design research: every word is its own span, dimmed at rest,
 * transitioning to full colour over ~0.7 s as the reader reaches it.
 *
 * Two things are deliberately *not* copied from it:
 *
 *  - **It runs on five sentences, not on all prose.** americabydesign ships 290
 *    word spans, each with `will-change: color`. That is a real memory cost for
 *    an effect nobody is looking at, and §8 of the research says to scope it.
 *    Five claim sentences is ~60 spans, and no `will-change` — a `color`
 *    transition repaints but does not reflow, and the browser does not need to
 *    be warned about sixty of them.
 *  - **There is no bottom-of-document catch-up.** It needs one because its
 *    activation band is symmetric, so anything near the end of the page never
 *    reaches the middle of the viewport and stays permanently dim.
 *    `useRevealOnScroll` uses a band open at the top instead, which has no such
 *    tail — see the note there.
 *
 * ## One observer, not one per word
 *
 * americabydesign observes every word individually. This observes the sentence
 * and staggers the words off a CSS `transition-delay`, which is the same picture
 * for one observer instead of sixty and, more usefully, guarantees the words
 * light in reading order. Sixty independent observers on one line of text all
 * fire in the same callback batch, so their order is the browser's rather than
 * the sentence's.
 *
 * ## The text is not chopped up for a screen reader
 *
 * The spaces between words are real text nodes *outside* the spans, not padding
 * or margins. A screen reader concatenates a paragraph's text content, so this
 * reads as one sentence exactly as though the spans were not there — where
 * spans separated by CSS spacing can be announced as individual words. That is
 * why the split below keeps whitespace as its own element rather than folding it
 * into the word.
 *
 * ## Reduced motion, no JavaScript, and the finished state
 *
 * All of it is handled in CSS, and none of it here. The base rule is full
 * colour; the dimming lives entirely behind `[data-lit="hidden"]` inside a
 * `prefers-reduced-motion: no-preference` guard (app/globals.css), and
 * `data-lit` is absent until the hook has run. So a reader with reduced motion,
 * or with JavaScript off, gets the finished sentence rather than a permanently
 * dim one — without this component knowing anything about either.
 *
 * ⚠ The words are therefore split **unconditionally**, and that is deliberate
 * rather than lazy. Skipping the split under `useReducedMotion` was the first
 * version and is a hydration bug: the hook returns `null` on the server and a
 * real boolean on the client, so the server would render sixty spans and a
 * reduced-motion browser would hydrate a bare string over them. React reports a
 * mismatch and re-renders the subtree, on the page where the mismatch is most
 * visible.
 *
 * What that costs is ~60 inert spans for readers who will never see them
 * animate. That is the budget §3 of the design research sets anyway ("scope it
 * to one or two hero sentences" — 60 spans, not americabydesign.gov's 290), and
 * they carry no `will-change`, so an unanimated span is a span. Correct
 * hydration is worth more than sixty nodes.
 */

/** How long one word takes to brighten. americabydesign's measured 0.7 s — long
 * enough to be a wash rather than a blink, and this is the one property on the
 * page allowed to be non-compositable (see §8 of the research). */
const WORD_DURATION = 0.7

/**
 * Between one word and the next. 45 ms over a twelve-word sentence is ~0.5 s
 * from first word to last, which is about the time it takes to read one — so
 * the brightening travels with the eye rather than ahead of or behind it.
 */
const WORD_STAGGER = 0.045

/**
 * One piece of a split sentence: either a word, numbered in reading order, or
 * the whitespace between two of them.
 */
export type SentencePart = { text: string; wordIndex: number | null }

/**
 * Splits on whitespace, keeping the whitespace, and numbers the words.
 *
 * The capture group in the pattern is what keeps the separators in the output,
 * so the sentence can be reassembled exactly — including the non-breaking
 * spaces German typography uses before units and the em dashes this copy is
 * fond of. Reassembling from `" "` would quietly normalise all of that.
 *
 * The word number is counted here rather than taken from the array index,
 * because the array alternates words and gaps: an index-based delay would
 * stagger at half the cadence `WORD_STAGGER` names, which is the sort of
 * constant that then gets "corrected" to the wrong value later.
 *
 * Exported for the test beside this file. It is the one piece of this component
 * that is logic rather than markup, and every way it can be wrong is invisible
 * in review — see the header of claim-sentence.test.ts.
 */
export function splitWords(sentence: string): SentencePart[] {
  let wordIndex = 0
  return sentence
    .split(/(\s+)/)
    .filter((part) => part.length > 0)
    .map((text) =>
      /^\s+$/.test(text) ? { text, wordIndex: null } : { text, wordIndex: wordIndex++ },
    )
}

export function ClaimSentence({
  sentenceKey,
  className,
  id,
}: {
  sentenceKey: TranslationKey
  className?: string
  /** For the `aria-labelledby` of the section this sentence opens. */
  id?: string
}) {
  const { t } = useLocale()
  const { ref, reveal } = useRevealOnScroll<HTMLParagraphElement>()

  const sentence = t(sentenceKey)
  // Re-split when the language changes, which is the case a memo on the key
  // alone would miss — the toggle swaps the text under a stable key.
  const parts = useMemo(() => splitWords(sentence), [sentence])

  return (
    // `text-pretty` rather than `text-balance`: these run to two or three lines
    // at this size, and balancing evens the line lengths of a heading where
    // pretty only prevents an orphan — which is the failure a 30-word sentence
    // actually has.
    <p
      ref={ref}
      id={id}
      data-lit={reveal}
      className={cn(
        "text-pretty font-medium text-2xl leading-snug tracking-tight sm:text-3xl sm:leading-snug",
        className,
      )}
    >
      {parts.map((part, index) =>
        // Whitespace stays a bare text node, outside any span — see the
        // screen-reader note in the header.
        part.wordIndex === null ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the split is positional; a word can repeat within a sentence
          <Fragment key={index}>{part.text}</Fragment>
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            key={index}
            className="claim-word"
            style={{
              transitionDuration: `${WORD_DURATION}s`,
              transitionDelay: `${part.wordIndex * WORD_STAGGER}s`,
            }}
          >
            {part.text}
          </span>
        ),
      )}
    </p>
  )
}
