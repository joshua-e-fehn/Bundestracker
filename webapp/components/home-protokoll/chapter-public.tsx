"use client"

import { useQuery } from "convex/react"
import { motion } from "framer-motion"
import { useLocale } from "@/components/providers/locale-provider"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { TranslationKey } from "@/lib/i18n"
import { CHAPTERS } from "@/lib/protokoll"
import { CountUp } from "./count-up"
import { REVEAL_OFFSET, REVEAL_TRANSITION, useReveal } from "./use-reveal"

/**
 * Chapter 2 — the four headline figures, counting up.
 *
 * The same four stats `SummaryStats` shows on the current home page and from
 * the same query, with the same three-state contract and the same caveat. §7's
 * requirement #4 is the one being honoured here: the narrative adds sentences
 * *around* the data, it does not replace it with prose. If every animation on
 * this page were removed, this section would be today's stats row.
 *
 * ## Why this is not `<SummaryStats>` with a wrapper
 *
 * It nearly is, and the difference is the count-up and the layout. That
 * component renders a `grid-cols-2 lg:grid-cols-4` of small cards sized for a
 * dashboard row; this is the second chapter of a story and its figures are the
 * largest type on the page. Reaching for the existing component and overriding
 * both would leave a component with two layouts and a `variant` prop that only
 * one page passes — which is the shape PROTOCOL.md's "one way to do something"
 * rule is usually invoked *against*, but here the shared thing worth sharing is
 * the query and the caveat, and both are shared: same `api.stats.getChamberStats`,
 * same `home.stat*` keys, same `home.statNamedVotesNote`.
 */

/**
 * The four figures, in the order the argument needs them.
 *
 * Members first — Chapter 1 just drew them — then the three kinds of recorded
 * work, ordered by how directly each is a *document*: a named ballot is a
 * published sheet, a motion is a published Drucksache, a speech contribution is
 * a paragraph of a protocol. That is the same order the current home page uses,
 * and changing it here would put the two pages' rows in different sequences for
 * no reason a reader could see.
 */
const FIGURES: ReadonlyArray<{
  key: "mps" | "namedVotes" | "motions" | "speeches"
  labelKey: TranslationKey
  noteKey?: TranslationKey
}> = [
  { key: "mps", labelKey: "home.statMPs" },
  // The one caveat that belongs on the front page rather than buried: a named
  // ballot is the exception in the Bundestag, not the rule, so this figure is
  // not "how often they voted".
  { key: "namedVotes", labelKey: "home.statNamedVotes", noteKey: "home.statNamedVotesNote" },
  { key: "motions", labelKey: "home.statMotions" },
  { key: "speeches", labelKey: "home.statSpeeches" },
]

export function ChapterPublic({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t } = useLocale()
  const { ref, revealed } = useReveal<HTMLDivElement>()
  const skip = wahlperiode === null || wahlperiode === undefined
  const stats = useQuery(api.stats.getChamberStats, skip ? "skip" : { wahlperiode })

  return (
    <motion.div
      ref={ref}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      initial={{ opacity: 0, y: REVEAL_OFFSET }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: REVEAL_OFFSET }}
      transition={REVEAL_TRANSITION}
    >
      {FIGURES.map(({ key, labelKey, noteKey }, index) => {
        const stat = stats?.[key]
        return (
          <Card key={key} className="gap-0 p-6">
            <div className="font-semibold text-4xl sm:text-5xl">
              {stat === undefined ? (
                <Skeleton className="h-12 w-32" />
              ) : (
                // Staggered by 0.12 s each, so the row fills in left to right
                // rather than four numbers spinning at once. Small enough that
                // the last card is under half a second behind the first.
                <CountUp value={stat.count} exact={stat.exact} delay={index * 0.12} />
              )}
            </div>
            <div className="mt-2 font-medium text-base">{t(labelKey)}</div>
            {noteKey ? (
              <p className="mt-3 text-muted-foreground text-xs leading-relaxed">{t(noteKey)}</p>
            ) : null}
          </Card>
        )
      })}
    </motion.div>
  )
}

export const PUBLIC_CHAPTER = CHAPTERS[1]
