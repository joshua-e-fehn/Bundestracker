"use client"

import { animate, useReducedMotion } from "framer-motion"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { formatApproximateCount } from "@/lib/format"
import { useReveal } from "./use-reveal"

/**
 * A figure that counts up to its value when the reader reaches it.
 *
 * ## Why the final value is always in the DOM
 *
 * §9: no `aria-live` on a count-up. The number a screen reader announces is
 * whatever is in the element when it reaches it, and that is the *final* value
 * here in every path that matters — reduced motion renders it outright, and
 * the animation is a visual sweetener over a figure that was already correct.
 * A live region would announce sixty intermediate numbers and none of them
 * would be the answer.
 *
 * ## Why it does not animate the string
 *
 * The digits are formatted per locale (`1.234` in German, `1,234` in English)
 * and two of the home page's four figures are *bounded* rather than exact —
 * `convex/stats.ts` returns `{count, exact}` and an inexact one renders as
 * `5.000+`. So the animation runs over the number and the formatting runs after
 * it, through the same `formatApproximateCount` the current home page uses.
 * Animating the rendered string instead would either drop the `+` mid-count or
 * put a thousands separator in the wrong place at every intermediate value.
 *
 * ## Why `animate()` and not a `MotionValue` in the DOM
 *
 * Framer Motion can render a `MotionValue` as a child, but only its *initial*
 * value — subsequent updates are pushed to the DOM node directly, bypassing
 * React, and there is no hook there to run `formatApproximateCount` on the way.
 * A subscription into `useState` re-renders one small element at 60 fps, which
 * for four numbers is nothing.
 */
export function CountUp({
  value,
  exact,
  /** Seconds to wait after the reveal before starting. Staggers the four cards
   * so they arrive as a row being filled in rather than as four numbers
   * spinning at once. */
  delay = 0,
}: {
  value: number
  exact: boolean
  delay?: number
}) {
  const { locale } = useLocale()
  const reduceMotion = useReducedMotion()
  const { ref, revealed } = useReveal<HTMLSpanElement>()
  const [shown, setShown] = useState(reduceMotion === true ? value : 0)

  useEffect(() => {
    if (!revealed) return
    if (reduceMotion === true) {
      setShown(value)
      return
    }
    // 1.1 s, longer than the page's 0.5 s reveal on purpose: a number counting
    // is meant to be read *while* it counts, and a figure that lands in half a
    // second has only flickered. Still well inside the register the federal
    // design system uses for anything a reader waits on.
    const controls = animate(0, value, {
      duration: 1.1,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(latest),
      // Guarantees the last frame is the exact value rather than 4 999.7,
      // which `formatApproximateCount` would round to 5.000 anyway — but the
      // rounding would be luck rather than a promise.
      onComplete: () => setShown(value),
    })
    return () => controls.stop()
  }, [revealed, value, delay, reduceMotion])

  return (
    <span ref={ref} className="tabular-nums">
      {formatApproximateCount(Math.round(shown), exact, locale)}
    </span>
  )
}
