"use client"

import { useIsomorphicLayoutEffect } from "framer-motion"
import { useRef, useState } from "react"

/**
 * Whether an element has been scrolled into the reading band yet.
 *
 * Drives the narrative home page (app/home-c/page.tsx): the chapter reveals,
 * the word-by-word brightening of the claim sentences, and the trigger for the
 * count-up figures. One primitive for all three, because they answer the same
 * question — *has the reader arrived here* — and three observers written three
 * times is how the three come to disagree about where "here" is.
 *
 * ## The three states, and why `undefined` is one of them
 *
 * `undefined` means **JavaScript has not decided yet**: the server render, and
 * the first client render before hydration commits. It is deliberately not
 * `"hidden"`, and that is the whole reason this hook exists rather than
 * `useInView` from framer-motion.
 *
 * Every consumer renders the state straight into a `data-` attribute, and the
 * CSS in app/globals.css only hides an element for `[data-reveal="hidden"]`. So
 * markup that reaches a browser without this hook ever running — SSR HTML with
 * failed or disabled JavaScript — carries no attribute and is simply *visible*.
 * A hook that starts at `false` would ship `hidden` in the server HTML and turn
 * a JS failure into a blank page. The home page is `"use client"` but Next still
 * server-renders it, so that HTML is real and is what a crawler reads.
 *
 * ## Why not framer-motion's `useInView`
 *
 * It is the same idea and it is used elsewhere in this project's motion work,
 * but it sets its state from a `useEffect` — after paint — and starts at
 * `false`. Both are wrong here for the reason above: the first paint would show
 * finished content, the effect would then hide it, and the observer's first
 * callback (which is asynchronous) would show it again. That is a visible flash
 * on every above-the-fold element, and no option on `useInView` removes it.
 * This hook decides in a *layout* effect, before the browser paints, so the
 * hidden state is the first thing painted and the reveal is an entrance rather
 * than a correction. framer-motion still does the work it is good at — see
 * `CountUpNumber`, which drives its rAF loop through `animate`.
 *
 * ## Why the band is asymmetric
 *
 * americabydesign.gov — the reference this effect comes from — activates on a
 * symmetric 40 %-of-viewport band (`-40% 0px -40% 0px`), so text lights up in
 * the middle of the screen where the eye is, and then needs a
 * bottom-of-document catch-up because anything near the end of the page never
 * reaches the middle: once the document is scrolled to its end, the last
 * section sits *above* the band forever and stays dim.
 *
 * A band open at the top has no such tail. `0px 0px -35% 0px` fires when an
 * element's top crosses 65 % of the viewport — still comfortably inside the
 * reading area rather than at the very edge — and everything the reader has
 * scrolled past has necessarily crossed it. One rule, no catch-up, nothing that
 * can be left permanently dim.
 *
 * ## Monotonic by construction
 *
 * The observer disconnects on the first hit, so nothing ever un-reveals on
 * scroll-up. americabydesign implements the same guarantee as a
 * `Math.max(previous, index)` ratchet over its word list; disconnecting is the
 * cheaper spelling of it.
 */

/** How much of the viewport bottom the band excludes. 0.35 → the trigger line
 * sits at 65 % of the viewport height. */
const BAND = 0.35

const ROOT_MARGIN = `0px 0px -${BAND * 100}% 0px`

/**
 * `undefined` before JavaScript has decided — see the header. `"hidden"` and
 * `"shown"` are written straight into `data-reveal` / `data-lit`, so the CSS
 * can distinguish "not yet decided" from "decided: not yet arrived".
 */
export type RevealState = undefined | "hidden" | "shown"

export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [reveal, setReveal] = useState<RevealState>(undefined)

  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (element === null) return

    // Before the first paint of this commit, so the hidden state is what the
    // browser draws rather than something it draws over.
    setReveal("hidden")

    let frame = 0
    const show = () => {
      setReveal("shown")
    }

    // Already in the band at mount — the top of the page, or a restored scroll
    // position part-way down it.
    //
    // Still revealed on the *next* frame rather than immediately: a CSS
    // transition needs its start value to have been painted, and setting
    // "hidden" and "shown" in one commit collapses them into a single style
    // recalculation, so the element would snap to its finished state with no
    // entrance at all. One frame of the hidden state is what makes the fade a
    // fade — and it is one frame, which is why this is not the flash the
    // header describes.
    if (element.getBoundingClientRect().top < window.innerHeight * (1 - BAND)) {
      frame = requestAnimationFrame(show)
      return () => cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // `boundingClientRect.top <= 0` is the belt to the braces: a scroll
        // jump large enough to carry an element from below the band to above
        // the viewport in one step can produce a callback that no longer
        // intersects, and without this the element would stay hidden after the
        // reader has scrolled past it.
        if (entry.isIntersecting || entry.boundingClientRect.top <= 0) {
          show()
          observer.disconnect()
        }
      },
      { rootMargin: ROOT_MARGIN },
    )
    observer.observe(element)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return { ref, reveal, shown: reveal === "shown" }
}
