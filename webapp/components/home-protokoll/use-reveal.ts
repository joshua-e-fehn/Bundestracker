"use client"

import { useInView, useReducedMotion } from "framer-motion"
import { useRef } from "react"

/**
 * Reveal-on-scroll, at the band where the eye actually is.
 *
 * One hook rather than a `whileInView` on every element, because two of the
 * three decisions below have to be the same everywhere on the page and the
 * third has to be *reversible* everywhere:
 *
 *  1. **The activation band is 40 % of the viewport**, not its edge. That
 *     number is measured from americabydesign.gov's own observer — its
 *     `rootMargin` is `-40vh 0 -40vh 0` — and it is the difference between text
 *     brightening as you arrive at it and text brightening a screenful early.
 *  2. **The reveal is a ratchet.** `once: true`, so nothing un-reveals on
 *     scroll-up. A section that fades out when the reader scrolls back to
 *     re-read it is the single most irritating failure of this genre.
 *  3. **Reduced motion is the finished state, not a frozen first frame.**
 *     Returning `true` unconditionally under `prefers-reduced-motion` is what
 *     app/globals.css's hero rules do in CSS — declare the destination, add the
 *     arriving inside `no-preference` — and it is why this returns a boolean
 *     the caller applies rather than driving an animation itself.
 *
 * ## Why the caller does not need a fallback for "never observed"
 *
 * `useInView` starts `false` and flips on intersection, so a section below the
 * fold is hidden until scrolled to — correct. The one case that would not
 * resolve is a section that never intersects because the document is shorter
 * than the reveal band, which cannot happen here: the band is inset from both
 * edges, so an element on screen at rest is already inside it.
 *
 * The `margin` string is a `MarginType` from framer-motion, which admits only
 * `px` and `%` — not `vh`. Percent of what the observer measures against is the
 * root's height, which for the document root *is* the viewport, so `-40%` is
 * the same band expressed in the units the type allows.
 */
export function useReveal<T extends Element = HTMLElement>() {
  const ref = useRef<T>(null)
  const reduceMotion = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: "0px 0px -40% 0px" })

  return { ref, revealed: reduceMotion === true || inView }
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
