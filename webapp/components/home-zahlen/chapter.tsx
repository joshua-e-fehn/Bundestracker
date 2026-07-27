"use client"

import { createContext, useContext, useId } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { ClaimSentence } from "@/components/home-zahlen/claim-sentence"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"
import { useRevealOnScroll } from "@/lib/use-reveal-on-scroll"
import { cn } from "@/lib/utils"

/**
 * One chapter of the narrative home page: a claim, the data, the caveat.
 *
 * That order is the whole argument of Concept C, and it is an editorial rule
 * rather than a layout: **here is what this number claims, here is the number,
 * here is what it does not claim.** The site's caveats already existed —
 * `home.bottomMPsCaveat`, `home.statNamedVotesNote`, `parties.smallGroupCaveat`
 * — as footnotes under the sections they qualify. This page promotes them into
 * the story, which is what makes it an argument about evidence rather than a
 * dashboard with a headline.
 *
 * The claim comes *before* the data in DOM order as well as visually, and the
 * caveat after it. §9 of the design research is firm about this: reading order
 * is DOM order, and a qualification must not reach a screen reader before the
 * thing it qualifies. app/page.tsx already orders the two leaderboards on the
 * same principle.
 *
 * ## Why the reveal is here and not on each child
 *
 * A chapter fades in as a unit. Revealing the heading, the cards and the caveat
 * independently would stagger three elements that are one thought, and — more
 * concretely — the data sections change height when their Convex queries land
 * (they render skeletons first), so three observers on three boxes inside one
 * chapter would fire at three different scroll positions depending on what had
 * loaded. §8 of the research names this as the most likely source of subtle bugs
 * in the whole redesign.
 *
 * The claim sentence is the exception: it has its own observer, because its
 * words brighten on their own timing and it sits at the top of the chapter where
 * the chapter's own trigger has not necessarily fired yet.
 *
 * ## The reveal is `opacity` and `translateY` only
 *
 * Both composite off the main thread. No height, no filter, nothing that
 * reflows — which matters here more than usual, because these sections *do*
 * change height underneath the animation as data arrives.
 */

/**
 * Whether this chapter has been revealed, for descendants that need to start
 * their own motion at the same moment.
 *
 * `CountUpNumber` is the only consumer and the reason this is a context rather
 * than a prop: the figures are three components deep inside the chapter's
 * children, and threading a boolean through `SummaryStats` would put a motion
 * concern into a data component that has none.
 *
 * Defaults to `true`, which is the right answer outside a chapter: a figure
 * rendered anywhere else on the site has no entrance to wait for, and a default
 * of `false` would leave it permanently un-counted. That is the same
 * "finished state is the default" discipline app/globals.css applies to reduced
 * motion.
 */
const ChapterRevealContext = createContext(true)

export function useChapterRevealed(): boolean {
  return useContext(ChapterRevealContext)
}

export function Chapter({
  claimKey,
  caveat,
  children,
  className,
}: {
  /** The chapter's claim — the large sentence that opens it, and the accessible
   * name of the section. */
  claimKey: TranslationKey
  /**
   * What the chapter's numbers do *not* say — a `<ChapterCaveat>`.
   *
   * Optional, because one chapter (the feed) makes no measurement and so
   * qualifies nothing; a caveat there would be ceremony, and a page that
   * attaches one to every section teaches the reader to stop reading them.
   * Every chapter that reports a figure has one.
   *
   * A node rather than a key, even though `ChapterCaveat` takes a key: it keeps
   * this component out of the business of deciding *which* caveat, which is the
   * page's editorial call and is spelled out at each call site there.
   */
  caveat?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const { ref, reveal, shown } = useRevealOnScroll<HTMLElement>()
  // The claim sentence *is* the section's heading in the accessibility tree —
  // see the note in the page — so it needs a stable id to be pointed at.
  const claimId = useId()

  return (
    <section
      ref={ref}
      aria-labelledby={claimId}
      data-reveal={reveal}
      className={cn("reveal-section flex flex-col gap-8", className)}
    >
      <ClaimSentence id={claimId} sentenceKey={claimKey} className="max-w-3xl" />
      <ChapterRevealContext.Provider value={shown}>{children}</ChapterRevealContext.Provider>
      {caveat}
    </section>
  )
}

/**
 * The chapter's caveat, as the site's own caveat box.
 *
 * A thin wrapper over `CaveatNote` rather than a second implementation: that
 * component's header explains at length why every limit-of-the-sources note on
 * this site is the same shape, and a home page that invented its own would be
 * the drift it warns about. What this adds is the measure — a caveat reads as
 * body copy on this page rather than as a footnote, so it is capped to a
 * readable line length and set at the 14 px the surrounding prose uses instead
 * of the 12 px the dense pages need.
 *
 * Takes a key rather than children, which is the one place this departs from
 * `CaveatNote`: every caveat on this page is a whole translated sentence, and
 * `t(...)` at four call sites is four chances to reach for `lib/i18n`'s server
 * `t` by mistake and freeze the text at the server's locale.
 */
export function ChapterCaveat({ textKey }: { textKey: TranslationKey }) {
  const { t } = useLocale()
  return <CaveatNote className="max-w-3xl text-sm">{t(textKey)}</CaveatNote>
}
