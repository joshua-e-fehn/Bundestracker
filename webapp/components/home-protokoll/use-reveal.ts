"use client"

import { useReducedMotion } from "framer-motion"
import { useEffect, useRef, useState } from "react"

/**
 * Reveal-on-scroll, at the band where the eye actually is.
 *
 * One hook rather than a `whileInView` on every element, because three of the
 * four decisions below have to be the same everywhere on the page and the
 * fourth has to be *reversible* everywhere:
 *
 *  1. **The activation band is 40 % of the viewport**, not its edge. That
 *     number is measured from americabydesign.gov's own observer — its
 *     `rootMargin` is `-40vh 0 -40vh 0` — and it is the difference between text
 *     brightening as you arrive at it and text brightening a screenful early.
 *  2. **The reveal is a ratchet.** The observer disconnects on the first hit,
 *     so nothing un-reveals on scroll-up. A section that fades out when the
 *     reader scrolls back to re-read it is the single most irritating failure
 *     of this genre.
 *  3. **Anything the reader has already passed is revealed, not pending.** See
 *     below — this is the one that was wrong, and it did not merely skip an
 *     animation.
 *  4. **Reduced motion is the finished state, not a frozen first frame.**
 *     Returning `true` unconditionally under `prefers-reduced-motion` is what
 *     app/globals.css's hero rules do in CSS — declare the destination, add the
 *     arriving inside `no-preference` — and it is why this returns a boolean
 *     the caller applies rather than driving an animation itself.
 *
 * ## Why this is an observer and not framer-motion's `useInView`
 *
 * It was `useInView(ref, { once: true, margin: "0px 0px -40% 0px" })`, and that
 * hook cannot express #3. Its state flips only on an `isIntersecting` callback,
 * and an element that is *above* the viewport never intersects — so a reader who
 * reloads part-way down the page, or jumps to the end and scrolls back, leaves
 * every section above them permanently un-revealed.
 *
 * Every consumer on this page renders `revealed` into a framer-motion `animate`
 * prop whose unrevealed state is `opacity: 0`, so "un-revealed" is not a missing
 * flourish — it is **invisible content**. Measured on `/` against WP21 data,
 * reloading while scrolled past Chapter 2: the four headline figures stayed at
 * "0", "0", "0+" and "0" indefinitely, which is this codebase's least acceptable
 * failure — a confident wrong number — and the chapter's own heading never
 * arrived either.
 *
 * The two conditions below are what fix it, and they are the pair
 * lib/use-reveal-on-scroll.ts carried for the same reason before the concept it
 * served was deleted: a mount-time measurement for "already past on arrival",
 * and a `boundingClientRect.top <= 0` test in the callback for the scroll jump
 * large enough to carry an element from below the band to above the viewport
 * between two frames, which fires a callback that is no longer intersecting.
 *
 * `rootMargin` percentages resolve against the root's height, which for the
 * document root is the viewport — the same band the `margin` string expressed,
 * in the units `IntersectionObserver` takes natively.
 */

/**
 * How much of the viewport's bottom edge the band excludes: an element reveals
 * once its top crosses 60 % of the viewport height. Named rather than inlined
 * because the mount-time check and the observer's margin must describe the *same*
 * line — two spellings of one threshold is how an element comes to reveal on
 * arrival but not on reload, which is the bug this hook was rewritten for.
 */
const BAND = 0.4

const ROOT_MARGIN = `0px 0px -${BAND * 100}% 0px`

export function useReveal<T extends Element = HTMLElement>() {
  const ref = useRef<T>(null)
  const reduceMotion = useReducedMotion()
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    // The finished state is returned directly below, so there is nothing to
    // observe and no listener to leave behind.
    if (reduceMotion === true) return

    const element = ref.current
    if (element === null) return

    // Already at or above the band when this mounted — the top of the page, a
    // restored scroll position part-way down it, or a section the reader
    // scrolled past while its Convex query was still in flight. An observer
    // alone answers none of these: `IntersectionObserver` reports the *current*
    // state on its first callback, but an element wholly above the viewport is
    // not intersecting, so that callback says "no" and never says otherwise.
    if (element.getBoundingClientRect().top < window.innerHeight * (1 - BAND)) {
      setRevealed(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // The second half of the same guarantee — see the header. A wheel or a
        // fragment jump can move an element from below the band to above the
        // viewport between two frames, and the resulting callback carries
        // `isIntersecting: false` for an element the reader has now passed.
        if (entry.isIntersecting || entry.boundingClientRect.top <= 0) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { rootMargin: ROOT_MARGIN },
    )
    observer.observe(element)

    return () => observer.disconnect()
  }, [reduceMotion])

  // `reduceMotion` short-circuits in the *return* rather than through state, so
  // it is true on the very first render. Setting it in the effect above would
  // paint the offset frame once for exactly the reader who asked not to see it.
  return { ref, revealed: reduceMotion === true || revealed }
}

/**
 * The transition every reveal on this page uses.
 *
 * 0.5 s on `cubic-bezier(.16,1,.3,1)` — KERN's entrance curve, measured from
 * gov.de's own CSS. The federal register for motion is fast and small (its
 * overlay durations are 150 ms and its utilities top out at 500 ms), which is
 * why this is half a second and not the 1.2 s a parallax would take. A civic
 * data page may be calm; it may not be slow.
 *
 * Exported as an object rather than restated per component so the whole page
 * arrives at one speed. Twelve sections each choosing their own is how a
 * scroll-driven page comes to feel unfinished.
 */
export const REVEAL_TRANSITION = {
  duration: 0.5,
  ease: [0.16, 1, 0.3, 1],
} as const

/**
 * The offset a revealing element starts from.
 *
 * 16 px, and `transform` only — both compositable, so the reveal costs no
 * layout and no paint (app/globals.css states the rule; §8 of the research
 * restates it). Small on purpose: a section that travels 80 px is *watched*
 * arriving, and a page of watched arrivals reads as a slideshow rather than as
 * a document.
 */
export const REVEAL_OFFSET = 16
