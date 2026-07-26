"use client"

import { TriangleAlert } from "lucide-react"
import { useLocale } from "@/components/providers/locale-provider"

/**
 * The disclaimer §9 requires, and the most important element on the seating page.
 *
 * Two different claims sit in one diagram and only one of them is backed by the
 * Bundestag's records:
 *
 *  - **The size of each bloc is real**, counted from the roster
 *    (`mps.getFractionSizes`) — the one seating fact §9 says *is* derivable.
 *  - **The position of any single seat is invented.** No machine-readable seating
 *    plan exists in the DIP spec, the Stammdaten DTD, the protocol XML, the
 *    bundestag.de plenary pages or Wikidata; the Bundestag publishes one only as
 *    a rendered graphic per sitting.
 *
 * A picture of a parliament is read as a picture of *that* parliament, so a
 * reader who takes a dot for an MP's actual chair has been misled by us rather
 * than by their own carelessness. That is why this is a client component of its
 * own: it renders above the map, unconditionally, before any query resolves, and
 * at full contrast rather than as muted small print.
 *
 * The same warning appears in convex/seating.ts and lib/seating.ts, where the
 * rows are written and the arc is computed. This is the only one a reader sees.
 */
export function SyntheticSeatingNotice() {
  const { t } = useLocale()
  return (
    <p
      // `note`, not `alert`: the caveat is permanent context for the page, and
      // `alert` would have a screen reader interrupt to announce it on arrival
      // as though something had just gone wrong.
      role="note"
      className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-sm leading-relaxed"
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
        aria-hidden="true"
      />
      <span>{t("seating.syntheticNotice")}</span>
    </p>
  )
}
