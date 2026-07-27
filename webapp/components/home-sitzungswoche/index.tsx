"use client"

import { useQuery } from "convex/react"
import { ArrowDownIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useCallback, useMemo, useState } from "react"
import {
  ActivityFeedPreview,
  BottomMPs,
  LatestVotes,
  PartyComparisonPreview,
  SummaryStats,
  TopMPs,
} from "@/components/home-sections"
import { SitzungswocheChamber } from "@/components/home-sitzungswoche/chamber"
import { Chapter } from "@/components/home-sitzungswoche/chapter"
import { OrderPaper } from "@/components/home-sitzungswoche/order-paper"
import { SealSplash } from "@/components/home-sitzungswoche/seal-splash"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import type { SeatingColorMode } from "@/lib/seating"
import {
  type ChapterId,
  chapterAnchor,
  SITZUNGSWOCHE_CHAPTERS,
  SKIP_TO_DATA_CHAPTER,
} from "@/lib/sitzungswoche"

/**
 * "Sitzungswoche" — the narrative home page, as a week in session.
 *
 * The reader scrolls through parliamentary time: the chamber fills, a paper is
 * tabled, the ballot is taken, the record is written, and the period
 * accumulates. A single hemicycle stays on screen beside the prose and
 * re-colours per chapter; every chapter carries the real dashboard section it is
 * the prose for.
 *
 * This is a second home page at /home-b, not a replacement for `/`. The chapter
 * table is lib/sitzungswoche.ts and the motion is app/globals.css; this file is
 * the layout and the one piece of state — which chapter the chamber is wearing.
 *
 * ## The dashboard survives the story
 *
 * §7 of the design research calls this the requirement most likely to be quietly
 * lost, so it is worth stating what keeps it:
 *
 *  - **Every section is here, whole.** The four summary stats, both
 *    leaderboards, the party comparison, the latest ballots and the feed — the
 *    same components app/page.tsx renders, with the same data and the same
 *    caveats. The narrative adds sentences around them; it replaces none of
 *    them with prose.
 *  - **A skip link above the fold**, pointing past the opening chapter to the
 *    first one carrying figures. Not a modal and not a preference — a link.
 *  - **Nothing is gated on an animation.** Each section renders its real
 *    content at its final position with every animation removed; the reveal is
 *    CSS whose base state is "revealed" (see components/home-sitzungswoche/
 *    chapter.tsx).
 *  - **The pin is short and non-interactive.** The chamber is `aria-hidden`
 *    with no focus stops, and it is sticky rather than fixed, so it scrolls
 *    away with its own container instead of holding the viewport.
 *
 * ## Why `"use client"`
 *
 * app/page.tsx's reasoning applies unchanged: the language toggle is client
 * state, so every translated string is client-rendered regardless, and
 * `useQuery` degrades to a skeleton rather than turning an unreachable Convex
 * deployment into a 500 for the whole page. The sections below are the same
 * client components that page already renders.
 */

/** Which colour mode the chamber wears before any chapter has been reached.
 * The first chapter's, so the arc is already right when the page paints and
 * does not re-colour itself on the reader's first scroll. */
const INITIAL_MODE: SeatingColorMode = SITZUNGSWOCHE_CHAPTERS[0].mode

export function Sitzungswoche() {
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)
  const skip = wahlperiode === null || wahlperiode === undefined
  const fractionSizes = useQuery(api.mps.getFractionSizes, skip ? "skip" : { wahlperiode })
  // The per-seat values the three continuous chapters colour by. The same query
  // /seating uses — see the chamber's header for why it takes both this and the
  // bloc counts, and which one is the fallback.
  const seating = useQuery(api.seating.getSeatingWithMPs, skip ? "skip" : { wahlperiode })

  /** `getSeatingWithMPs`' rows in the shape the chamber colours by.
   *
   * `?? null` on the three score fields for `components/seating.tsx`'s stated
   * reason: null is "the nightly sweep has not scored this MP", which
   * `seatingLevel` renders as the no-data neutral rather than as the bottom of
   * the ramp. An unscored member and an inactive one are different claims. */
  const chamberSeats = useMemo(
    () =>
      seating?.map((entry) => ({
        fraktion: entry.fraktion,
        row: entry.seat.row,
        column: entry.seat.column,
        totalScore: entry.score?.totalScore ?? null,
        voteParticipationRate: entry.score?.voteParticipationRate ?? null,
        committeeCount: entry.committeeCount,
      })),
    [seating],
  )

  const [activeChapter, setActiveChapter] = useState<ChapterId>(SITZUNGSWOCHE_CHAPTERS[0].id)

  /**
   * Which chapter the chamber is wearing.
   *
   * Reported by the chapters themselves as each reaches the middle of the
   * viewport — see components/home-sitzungswoche/chapter.tsx for why observing
   * the element beats dividing scroll progress into bands (the chapters are not
   * the same height, so the bands drifted out of step with the headings and the
   * chamber contradicted the sentence beside it).
   *
   * The guard matters: `onActive` fires on every intersection change, and
   * setting this state re-derives 635 fills. Refusing a set that changes nothing
   * keeps that to once per chapter rather than once per crossing.
   */
  const handleActive = useCallback((id: ChapterId) => {
    setActiveChapter((current) => (current === id ? current : id))
  }, [])

  const mode = useMemo(
    () =>
      SITZUNGSWOCHE_CHAPTERS.find((chapter) => chapter.id === activeChapter)?.mode ?? INITIAL_MODE,
    [activeChapter],
  )

  /**
   * The data section under each chapter.
   *
   * A record keyed by the table's own ids rather than a `switch` inside the
   * loop, so a chapter added to lib/sitzungswoche.ts without a section is a
   * **type error** here rather than a chapter that silently renders prose
   * alone. That is the same construction `HERO_VARIANT_COMPONENTS` uses in
   * components/hero-animation.tsx and for the same stated reason.
   *
   * `wahlperiode` is threaded into each because every one of these components
   * takes it and skips its query until it resolves — see app/page.tsx.
   */
  const sections: Record<ChapterId, React.ReactNode> = {
    // The chapter about the chamber filling has the chamber's own picture
    // beside it, which is the sticky column — so what belongs *under* it is the
    // one thing the arc cannot say: who is in it. The two leaderboards.
    // Stacked, where app/page.tsx puts them side by side — because the story
    // column is not the page. `MPCard` lays out as photo, rank, a `min-w-0
    // flex-1` name block, a 55 px heatmap strip and a `w-14` score column; the
    // name block is the only part that can give, so it absorbs every pixel the
    // card is short. At the home page's 536 px it has 126 px and reads; in two
    // columns inside this 710 px story track it measured 18 px, and every MP on
    // the page rendered as a single truncated letter. Nothing warns about this
    // — the name is in the DOM, and `truncate` does exactly what it says.
    arrival: (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
        <TopMPs wahlperiode={wahlperiode} />
        <BottomMPs wahlperiode={wahlperiode} />
      </div>
    ),
    tabled: <SummaryStats wahlperiode={wahlperiode} />,
    ballot: <LatestVotes wahlperiode={wahlperiode} />,
    record: <ActivityFeedPreview wahlperiode={wahlperiode} />,
    period: <PartyComparisonPreview wahlperiode={wahlperiode} />,
  }

  return (
    <main className="relative isolate">
      <SealSplash />
      <OrderPaper />

      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Opening />

        {/* The two columns. The chamber is second in source order, so a phone
            and a screen reader both reach the story before the picture — the
            same ordering app/page.tsx's hero uses, and for the same reason.
            Below `lg` the grid collapses and the chamber stops being sticky
            (see the wrapper's own classes): a sticky picture on a phone eats a
            third of the viewport for the whole page. */}
        <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
          {/* `min-w-0` and `grid-cols-[minmax(0,1fr)]` are both load-bearing,
              and for the reason app/page.tsx and components/color-mode-toggle.tsx
              each document at length: a grid item's `min-width` is `auto`, so a
              track sizes itself to its widest *content* rather than to the
              space available. Measured at 390 px without them, the leaderboard
              cards' intrinsic width won and every chapter rendered 710 px wide
              inside a 390 px viewport — so the whole document scrolled
              sideways, on every chapter, exactly as this codebase has been
              caught by twice before. The outer track has the `minmax`; this
              inner grid needs its own, because one `auto` minimum anywhere in
              the chain is enough to reintroduce it. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-24 sm:gap-32">
            {SITZUNGSWOCHE_CHAPTERS.map((chapter, index) => (
              <Chapter key={chapter.id} chapter={chapter} index={index} onActive={handleActive}>
                {sections[chapter.id]}
              </Chapter>
            ))}
          </div>

          {/* `self-start` is what makes `sticky` work: a grid item stretches to
              its row by default, so a sticky child of a full-height item has
              nowhere to stick. `top-20` clears the 14-unit header plus its
              federal rule.

              `hidden lg:block` rather than a responsive `position`: at narrow
              widths the arc would sit above five chapters of text and push the
              whole story below the fold, and the hero already shows this
              reader the same picture. */}
          <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
            <SitzungswocheChamber
              seats={skip ? undefined : chamberSeats}
              fractionSizes={skip ? undefined : fractionSizes}
              mode={mode}
              // `?? 0` never reaches a query — the chamber draws from bloc
              // counts, and the period is only used to decide who governed.
              // An unresolved period yields `unknown` from `coalitionRole`,
              // which is the honest answer while it is still loading.
              wahlperiode={wahlperiode ?? 0}
            />
          </aside>
        </div>

        <Closing />
      </div>
    </main>
  )
}

/**
 * The page's opening: what it is, and the way past it.
 *
 * The skip link sits beside the primary call to action rather than in a corner,
 * because it is for the reader who has been here before and that reader is
 * looking at the top of the page, not hunting its edges. A plain anchor, not a
 * button and not a preference — §7 is specific that remembering the choice is a
 * separate concern and that the affordance itself should be a link.
 */
function Opening() {
  const { t } = useLocale()

  return (
    <header className="grid max-w-3xl gap-5">
      <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">{t("homeB.title")}</h1>
      <p className="text-balance text-lg text-muted-foreground sm:text-xl">{t("homeB.lead")}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button asChild size="lg">
          <Link href="/mps">
            {t("home.browseAllMPs")}
            <ArrowRightIcon />
          </Link>
        </Button>
        {/* A real `<a href="#…">` rather than a scripted scroll: it works
            without JavaScript, it is reachable by keyboard as a link, and the
            browser moves focus to the target — which a `scrollIntoView` call
            does not, and which is the difference between skipping the story
            and merely scrolling past it. `scroll-mt` on the target keeps the
            heading clear of the sticky header. */}
        <a
          href={`#${chapterAnchor(SKIP_TO_DATA_CHAPTER)}`}
          aria-label={t("homeB.skipToDataLabel")}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-gold text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("homeB.skipToData")}
          <ArrowDownIcon className="size-4" aria-hidden />
        </a>
      </div>
    </header>
  )
}

/**
 * The way out of the story.
 *
 * A narrative page needs an ending or the last chapter's data reads as the page
 * simply stopping. These are the two routes the home page has always pointed at
 * — the roster and the rankings — restated where a reader who has read the whole
 * thing actually is.
 */
function Closing() {
  const { t } = useLocale()

  return (
    <div className="mt-24 flex flex-wrap gap-2 border-border/60 border-t pt-10">
      <Button asChild variant="outline" size="lg">
        <Link href="/rankings">{t("home.viewRankings")}</Link>
      </Button>
      <Button asChild variant="outline" size="lg">
        <Link href="/seating">{t("home.seatingPreviewCta")}</Link>
      </Button>
    </div>
  )
}
