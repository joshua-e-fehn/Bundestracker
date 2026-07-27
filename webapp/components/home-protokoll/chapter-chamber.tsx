"use client"

import { useQuery } from "convex/react"
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"
import { partyColor, partyLabel } from "@/lib/parties"
import { buildArc, revealThreshold, STATUTORY_SEATS } from "@/lib/protokoll"

/**
 * Chapter 1 — the chamber assembling itself as the reader scrolls.
 *
 * The arc is pinned for a little over one viewport height while its 630 seats
 * arrive from the centre outward, then releases into the rest of the page. It
 * is the same arc `ProtokollSplash` assembles and the same geometry `/seating`
 * draws — `buildArc` (lib/protokoll.ts) is shared by all three, so a reader who
 * has seen one recognises the others.
 *
 * ## Why the pin is `position: sticky` and not a scroll offset
 *
 * §1's constraint, and the likeliest source of subtle bugs in this whole
 * project: every section on this page resolves a Convex query, so heights
 * change *after* mount. A pin computed from offsets measured at mount would
 * drift the moment the roster landed. `sticky` re-measures itself, and
 * `useScroll` with an element target does too.
 *
 * ## Why only this chapter pins
 *
 * §9: a pinned section cannot be scrolled into view by the browser when focus
 * moves into it, so pinning anything interactive breaks keyboard navigation.
 * This chapter is a picture — one link at the end of it, outside the pinned
 * area — so it is the only one that can afford the pin. Chapters 2–5 are
 * unpinned reveals.
 *
 * ## Reduced motion
 *
 * The finished chamber, immediately, with no pin at all: `useReducedMotion`
 * short-circuits the threshold to 1 and the tall spacer collapses. The reader
 * gets the same picture, not a half-drawn one — app/globals.css's rule, which
 * exists precisely because the inverse (animate, then disable) freezes a reader
 * on the first frame.
 */

/**
 * ## Where the pin length lives
 *
 * In app/globals.css, as `chamber-pin` — 220 svh, which is the sticky frame's
 * own viewport height plus the ~1.2 screens of travel Concept A asks for.
 * Longer would be more cinematic and is exactly what makes a dashboard reader
 * feel trapped (§7); shorter and the 630 seats arrive faster than the eye
 * follows them.
 *
 * It is not a constant here because it has to be *absent* for a reduced-motion
 * reader on the very first paint, and only a media query can know that before
 * JavaScript runs — see the note at the utility, and the comment on the track
 * below. Nothing in this file reads the number: `useScroll` measures the
 * element, so changing the CSS changes the pin with no counterpart to update.
 */

export function ChapterChamber({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t, locale } = useLocale()
  const reduceMotion = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)

  const skip = wahlperiode === null || wahlperiode === undefined
  const fractionSizes = useQuery(api.mps.getFractionSizes, skip ? "skip" : { wahlperiode })
  const arc = useMemo(() => buildArc(skip ? undefined : fractionSizes), [skip, fractionSizes])

  // Against the scroll *track* — the tall spacer the sticky frame lives in —
  // rather than the window, so the reveal is bound to this chapter's own
  // position and stays correct when a section above it changes height.
  const { scrollYProgress } = useScroll({
    target: track,
    offset: ["start start", "end end"],
  })

  /**
   * How much of the arc is drawn, as a distance-from-centre threshold.
   *
   * React state driven by a `MotionValue` subscription rather than a
   * `useTransform` fed into a style, because what changes here is *which
   * circles exist*, not a property of one element — 630 `<circle>`s each
   * subscribing to a motion value would be 630 subscriptions recomputing every
   * frame, which is the node count §8 flags as this concept's one measurable
   * risk. One subscription that sets one number, and React renders the seats
   * whose distance is under it.
   *
   * Quantised to 40 steps for the same reason: the eye cannot see a difference
   * of two seats out of 630, and a `setState` per frame would re-render the
   * whole arc 60 times a second. Forty steps over a two-screen scroll is a
   * change every ~30 px of travel, which reads as continuous.
   */
  const [threshold, setThreshold] = useState(reduceMotion === true ? 1 : 0)
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    if (reduceMotion === true) return
    const next = revealThreshold(progress)
    setThreshold((current) => {
      const quantised = Math.round(next * 40) / 40
      return quantised === current ? current : quantised
    })
  })

  // Reduced motion is the finished state — see the header. Also the state for a
  // reader who has not scrolled yet on a browser where the observer has not
  // fired: the threshold starts at 0 and the first `change` event sets it, so
  // the arc opens empty and fills, which is the intended first frame.
  const visible = reduceMotion === true ? 1 : threshold

  const seats = useMemo(
    () => (arc === null ? [] : arc.seats.filter((seat) => seat.distance <= visible)),
    [arc, visible],
  )

  return (
    <div className="grid gap-8">
      {/* The scroll track. Its height *is* the pin length: the sticky frame
          inside it stays put while this scrolls past, and `useScroll`'s
          `start start → end end` maps that travel onto 0…1.

          Both the height and the stickiness come from CSS — `chamber-pin` in
          app/globals.css, and Tailwind's own `motion-safe:` — rather than from
          `reduceMotion` here, and that is not a style preference. This
          component runs on the server too, where `useReducedMotion()` returns
          `null` because there is no `matchMedia` to ask; the tall track was
          therefore baked into the SSR markup and *stayed* after hydration,
          since React does not clear an attribute its new output merely lacks.
          A reduced-motion reader got the finished chamber with two viewport
          heights of empty scrolling after it. The media query is evaluated by
          the browser before any JavaScript, so there is nothing to hydrate and
          nothing to get wrong. The full account is at the utility. */}
      <div ref={track} className="chamber-pin relative">
        {/* `top-20` clears the sticky header (h-14 + the 3 px rule) with room
            above the arc. `overflow-visible` is not set: nothing here would be
            clipped, and `overflow: hidden` on a pinned section is how a focus
            ring gets cut off (§9).

            `motion-safe:sticky` for the track's reason: with the pin collapsed
            to `auto`, a sticky child has nothing to travel within and would
            simply sit at the top of a box its own size — harmless, but it also
            means the reduced-motion path has one fewer thing that has to be
            true. Tailwind's `motion-safe:` is the same `no-preference` query. */}
        <div className="flex flex-col items-center gap-6 motion-safe:sticky motion-safe:top-20">
          {arc === null ? (
            <Skeleton className="aspect-[2/1.15] w-full max-w-3xl rounded-xl" />
          ) : (
            <>
              <svg
                // Decorative, as in components/seating-preview.tsx: the arc is a
                // picture of the same distribution the legend below spells out
                // in words, and announcing 630 unlabelled circles would repeat
                // it without adding anything.
                aria-hidden="true"
                viewBox={`${arc.viewBox.x} ${arc.viewBox.y} ${arc.viewBox.width} ${arc.viewBox.height}`}
                className="h-auto w-full max-w-3xl"
              >
                {seats.map((seat) => (
                  <motion.circle
                    key={`${seat.position.row}-${seat.position.column}`}
                    cx={seat.position.x}
                    cy={seat.position.y}
                    r={arc.seatRadius}
                    fill={seat.fill}
                    // Opacity only, for the splash's reason: 630 nodes each
                    // carrying a transform is the cost §8 flags, and a dot
                    // arriving in place is what "the record being compiled"
                    // looks like. A dot flying in from elsewhere would be a
                    // claim that it moved.
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  />
                ))}
              </svg>

              {/* The count, rising with the arc. Not `aria-live` — §9: the
                  final value is in the DOM and that is what gets read; a live
                  region would announce a number changing forty times. */}
              <p className="font-semibold text-4xl tabular-nums sm:text-5xl">
                {formatCount(Math.round(arc.total * visible), locale)}
                <span className="ml-2 align-middle font-normal text-muted-foreground text-base">
                  {t("seating.seatCount", { count: formatCount(arc.total, locale) })}
                </span>
              </p>

              {/* The legend, once the chamber is essentially complete. Held back
                  rather than shown from the start: the groups are what the
                  finished picture *means*, and a key beside an empty arc names
                  colours that are not on screen yet. */}
              <motion.div
                className="flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: visible > 0.85 ? 1 : 0 }}
                transition={{ duration: 0.4 }}
                // Hidden from assistive tech while it is invisible, so a screen
                // reader does not read a key for a chamber that has not been
                // described yet. It is `false` by the time the chapter ends.
                aria-hidden={visible <= 0.85}
              >
                {arc.groups.map((group) => (
                  <span
                    key={group.fraktion}
                    className="flex items-center gap-1.5 text-muted-foreground text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: partyColor(group.fraktion) }}
                    />
                    {partyLabel(group.fraktion)}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatCount(group.count, locale)}
                    </span>
                  </span>
                ))}
              </motion.div>
            </>
          )}
        </div>
      </div>

      {/* The caveat, below the pin rather than inside it.
          components/seating-notice.tsx carries the full §9 warning on
          `/seating`; this is its short form, and it is *in the narrative*
          rather than under it — §7's requirement #5. A story that showed a
          picture of a parliament without saying which half of it is invented
          would be a worse story as well as a worse dashboard.

          Not `CaveatNote`: that component is the site's standard "structural
          limit of the sources" box, deliberately quiet and repeated on five
          pages. This sentence is part of the chapter's prose and is set as
          prose. */}
      <div className="mx-auto grid max-w-2xl gap-3 text-center text-muted-foreground text-sm leading-relaxed">
        <p className="text-balance">
          {t("protokoll.chapter1Note")}{" "}
          <Link
            href="/seating"
            className="rounded-sm font-medium text-gold underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("home.seatingPreviewCta")}
          </Link>
        </p>

        {/* Why the arc can total more than the 630 in this chapter's own
            heading. Both figures are right and they count different things:
            `getFractionSizes` groups *mandates*, and a seat vacated mid-period
            carries two of them, where 630 is the seats occupied at once (§6.2 —
            635 mandate rows minus 5 departures). convex/stats.ts records the
            divergence and says the arc "should be reconciled"; reconciling the
            numbers is out of scope here, but leaving two contradictory figures
            on one screen is not — an unexplained 635 beside a heading that says
            630 is exactly the plausible wrong number this codebase refuses
            everywhere else.

            Shown only when they actually differ. A period with no replacements
            has nothing to explain, and a permanent footnote about an
            arithmetic that did not happen is its own small dishonesty. */}
        {arc !== null && arc.total !== STATUTORY_SEATS ? (
          <p className="text-balance text-xs">{t("protokoll.chapter1MandateNote")}</p>
        ) : null}
      </div>
    </div>
  )
}
