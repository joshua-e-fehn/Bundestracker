"use client"

import { animate, useReducedMotion } from "framer-motion"
import { useEffect, useRef } from "react"

/**
 * A figure that counts up to its value once, the first time it is read.
 *
 * The one piece of motion Concept C allows on the data itself — everything else
 * on app/home-c/page.tsx is a fade. A number arriving *as a number* is the whole
 * idea of the page: the claim sentence above it says what is being counted, and
 * the count then happens.
 *
 * ## The final value is in the DOM from the first render
 *
 * `children` is the formatted string the rest of the site would have shown, and
 * it is what is server-rendered, what a screen reader announces, and what a
 * reader with `prefers-reduced-motion` or without JavaScript sees. The animation
 * writes into `textContent` afterwards and always lands back on exactly that
 * string — the last frame is `formatValue(value)`, not a rounding of it, so the
 * digits cannot settle one apart from the markup.
 *
 * This is why the counting happens through a ref rather than through React
 * state. A `setState` per frame at 60 fps would re-render this component sixty
 * times a second and, more to the point, would make the *rendered* value the
 * animated one — which is the version that ships a half-counted number to a
 * crawler and announces a stream of intermediate values to a screen reader.
 * Writing to `textContent` keeps React's output the final value at all times and
 * treats the count as what it is: a decoration over settled content.
 *
 * ## No `aria-live`
 *
 * Deliberately, and §9 of the design research says so explicitly: the final
 * value is in the DOM and that is what gets read. Announcing a number that is
 * mid-count would read the same figure a dozen times.
 *
 * ## Reduced motion skips it entirely
 *
 * Not shortens — skips. There is nothing to fall back to because the finished
 * state is already what is rendered, which is the discipline app/globals.css
 * sets out at length for the hero crest: declare the destination, add the
 * arriving inside a no-preference guard.
 */

/** How long a figure takes to arrive. At the top of KERN's 200/300/500 ms
 * utility range rather than past it — a count that takes a second reads as a
 * slot machine, and the federal register for motion is fast and small. */
const COUNT_DURATION = 0.5

export function CountUpNumber({
  value,
  formatValue,
  start,
  children,
  className,
}: {
  /** The number to count to. */
  value: number
  /**
   * How to render an intermediate value — the same formatter the caller used
   * for `children`, so the digits never change shape mid-count. Takes the raw
   * number rather than a locale, because two of the home page's four figures
   * are floors and render a trailing `+` that no formatter argument would carry
   * (see `formatApproximateCount`).
   */
  formatValue: (value: number) => string
  /**
   * Whether the reader has arrived. Passed in rather than observed here: the
   * section around this figure is already being revealed by
   * `useRevealOnScroll`, and a second observer on the number itself would fire
   * at a different moment from the section it sits in.
   */
  start: boolean
  /** The finished figure, formatted. Rendered as-is until the count begins. */
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()
  // The count runs once per mounted figure. Without this, a value arriving from
  // Convex *after* the section was revealed — the normal case, since the
  // sections render skeletons first — would restart the count on every
  // subscription update.
  const counted = useRef(false)

  // The formatter is an inline closure at every call site, so it is a new
  // identity on every render of the parent. Held in a ref and read inside the
  // animation rather than closed over, which is what keeps it out of the
  // effect's dependencies without a suppression: an effect that listed it would
  // tear down and restart the count on each of those renders.
  //
  // It also happens to be the better behaviour. The closure captures the
  // locale, so a reader who flips the language toggle mid-count sees the
  // remaining frames in the new one rather than watching German separators
  // finish arriving under an English label.
  const formatRef = useRef(formatValue)
  formatRef.current = formatValue

  useEffect(() => {
    const element = ref.current
    if (element === null || !start || reduceMotion || counted.current) return
    // A zero counts to nothing, and an unresolved figure has nothing to count
    // to. Both render their final text unchanged rather than animating from 0
    // to 0, which would blank the digit for half a second.
    if (!Number.isFinite(value) || value <= 0) return

    counted.current = true

    const controls = animate(0, value, {
      duration: COUNT_DURATION,
      // KERN's entrance curve — the same one the reveals use. Decelerating, so
      // the figure lands rather than stops.
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        element.textContent = formatRef.current(latest)
      },
      onComplete: () => {
        // Back to React's own output, exactly. The last frame's string would be
        // the same text in every case this component is used, but "would be" is
        // not "is" — an imperative write left in place is a value React does not
        // know it owns, and the next re-render would silently correct it.
        element.textContent = null
      },
    })

    return () => controls.stop()
  }, [start, value, reduceMotion])

  // `tabular-nums` is not optional here. Proportional digits change width as
  // they cycle, so an un-tabular count visibly jitters and shifts everything
  // beside it — the one place on this page where motion would cause layout.
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  )
}
