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
import { buildArc, CHAPTERS, revealThreshold, STATUTORY_SEATS } from "@/lib/protokoll"
import { cn } from "@/lib/utils"

/**
 * Chapter 1 — the chamber assembling itself as the reader scrolls.
 *
 * The arc is pinned for a little under one viewport height while its seats
 * arrive from the centre outward, then releases into the rest of the page. It
 * is the same arc `ProtokollSplash` assembles and the same geometry `/seating`
 * draws — `buildArc` (lib/protokoll.ts) is shared by all three, so a reader who
 * has seen one recognises the others.
 *
 * ## What the scroll has to end on
 *
 * The animation used to end on a picture and nothing else, and it read as an
 * anticlimax: a reader spent two screens of scrolling and arrived at a 391 px
 * arc in a 900 px viewport with its legend still faded out — measured, at
 * 1440 × 900. The count beside it read "635635 Sitze", because the rising figure
 * and the static label were both printing the total (see `seat-count` below).
 *
 * So the chapter now ends on something worth arriving at, and the four changes
 * are one decision rather than four: **the pin's payoff is the finished
 * chamber, so everything that explains the chamber is part of the payoff.** The
 * arc is drawn larger, the seat count is a single correct figure, the Fraktion
 * legend is present throughout rather than revealed at the end, and hovering a
 * group dims the rest so the reader can find it in the arc. The pin is also
 * shorter (see `chamber-pin` in app/globals.css) — the travel that felt long is
 * the travel that ended on nothing.
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
 * The legend below is interactive on *hover* only — it highlights, it does not
 * navigate or disclose, and every fact it carries is printed in it either way —
 * so nothing here needs focus to be usable. The one link is outside the pinned
 * area. Chapters 2–5 are unpinned reveals.
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
 * In app/globals.css, as `chamber-pin`. Nothing in this file reads the number:
 * `useScroll` measures the element, so changing the CSS changes the pin with no
 * counterpart to update.
 *
 * It is not a constant here because it has to be *absent* for a reduced-motion
 * reader on the very first paint, and only a media query can know that before
 * JavaScript runs — see the note at the utility, and the comment on the track
 * below.
 */

export function ChapterChamber({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t, locale } = useLocale()
  const reduceMotion = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)

  const skip = wahlperiode === null || wahlperiode === undefined
  const fractionSizes = useQuery(api.mps.getFractionSizes, skip ? "skip" : { wahlperiode })
  const arc = useMemo(() => buildArc(skip ? undefined : fractionSizes), [skip, fractionSizes])

  /**
   * The Fraktion the reader is pointing at, or null.
   *
   * Hover only, and deliberately not also focus-with-keyboard: the arc it
   * highlights is `aria-hidden`, so for a reader who is not looking at it the
   * highlight has nothing to reveal — every count it could disclose is already
   * printed in the legend row itself. Adding a tab stop per group would put six
   * focusable elements that do nothing in front of the one link that does.
   */
  const [hovered, setHovered] = useState<string | null>(null)

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
   * whole arc 60 times a second.
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
        {/* `top-16` rather than `top-20`: the frame is taller now that the arc
            is drawn larger and the legend is always present, so it buys back
            the 16 px it needs from the gap above rather than from the picture.
            It still clears the sticky header (h-14 + the 3 px rule).

            `overflow-visible` is not set: nothing here would be clipped, and
            `overflow: hidden` on a pinned section is how a focus ring gets cut
            off (§9).

            `motion-safe:sticky` for the track's reason: with the pin collapsed
            to `auto`, a sticky child has nothing to travel within and would
            simply sit at the top of a box its own size — harmless, but it also
            means the reduced-motion path has one fewer thing that has to be
            true. Tailwind's `motion-safe:` is the same `no-preference` query. */}
        <div className="flex flex-col items-center gap-5 motion-safe:sticky motion-safe:top-16">
          {arc === null ? (
            <Skeleton className="aspect-[2/1.15] w-full max-w-5xl rounded-xl" />
          ) : (
            <>
              <svg
                // Decorative, as in components/seating-preview.tsx: the arc is a
                // picture of the same distribution the legend below spells out
                // in words, and announcing 630 unlabelled circles would repeat
                // it without adding anything.
                aria-hidden="true"
                viewBox={`${arc.viewBox.x} ${arc.viewBox.y} ${arc.viewBox.width} ${arc.viewBox.height}`}
                // `max-w-5xl`, up from `max-w-3xl`, and capped by height as well
                // as by width. The arc is this chapter's whole payoff and it was
                // being drawn at 768 px in a 1440 px viewport; at 1024 px it
                // fills the column the way a picture that took two screens to
                // arrive should.
                //
                // `max-h-[52svh]` is what keeps that honest on a short or
                // landscape viewport: the frame also carries the count and the
                // legend, and a 2:1.15 arc sized purely by width overflows a
                // 500 px-tall window and pushes both off screen — which is the
                // "ends on nothing" failure in a different disguise. `svh` for
                // `chamber-pin`'s reason: on a phone `vh` is the viewport with
                // the browser chrome hidden.
                className="h-auto max-h-[52svh] w-full max-w-5xl"
              >
                {seats.map((seat) => {
                  // Which group this seat belongs to, for the hover highlight.
                  // Compared by colour rather than carried on the seat: `buildArc`
                  // expands group counts into one fill per seat and that fill *is*
                  // the group's identity here — adding a parallel `fraktion` field
                  // would be a second answer to the same question, and the two
                  // would drift the first time the expansion changed.
                  const dimmed = hovered !== null && seat.fill !== partyColor(hovered)
                  return (
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
                      //
                      // The dim is the same property, so hovering a group costs
                      // no layout and no paint either — it composites, like
                      // everything else on this page.
                      initial={{ opacity: 0 }}
                      animate={{ opacity: dimmed ? 0.12 : 1 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}
                    />
                  )
                })}
              </svg>

              {/* The count, rising with the arc. Not `aria-live` — §9: the
                  final value is in the DOM and that is what gets read; a live
                  region would announce a number changing forty times. */}
              <SeatCount drawn={Math.round(arc.total * visible)} total={arc.total} />

              {/* The legend, present from the start rather than faded in at the
                  end.

                  It used to appear only once the arc was 85 % drawn, on the
                  reasoning that a key beside an empty arc names colours that are
                  not on screen yet. True, and outweighed: the legend is how a
                  reader knows what they are watching, and withholding it meant
                  the whole scroll — the part the reader is actually *in* — was a
                  wordless field of dots. It is also the fact the picture cannot
                  carry: §9 is explicit that the seat *positions* are invented
                  while the group sizes are official, so the numbers here are the
                  chapter's evidence and the arc is its illustration.

                  Two viewport heights of an unexplained animation followed by a
                  caption is the shape that read as "barely anything visible". */}
              <ul className="flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2">
                {arc.groups.map((group) => (
                  <li key={group.fraktion}>
                    {/* A `<li>`, not a control. It has no action — hovering
                        highlights an `aria-hidden` picture, and both facts it
                        could disclose are printed right here. See `hovered`. */}
                    <span
                      onPointerEnter={() => setHovered(group.fraktion)}
                      onPointerLeave={() => setHovered(null)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border border-transparent px-2 py-1 text-muted-foreground text-xs transition-colors",
                        hovered === group.fraktion && "border-border bg-accent/60 text-foreground",
                      )}
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
                  </li>
                ))}
              </ul>
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

/**
 * The seat count under the arc: how many are drawn, out of how many there are.
 *
 * ## The bug this shape exists to prevent
 *
 * It was one figure and a label, and both printed the total:
 *
 *     {formatCount(arc.total * visible)}  <span>{t("seating.seatCount", {count: arc.total})}</span>
 *
 * `seating.seatCount` is "{count} Sitze" — the *count* is inside the string. So
 * once the arc finished, the line rendered "635635 Sitze": the rising figure
 * reached 635, and the label it sat beside began with 635 of its own. Measured
 * in the DOM at the end of the pin. Mid-scroll it read "349635 Sitze", which is
 * worse than a typo — it is a number a reader can misread as a real one.
 *
 * The two figures are now visibly *two*, joined by the word the chapter needs
 * anyway: 349 **von** 635 Sitzen. That reads correctly at every frame of the
 * animation, states what the reader is watching rather than only where it ends,
 * and reaches "635 von 635 Sitzen" when it is done.
 *
 * `seating.seatCount` is left to its two honest callers (`/seating` and the home
 * preview), where the figure it interpolates is the only one on the line.
 */
function SeatCount({ drawn, total }: { drawn: number; total: number }) {
  const { t, locale } = useLocale()

  return (
    <p className="text-center font-semibold text-3xl tabular-nums sm:text-4xl">
      {t("protokoll.chapter1SeatsDrawn", {
        drawn: formatCount(drawn, locale),
        total: formatCount(total, locale),
      })}
    </p>
  )
}

/** This chapter's definition, so the page composes `CHAPTERS` rather than
 * restating the order. */
export const CHAMBER_CHAPTER = CHAPTERS[0]
