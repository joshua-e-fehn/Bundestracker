"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BrandMark } from "@/components/brand-mark"
import { useLocale } from "@/components/providers/locale-provider"
import { placeholderArc, STATUTORY_SEATS } from "@/lib/protokoll"
import { markSplashSeen, readSplashEnvironment, shouldRunSplash } from "@/lib/splash-gate"

/**
 * The opening animation — Concept L1, "630 Sitze".
 *
 * 630 dots, one per Bundestag seat, fade in from the centre of the arc outward,
 * settle into the hemicycle, and contract into the site's mark as the page
 * reveals underneath.
 *
 * ## Why 630 dots and not a spinner
 *
 * Because the number *is* the fact. americabydesign.gov's described opener
 * counts 215 stars, which is a US motif with no German counterpart; the German
 * equivalent of "how many of the thing this site is about" is the seat count,
 * and 630 is it (§6.2 reconciles the 635 mandate rows to 630 sitting at once).
 * It also costs nothing to invent: `layoutHemicycle` already places an
 * arbitrary number of seats, so this is the same geometry Chapter 1 draws,
 * assembled rather than revealed. The splash *becomes* the page instead of
 * delaying it.
 *
 * ## It never blocks data
 *
 * This overlays the page; it does not gate it. The Convex queries underneath
 * fire on mount and resolve while this is on screen, so the splash overlaps
 * real loading rather than adding to it — which is the difference between a
 * 900 ms animation and a 900 ms delay. Nothing below reads a query.
 *
 * ## Every way out
 *
 * §6 asks for dismissible, and dismissible means *every* plausible gesture, not
 * a button: any key, any pointer press, any scroll, any wheel or touch. The
 * button exists as well, because a visible affordance is what tells a reader
 * the gesture is available — but a reader who reaches for the scroll wheel
 * first must not have to find it.
 *
 * ## Reduced motion, Save-Data and the second visit
 *
 * All three are handled by `shouldRunSplash` (lib/splash-gate.ts), read in an
 * effect rather than during render. That ordering matters: the gate needs
 * `matchMedia` and `sessionStorage`, neither of which exists during SSR, so
 * this starts *closed* and opens only if the browser says it may. The failure
 * that avoids is the one that would be worst — a splash rendered into the
 * server HTML, painted, and then removed on hydration, which is a flash for
 * exactly the readers who asked not to have one.
 */

/**
 * The whole animation's budget, in seconds. §6 caps it at ~900 ms and this is
 * the only place the number lives — the stagger, the colour flush and the
 * contraction are all fractions of it below, so shortening the budget shortens
 * the sequence rather than truncating it.
 */
const BUDGET = 0.9

/** How long the arc holds, finished, before it contracts into the mark. Short:
 * the finished chamber is the payoff, and a payoff that lingers is a wait. */
const HOLD = 0.12

/**
 * The splash, if this session is allowed one.
 *
 * Renders nothing at all when the gate refuses, which is the common case after
 * the first page view — not an empty overlay, and not a zero-opacity one. A
 * transparent full-screen element still swallows the first click of every
 * subsequent navigation.
 */
export function ProtokollSplash() {
  const { t } = useLocale()
  const [running, setRunning] = useState(false)

  // The gate reads `matchMedia` and `sessionStorage`, so it cannot run during
  // render — see the header. Starting closed and opening in an effect costs one
  // frame of the page being visible before the overlay lands, which is
  // deliberate: the page underneath is the thing being decorated, and it should
  // exist first.
  useEffect(() => {
    if (!shouldRunSplash(readSplashEnvironment())) return
    markSplashSeen()
    setRunning(true)
  }, [])

  const dismiss = useCallback(() => setRunning(false), [])

  // Every exit. Registered only while running, so a dismissed splash leaves no
  // listeners on the page it was covering.
  useEffect(() => {
    if (!running) return

    // `capture` on the pointer and wheel listeners: the overlay is above the
    // page, but a reader who scrolls is talking to the document, and the
    // gesture should end the splash before it scrolls anything.
    const options = { capture: true } as const
    window.addEventListener("keydown", dismiss, options)
    window.addEventListener("pointerdown", dismiss, options)
    window.addEventListener("wheel", dismiss, { ...options, passive: true })
    window.addEventListener("touchstart", dismiss, { ...options, passive: true })
    window.addEventListener("scroll", dismiss, { ...options, passive: true })

    // The budget itself. `HOLD` past the sequence so the finished arc is seen
    // rather than inferred, then the overlay leaves under `AnimatePresence`.
    const timer = window.setTimeout(dismiss, (BUDGET + HOLD) * 1000)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("keydown", dismiss, options)
      window.removeEventListener("pointerdown", dismiss, options)
      window.removeEventListener("wheel", dismiss, options)
      window.removeEventListener("touchstart", dismiss, options)
      window.removeEventListener("scroll", dismiss, options)
    }
  }, [running, dismiss])

  // The statutory chamber in a neutral colour — the roster query has not
  // resolved and may not before this leaves. `useMemo` because 630 positions is
  // real trigonometry and this component re-renders on dismissal.
  const arc = useMemo(() => placeholderArc(STATUTORY_SEATS), [])

  return (
    <AnimatePresence>
      {running ? (
        <motion.div
          // `dialog` would trap focus and demand a label the reader cannot
          // read at this speed. This is a decoration over the page, and the
          // page is already there underneath — so it is announced as nothing
          // and the skip button below is the only part in the tab order.
          aria-hidden
          className="fixed inset-0 z-100 grid place-items-center bg-background"
          initial={{ opacity: 1 }}
          // Fades rather than cutting, and the arc contracts *into* the mark's
          // position as it goes — the page's own header carries the same eagle
          // at the same place, so the splash hands off to it.
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* The flag hairline, so the overlay reads as this site's own opening
              rather than as a blank interstitial. Same utility as the header's
              top edge (app/globals.css). */}
          <div aria-hidden className="federal-rule absolute inset-x-0 top-0 h-[3px]" />

          <motion.div
            // `max-w-3xl` is Chapter 1's width, not a size chosen for this
            // overlay. The splash's whole idea is that it *becomes* the page:
            // the arc contracts into the mark and the reader lands on the same
            // arc, drawn from the same geometry. At `max-w-xl` it landed a
            // third smaller and the handover read as a cut to a different
            // picture. `lib/protokoll.ts` guarantees the two arcs are identical
            // seat for seat; this is what makes them the same *size*.
            className="flex w-full max-w-3xl flex-col items-center gap-6 px-6"
            // The whole group contracts toward the mark as the sequence ends —
            // one transform on the parent rather than 630 on the children,
            // which is what keeps this compositable at this node count.
            initial={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.22, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.7, 0, 0.84, 0] }}
          >
            <svg
              aria-hidden="true"
              viewBox={`${arc.viewBox.x} ${arc.viewBox.y} ${arc.viewBox.width} ${arc.viewBox.height}`}
              className="h-auto w-full"
            >
              <title>{t("protokoll.splashCounting")}</title>
              {arc.seats.map((seat) => (
                <motion.circle
                  key={`${seat.position.row}-${seat.position.column}`}
                  cx={seat.position.x}
                  cy={seat.position.y}
                  r={arc.seatRadius}
                  fill={seat.fill}
                  // Opacity only. 630 nodes each carrying a transform is the
                  // one measurable risk in this concept (§8), and opacity is
                  // the cheaper half of the two compositable properties —
                  // there is no layout, no paint and no per-node transform
                  // matrix. The *group* above does the movement.
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    // Centre outward: the stagger is over the seat's distance
                    // from the top of the arc, not its index. See
                    // `centreOutwardDistance` — an index stagger sweeps the
                    // chamber left to right, which reads as the political
                    // spectrum filling in from one end.
                    delay: seat.distance * BUDGET * 0.72,
                    duration: BUDGET * 0.28,
                    ease: "easeOut",
                  }}
                />
              ))}
            </svg>

            <div className="flex items-center gap-3">
              <BrandMark className="size-6 text-gold-brand" />
              <motion.span
                className="font-medium text-muted-foreground text-sm tabular-nums"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: BUDGET * 0.55, duration: 0.3 }}
              >
                {t("protokoll.splashCounting")}
              </motion.span>
            </div>
          </motion.div>

          {/* The visible way out. `aria-hidden` on the overlay above would hide
              this from a screen reader too — which is correct: a reader using
              one is not looking at an animation, and every other exit gesture
              (any key, including Tab) already ends it. The button is for the
              sighted reader who wants it gone now. */}
          <button
            type="button"
            onClick={dismiss}
            className="absolute right-4 bottom-4 rounded-md px-3 py-1.5 text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("protokoll.splashSkip")}
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
