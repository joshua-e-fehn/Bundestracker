"use client"

import { useInView } from "framer-motion"
import { useEffect, useRef } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { seatingMode } from "@/lib/seating"
import { chapterAnchor, chapterCaveatKeys, type SitzungswocheChapter } from "@/lib/sitzungswoche"
import { cn } from "@/lib/utils"

/**
 * One chapter of the sitting week: a heading, its prose, its caveats, its data.
 *
 * ## The reveal is a data attribute, not an animated style
 *
 * `useInView` decides *whether* the chapter has been reached; app/globals.css
 * decides what that looks like. The alternative — animating opacity from
 * JavaScript — puts the reduced-motion decision in a conditional, and a
 * conditional is one `if` away from being wrong. Here the base CSS is the
 * revealed state and the transition lives inside
 * `@media (prefers-reduced-motion: no-preference)`, so a reader who asked for
 * less motion gets the finished page whatever this component sets. §9 of the
 * design research is explicit that this ordering is the load-bearing part.
 *
 * ## `once: true` is the ratchet
 *
 * §3 measured americabydesign.gov doing the same thing with an explicit
 * `Math.max(prev, index)`: text that un-reveals on scroll-up flickers, and a
 * long page scrolled quickly flickers a lot. `useInView`'s `once` gives the
 * same guarantee for free — the flag latches true and never returns.
 *
 * ## The band is 25 % from the bottom, not the viewport edge
 *
 * `margin: "0px 0px -25% 0px"` shrinks the observer's box so a chapter counts as
 * reached when it is a quarter of the way up the screen rather than the instant
 * its first pixel appears. That is americabydesign's 40 %-of-viewport idea at a
 * gentler setting: their band suits per-word brightening, where the eye is on
 * one line; a whole paragraph revealing wants to start sooner, or the reader
 * scrolls to a blank space and waits for it.
 *
 * ## Why this is not pinned and the chamber is
 *
 * The chapter carries links — the data sections under it are the real dashboard
 * — and §9 is unambiguous that a pinned region containing focusable controls
 * traps keyboard users: focus moves to a control the browser then cannot scroll
 * into view. So the sticky element is the chamber, which is `aria-hidden` and
 * has no focus stops, and the column that scrolls is the one with everything
 * interactive in it.
 *
 * ## The chapter tells the chamber what it is, rather than the other way round
 *
 * `onActive` fires when this chapter is the one the reader is looking at, and
 * the page uses it to pick the colour mode. The first version divided total
 * scroll progress into equal bands instead, one per chapter — which is wrong for
 * a reason a browser makes obvious and arithmetic does not: the chapters are not
 * the same height. Chapter 1 carries two leaderboards and chapter 3 carries five
 * ballot rows, so the bands drifted out of step with the headings, and the
 * chamber was already showing chapter 5's committee ramp while chapter 4's
 * heading was at the top of the screen. A picture that contradicts the sentence
 * beside it is worse than no picture.
 *
 * Observing the element removes the assumption entirely: it does not care how
 * tall a chapter is, and it stays right when a section grows because its query
 * resolved — which §8 of the research warns is exactly what this page's sections
 * do.
 *
 * The activation band is the middle of the viewport (`-40% 0px -40% 0px`),
 * narrower than the reveal's, because this answers a different question. The
 * reveal asks "has the reader arrived here"; this asks "which one are they
 * reading", and only one chapter may be the answer at a time.
 */
export function Chapter({
  chapter,
  index,
  onActive,
  children,
  className,
}: {
  chapter: SitzungswocheChapter
  /** Position in the story, for the "1 / 5" marker. Passed rather than derived
   * from the table so this component stays renderable in isolation. */
  index: number
  /** Called when this chapter reaches the middle of the viewport. Optional, so
   * a chapter renders correctly on its own — the colouring is the page's
   * concern, not the chapter's. */
  onActive?: (id: SitzungswocheChapter["id"]) => void
  /** The data section this chapter is the prose for. Required — a chapter
   * without one is a paragraph that replaced a table, which is the failure §7
   * of the research says is most likely to go unnoticed. */
  children: React.ReactNode
  className?: string
}) {
  const { t } = useLocale()
  const ref = useRef<HTMLElement>(null)
  const revealed = useInView(ref, { once: true, margin: "0px 0px -25% 0px" })
  const active = useInView(ref, { margin: "-40% 0px -40% 0px" })

  useEffect(() => {
    if (active) onActive?.(chapter.id)
  }, [active, chapter.id, onActive])

  const headingId = `${chapterAnchor(chapter.id)}-heading`
  const caveatKeys = chapterCaveatKeys(chapter, seatingMode(chapter.mode)?.caveatKey)

  return (
    <section
      ref={ref}
      // The anchor lives on the section, so the skip link lands on the heading
      // and its data rather than in the middle of the previous chapter.
      id={chapterAnchor(chapter.id)}
      aria-labelledby={headingId}
      // `scroll-mt` so the sticky header does not cover the heading when the
      // skip link jumps here — 14 (the header) plus room to breathe.
      //
      // `min-w-0` for the reason its parent grid documents: a grid item's
      // `min-width` is `auto`, so without it this section sizes to the widest
      // thing inside it — the leaderboard cards — and takes the document
      // sideways at phone widths.
      className={cn("min-w-0 scroll-mt-24", className)}
    >
      <div className="sitzung-reveal" data-revealed={revealed}>
        {/* The chapter number, as a quiet marker rather than a heading level.
            It tells a reader how far through the story they are, which is what
            makes a long scroll feel bounded — and it is `aria-hidden` because
            the heading below it already names the chapter, and "1 / 5" read
            aloud before every heading is noise. */}
        <p aria-hidden className="mb-3 font-medium text-gold text-xs tabular-nums tracking-widest">
          {String(index + 1).padStart(2, "0")}
        </p>

        <h2 id={headingId} className="font-semibold text-2xl tracking-tight sm:text-3xl">
          {t(chapter.titleKey)}
        </h2>

        {/* The lead is the sentence the chapter is *about*; the body is why it
            is true. Two paragraphs rather than one, at two weights, because a
            single block at one weight is what makes a scrollytelling page read
            as a wall. */}
        <p className="mt-3 text-balance text-lg text-muted-foreground">{t(chapter.leadKey)}</p>
        <p className="mt-3 max-w-prose text-muted-foreground text-sm leading-relaxed">
          {t(chapter.bodyKey)}
        </p>

        {/* Inside the narrative, above the data, and never below it — §7 again:
            a story that omits the limits of its own measure is both a worse
            story and a worse dashboard. `CaveatNote` rather than a local box so
            these read as the same thing a reader has met on /seating and
            /rankings. */}
        {caveatKeys.length > 0 && (
          <div className="mt-5 grid gap-2">
            {caveatKeys.map((key) => (
              <CaveatNote key={key}>{t(key)}</CaveatNote>
            ))}
          </div>
        )}
      </div>

      {/* Outside the reveal wrapper, deliberately. The data must not depend on
          an animation having run: `useInView` needs an IntersectionObserver and
          a paint, and a section whose real content sat inside a
          `data-revealed="false"` box would be invisible to a reader whose
          JavaScript failed — which is precisely the reader least able to do
          anything about it. The prose can afford to arrive; the figures
          cannot. */}
      <div className="mt-8">{children}</div>
    </section>
  )
}
