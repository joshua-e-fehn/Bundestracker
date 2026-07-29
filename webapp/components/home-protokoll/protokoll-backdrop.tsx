"use client"

import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion"
import type { RefObject } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { CHAPTERS } from "@/lib/protokoll"

/**
 * The page's two background animations: a gold wash that drifts with the
 * reader, and a hairline rule that grows down the left gutter.
 *
 * Two `transform`/`opacity` animations, no particles — the whole decorative
 * budget for this page (§4, Concept A). Both are `aria-hidden` and
 * `pointer-events-none`, per §9: decorative motion carries no information and
 * must be invisible to assistive tech and unable to swallow a click.
 *
 * ## The wash is the hero's, extended
 *
 * app/page.tsx already paints one radial gold wash behind its headline. This is
 * the same gradient — same `--chart-3` at 28 %, same `closest-side`, same blur
 * — bound to scroll progress instead of parked. Reusing the recipe rather than
 * inventing a second one is what keeps the two pages recognisably the same
 * site while Joshua compares them.
 *
 * `max-w-full` is not decoration either, and that note is carried over
 * verbatim: the wash is centred and anything wider than the viewport pushes its
 * right edge past it, which scrolls the *whole document* sideways. Decoration
 * cannot be allowed to do that.
 *
 * ## The rule is the progress indicator
 *
 * A hairline down the left gutter that fills as the reader descends — the
 * "document being compiled" idea made literal, and the page's only progress
 * affordance. Its marks are the five chapters, and they are real links: a
 * reader who wants Chapter 4 should be able to get there, and a decoration that
 * happens to look like navigation while not being navigable is worse than no
 * indicator at all.
 *
 * Hidden below `xl`. Not because it would not fit — it would — but because
 * there is no gutter to put it in at those widths, so it would either overlap
 * the text column or push it. A phone reader has the browser's own scrollbar.
 */

export function ProtokollBackdrop({
  /** The article the rail measures against. Not the window: the page has a
   * header and a footer, and progress through *the record* should reach 100 %
   * when the last chapter ends rather than when the legal notice does. */
  target,
}: {
  target: RefObject<HTMLElement | null>
}) {
  const { t } = useLocale()
  const reduceMotion = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target,
    // `start start → end end` measures the article's own travel, so the rail is
    // full exactly as its last pixel leaves the top of the viewport.
    offset: ["start start", "end end"],
  })

  /**
   * Smoothed, and this is the one place on the page that needs it.
   *
   * The rail is a single continuous element with no quantisation, so it tracks
   * raw scroll exactly — including the sub-pixel jitter of a trackpad's inertia
   * and the discrete jumps of a mouse wheel, both of which read as a twitch on
   * a 1 px line. A gentle spring turns that into a line that follows. Nothing
   * else here is smoothed: the seat reveal quantises instead (see
   * `ChapterChamber`), and smoothing a value that drives *how many nodes exist*
   * would just add a settle to every step.
   */
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 26,
    // `restDelta` above the default so the spring stops rather than settling
    // for another few hundred milliseconds after the reader does — on a
    // `scaleY` of a 1 px line, anything finer than this is invisible and is
    // pure frames.
    restDelta: 0.001,
  })

  // The wash drifts a little under a fifth of the page's travel and dims as the
  // reader descends: brightest behind the opening, nearly gone by the last
  // chapter, so the page reads as light falling off rather than as a texture.
  const washY = useTransform(progress, [0, 1], ["0vh", "38vh"])
  const washOpacity = useTransform(progress, [0, 0.55, 1], [0.6, 0.4, 0.12])

  return (
    <>
      <motion.div
        aria-hidden
        className="-z-10 -translate-x-1/2 pointer-events-none fixed top-[-6rem] left-1/2 h-[26rem] w-[52rem] max-w-full rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklch, var(--chart-3) 28%, transparent), transparent)",
          // Reduced motion gets the wash at rest — present, not moving. §9: the
          // resting state is the finished picture, and for a background wash
          // "finished" is simply the wash, at its opening position.
          y: reduceMotion === true ? 0 : washY,
          opacity: reduceMotion === true ? 0.6 : washOpacity,
        }}
      />

      {/* The gutter rule. `fixed` rather than absolute inside the article: it is
          a viewport-level indicator and should not scroll away with the
          section it started beside.

          ⚠ The offset is computed against the *content column*, not the
          viewport, and `--shell-inset` is what makes those two different. The
          expression finds the column's left edge — its centre is inset by half
          the sidebar's width, so `50vw` has to be corrected by half of it
          before subtracting the 40 rem half-width — and then keeps the rail at
          least 1.5 rem clear of the rail itself rather than of the screen.
          Without the correction the indicator drifted left over the text as
          soon as a 16 rem sidebar appeared beside it, which is the failure a
          `fixed` element sitting outside the padded shell will always have:
          padding does not affect a fixed descendant's containing block, so the
          variable is the only thing it can consult. See
          components/app-shell.tsx. */}
      <nav
        aria-label={t("protokoll.progressLabel")}
        className="pointer-events-none fixed inset-y-0 left-[max(calc(var(--shell-inset,0px)+1.5rem),calc(50vw+var(--shell-inset,0px)/2-40rem))] z-40 hidden items-center xl:flex"
      >
        <div className="relative h-[60svh] w-px bg-border">
          {/* The filled portion. `scaleY` from the top, so it *grows* rather
              than repainting a height — the compositable half of the same
              effect, and the reason this costs nothing on the main thread. */}
          <motion.div
            aria-hidden
            className="absolute inset-x-0 top-0 h-full origin-top bg-gold"
            style={{ scaleY: progress }}
          />

          {/* The chapter marks. Evenly spaced rather than positioned at each
              chapter's real offset, and that is deliberate: real offsets would
              have to be measured, and §1's constraint is that every section's
              height changes when its query resolves. A rail whose marks jump as
              data lands is worse than one that spaces them evenly and is honest
              about being a table of contents rather than a map. */}
          {CHAPTERS.map((chapter, index) => (
            <a
              key={chapter.anchor}
              href={`#${chapter.anchor}`}
              // `pointer-events-auto` re-enables clicks on the marks alone —
              // the rail itself stays transparent to the pointer so it cannot
              // intercept a drag across the left edge of the page.
              className="group -translate-x-1/2 -translate-y-1/2 pointer-events-auto absolute left-1/2 flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              style={{ top: `${(index / (CHAPTERS.length - 1)) * 100}%` }}
            >
              <span className="sr-only">
                {t("protokoll.chapterLabel", {
                  index: chapter.index,
                  title: t(chapter.titleKey),
                })}
              </span>
              {/* The dot is 6 px; the link around it is 24 px. A 6 px target
                  fails every pointer-size guideline, so the hit area is the
                  link and the dot is only what it looks like. */}
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-border transition-colors group-hover:bg-gold group-focus-visible:bg-gold"
              />
            </a>
          ))}
        </div>
      </nav>
    </>
  )
}
