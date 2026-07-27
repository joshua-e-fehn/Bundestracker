"use client"

import { animate, useReducedMotion } from "framer-motion"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { formatApproximateCount } from "@/lib/format"
import { REVEAL_TRANSITION, useReveal } from "./use-reveal"

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
 *
 * ## Why the *last* frame is the value and not the animation's end
 *
 * §9 again, and this is the failure that made the figures read as zeros. The
 * count runs from 0 to `value` on the reveal, and `value` arrives from a Convex
 * query that resolves independently of the reader's scroll. Measured on a 390 px
 * viewport against WP21 data: the reveal fired while three of the four stats
 * were still `undefined`, each rendered `0`, and each then animated 0 → 0 and
 * stopped — so the row read "630 / 0 / 0+ / 0" for a chamber with 69 ballots and
 * 16 416 speeches, permanently, because the animation had already completed by
 * the time the real figure landed.
 *
 * The effect therefore depends on `value` and re-runs when it changes, and the
 * rendered figure falls back to `value` rather than to 0 whenever no animation
 * is in flight. A figure on this page is never a number the record does not
 * support: the count-up is a sweetener over a correct value, so when the two
 * disagree the value wins.
 *
 * The caller compounds that guarantee by not mounting this until its stat has
 * resolved (`ChapterPublic` renders a skeleton meanwhile), so the common path
 * never animates a placeholder at all. This handles the case that slips past it
 * — a figure that changes *after* the count has run, which the nightly sweep
 * makes a real event on a page that subscribes.
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
  /**
   * The number on screen while an animation is running, or `null` when none is
   * — in which case `value` itself is rendered.
   *
   * Null rather than seeding this with 0, so that "counting from zero" and "the
   * figure is zero" are different states. Seeded with 0 they are the same one,
   * and a count that finished before its query landed is indistinguishable from
   * a chamber that held no ballots. See the header.
   */
  const [counting, setCounting] = useState<number | null>(null)

  useEffect(() => {
    if (!revealed) return
    if (reduceMotion === true) {
      setCounting(null)
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
      onUpdate: (latest) => setCounting(latest),
      // Hands the figure back to `value`. Not `setCounting(value)`: the last
      // frame of an eased run is 4 999.7 rather than 5 000, and rounding it
      // would land on the right number by luck rather than by construction.
      // Releasing to `null` renders `value` itself, which is exact by
      // definition and stays exact if the query updates afterwards.
      onComplete: () => setCounting(null),
    })
    // Stops *and* releases. A run cancelled mid-count — because `value`
    // changed, or the card unmounted — must not leave the last intermediate
    // frame on screen as though it were the figure.
    return () => {
      controls.stop()
      setCounting(null)
    }
  }, [revealed, value, delay, reduceMotion])

  return (
    <span ref={ref} className="tabular-nums">
      {formatApproximateCount(Math.round(counting ?? value), exact, locale)}
    </span>
  )
}

/** The transition a count-up's *container* uses, so a card and the number
 * inside it arrive together. Re-exported rather than imported twice at the call
 * site. */
export { REVEAL_TRANSITION }
