"use client"

import type { FunctionReturnType } from "convex/server"
import { useQuery } from "convex/react"
import { useChapterRevealed } from "@/components/home-zahlen/chapter"
import { CountUpNumber } from "@/components/home-zahlen/count-up-number"
import { useLocale } from "@/components/providers/locale-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatApproximateCount } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"

/**
 * The four headline figures, as type rather than as cards.
 *
 * The narrative home page's one substantive departure from `components/
 * home-sections.tsx`. Everything else on app/home-c/page.tsx is that file's
 * component rendered unchanged; this is a second rendering of one query.
 *
 * ## Why it is a copy and not a prop on `SummaryStats`
 *
 * Because what changes is not a variant, it is the whole presentation. The
 * original renders four `<Card>`s in a 2×2 grid — a dashboard tile, correctly,
 * for a dashboard. Here the figures are the chapter's body copy: no card, no
 * border, a much larger figure, and the note that qualifies the second one
 * moved out entirely because the chapter's caveat now carries it (see
 * `Chapter`).
 *
 * A `variant="narrative"` prop on the original would have to switch the
 * wrapper, the grid, the type scale, the skeleton size and whether the note
 * renders — five branches through one component, which is the shape that makes
 * a component impossible to read and impossible to change without checking the
 * other caller. `PROTOCOL.md` forbids a second way to do something that already
 * exists, and the thing that already exists here is *the query and its
 * three-state contract*, not the layout. Both are honoured: the query, the
 * `{count, exact}` handling and `formatApproximateCount` are shared, and only
 * the markup differs.
 *
 * If this concept ships and `/` adopts it, the right move is to delete
 * `SummaryStats` rather than to add a prop to it.
 *
 * ## The `+` is the point of this section
 *
 * Two of these four counts are floors — `getChamberStats` stops at
 * `COUNT_CEILING` and reports `exact: false`. The chapter's claim sentence
 * ("zwei davon sind Untergrenzen") exists to explain the `+` before the reader
 * meets it, which is the closest this page comes to making an editorial point
 * out of an implementation detail. It is worth it: an unexplained `+` on a
 * civic dashboard reads as sloppiness, where an explained one is the site
 * demonstrating exactly the discipline it claims.
 */

/**
 * The four figures, in the order they are read.
 *
 * Same four as `SummaryStats`, and deliberately the same order: a reader who
 * has seen `/` should find the same numbers in the same sequence.
 */
const FIGURES: ReadonlyArray<{
  key: string
  labelKey: TranslationKey
  pick: (stats: ChamberStats) => { count: number; exact: boolean }
}> = [
  { key: "mps", labelKey: "home.statMPs", pick: (s) => s.mps },
  { key: "namedVotes", labelKey: "home.statNamedVotes", pick: (s) => s.namedVotes },
  { key: "motions", labelKey: "home.statMotions", pick: (s) => s.motions },
  { key: "speeches", labelKey: "home.statSpeeches", pick: (s) => s.speeches },
]

/** What `getChamberStats` resolves to. Derived from the generated API type
 * rather than restated, so a field renamed in convex/stats.ts is a compile
 * error here rather than a figure that silently reads `undefined`. */
type ChamberStats = FunctionReturnType<typeof api.stats.getChamberStats>

export function NarrativeSummaryStats({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t, locale } = useLocale()
  const revealed = useChapterRevealed()
  const stats = useQuery(
    api.stats.getChamberStats,
    wahlperiode === null || wahlperiode === undefined ? "skip" : { wahlperiode },
  )

  return (
    // Two up on a phone, four across from `sm`. No cards and no borders: this
    // chapter is a paragraph of figures, and four boxes would put it back into
    // the dashboard register the page is arguing its way out of. The generous
    // `gap-y` is what separates the two phone rows instead.
    <dl className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 sm:gap-x-8">
      {FIGURES.map(({ key, labelKey, pick }) => {
        const stat = stats === undefined ? undefined : pick(stats)
        return (
          // `flex-col-reverse`, so the source is `dt` then `dd` while the
          // figure sits above its label.
          //
          // The order is not a style choice: a `dl` is *defined* as groups of
          // one or more `dt` followed by one or more `dd`, so `dd` first is
          // invalid HTML and puts the pair into the accessibility tree
          // wrongly-associated in some engines. The reverse is also the better
          // announcement — "Abgeordnete, 630" reads as a labelled figure where
          // "630, Abgeordnete" reads as two things.
          //
          // This is the one place on the page where visual order and DOM order
          // differ, and it is inside a two-element pair rather than across the
          // page's content. §9's rule is about scroll choreography not moving
          // sections away from their reading order; a label and the number it
          // labels are one item either way round.
          <div key={key} className="flex flex-col-reverse gap-2">
            <dt className="font-medium text-muted-foreground text-sm leading-snug">
              {t(labelKey)}
            </dt>
            <dd className="ml-0 font-semibold text-4xl leading-none tracking-tight sm:text-5xl">
              {stat === undefined ? (
                <Skeleton className="h-10 w-24 sm:h-12" />
              ) : (
                <CountUpNumber
                  value={stat.count}
                  // The same call the static text below makes, so the last
                  // animated frame and React's own output are the same string
                  // by construction rather than by coincidence — including the
                  // `+` an inexact count carries.
                  formatValue={(latest) => formatApproximateCount(latest, stat.exact, locale)}
                  // Waits for the chapter's reveal rather than observing itself
                  // — see the note on `useChapterRevealed`. Data arriving after
                  // the reveal still counts: the effect keys on both.
                  start={revealed}
                >
                  {formatApproximateCount(stat.count, stat.exact, locale)}
                </CountUpNumber>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
