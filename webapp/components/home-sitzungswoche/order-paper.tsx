"use client"

import { motion, useScroll, useTransform } from "framer-motion"

/**
 * The order paper drifting behind the page.
 *
 * A 2.5 rem grid at 3 % of the page's ink, translating at a tenth of the scroll
 * speed. It is the concept's one background element, and the brief for it is
 * "very subtle, professional" — at this opacity it reads as laid paper under the
 * text rather than as a grid over it.
 *
 * ## Why the drift is a `MotionValue` and not a scroll handler
 *
 * `useScroll` hands framer-motion a value it writes straight to the element,
 * bypassing React entirely — no re-render per frame, and on Chrome 115+ and
 * Safari 26+ it attaches to the browser's native `ScrollTimeline` and runs off
 * the main thread. §5 of the design research measured that path in the bundle
 * (`supportsScrollTimeline` → `attachTimeline`) and it is the whole argument for
 * using framer-motion here rather than a `scroll` listener: one API, the
 * off-main-thread path where it exists, and a rAF fallback on Firefox.
 *
 * ## Why it is bound to `scrollY` and not to a target's progress
 *
 * `scrollYProgress` against this element would need the element's height, and
 * this element is `fixed` — it has no scroll extent of its own. More to the
 * point, §8 warns against caching offsets at mount on a page whose sections
 * change height when their queries land. Absolute `scrollY` has neither problem:
 * it is a number of pixels, it is correct before any data arrives, and it stays
 * correct when a section grows underneath it.
 *
 * The 0.1 factor is applied to raw pixels, so the parallax is uniform down the
 * page rather than compressing as the document gets taller. `SCROLL_SPAN` only
 * bounds how far the texture travels before it stops — the grid tiles, so a
 * bounded drift is indistinguishable from an unbounded one and cannot walk the
 * pattern somewhere that shows a seam.
 *
 * ## Fixed, `aria-hidden`, and behind everything
 *
 * It carries no information, so it is invisible to assistive tech
 * (`hero-animation.tsx` makes the same call for the crest). `fixed` rather than
 * `absolute` so it costs nothing to lay out and cannot extend the document; and
 * `-z-10` with `pointer-events-none` so it can never sit between the reader and
 * a link.
 */

/** How far down the page the drift keeps accumulating, in pixels. Past this the
 * texture holds still, which nobody can see — the pattern tiles every 2.5 rem,
 * so the last frame and the first are the same picture. */
const SCROLL_SPAN = 4000

/** How far the texture travels over that span. A tenth of the scroll distance
 * is the concept's own figure, and at 2.5 rem tiles it is about ten tiles of
 * movement over four viewport heights — felt, not watched. */
const DRIFT_PX = SCROLL_SPAN * 0.1

export function OrderPaper() {
  const { scrollY } = useScroll()
  const drift = useTransform(scrollY, [0, SCROLL_SPAN], [0, DRIFT_PX], { clamp: true })

  return (
    <motion.div
      aria-hidden
      className="sitzung-paper -z-10 pointer-events-none fixed inset-0"
      // The custom property rather than `style={{ y: drift }}`: the base rule in
      // app/globals.css already declares the transform in terms of
      // `--sitzung-paper-drift`, defaulted to 0, so the texture is correct
      // before this component mounts and correct if it never does. Writing `y`
      // directly would leave the no-JavaScript case with no transform at all —
      // which happens to look identical here, and would stop being true the
      // moment the base rule gained a second transform.
      style={{ "--sitzung-paper-drift": drift } as React.CSSProperties}
    />
  )
}
