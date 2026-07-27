"use client"

import { motion } from "framer-motion"
import { useLocale } from "@/components/providers/locale-provider"
import type { Chapter as ChapterDefinition } from "@/lib/protokoll"
import { cn } from "@/lib/utils"
import { useReveal } from "./use-reveal"

/**
 * One chapter of the record: a rule, a number, a heading, a standfirst, and
 * whatever data the chapter is about.
 *
 * ## Why the frame is a component and the chapters are not
 *
 * The five chapters differ in their content and in nothing else — same rule,
 * same numbering, same measure, same reveal, same spacing. Five copies of this
 * markup is how one of them ends up with a different heading size, or how the
 * fourth loses its rule and reads as a continuation of the third. So the frame
 * is here and each chapter file supplies only its own body.
 *
 * The definition comes from `CHAPTERS` (lib/protokoll.ts) rather than from
 * props spelled out at the call site, which is what keeps the `id` a section
 * renders at and the anchor the progress rail links to from drifting apart.
 *
 * ## The reveal
 *
 * The heading block moves; the body does not. That asymmetry is deliberate and
 * is the difference between a document and a slideshow: a reader arriving at a
 * chapter should see the *chapter* announce itself, and then read data that was
 * simply there. Animating the tables too would mean a reader who scrolls fast
 * arrives at a page still assembling itself, and every one of those sections
 * has its own three-state loading contract already.
 *
 * `useReveal` returns true immediately under `prefers-reduced-motion`, so the
 * no-motion reader gets the finished heading rather than a frozen first frame
 * — app/globals.css's pattern, applied to scroll.
 */
export function Chapter({
  chapter,
  children,
  className,
}: {
  chapter: ChapterDefinition
  children: React.ReactNode
  className?: string
}) {
  const { t } = useLocale()
  const { ref, motion: reveal } = useReveal<HTMLElement>()
  const headingId = `${chapter.anchor}-heading`

  return (
    <section
      ref={ref}
      id={chapter.anchor}
      aria-labelledby={headingId}
      // `scroll-mt` so the skip link and the rail's marks land the heading
      // below the sticky header rather than under it. The header is `h-14` plus
      // the 3 px rule; 6 rem leaves a little air above the rule.
      className={cn("scroll-mt-24", className)}
    >
      {/* The chapter rule. `document-rule` (app/globals.css) rather than
          `federal-rule`, and the note there explains why at length: the flag
          stays confined to the site chrome's 3 px edge, so the page's own
          hairline is a single gold one. */}
      <div aria-hidden className="document-rule" />

      {/* `reveal` is the `initial`/`animate`/`transition` triple from
          `useReveal`. The finished state is the `animate` target and the
          offset is the `initial`, so a reduced-motion reader — for whom
          `revealed` is true on the first render — never sees the offset. */}
      <motion.div className="mt-6 grid max-w-3xl gap-3" {...reveal}>
        {/* The chapter number, in the gold ink tier rather than the fill tier:
            this is text at 12 px, which is exactly the case app/globals.css's
            two-tier split exists for — `--gold-brand` measures 2.4:1 on the
            light background and reads as a smudge at this size. */}
        <p className="font-medium text-gold text-xs uppercase tracking-[0.2em]">
          {t(chapter.numberKey)}
        </p>
        <h2 id={headingId} className="font-semibold text-3xl tracking-tight sm:text-4xl">
          {t(chapter.titleKey)}
        </h2>
        {/* `text-balance` for the reason the hero's tagline carries it: these
            are two-line sentences at desktop width, and a lone trailing word is
            what makes a standfirst read as a paragraph that ran out. */}
        <p className="text-balance text-lg text-muted-foreground leading-relaxed">
          {t(chapter.standfirstKey)}
        </p>
      </motion.div>

      <div className="mt-10">{children}</div>
    </section>
  )
}
