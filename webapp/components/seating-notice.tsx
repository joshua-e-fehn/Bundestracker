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
      // Gold rather than the Tailwind amber this used to carry. Two reasons
      // beyond palette tidiness: the amber sat one hue away from the brand gold
      // on a page that is otherwise entirely gold, which reads as a near-miss
      // rather than as a deliberate warning colour; and `dark:text-amber-500`
      // was a light-mode-only correction from when dark was the default, so in
      // light mode the icon was a *darker* amber than in dark mode. `--gold`
      // clears 4.5:1 in both themes, so the icon needs no variant.
      //
      // The body text stays `--foreground` rather than taking the tint. This is
      // the most important sentence on the page (§9) and it is a paragraph, not
      // a label: it is read at full contrast, with the gold carrying only the
      // icon and the frame.
      className="flex gap-2.5 rounded-lg border border-gold/40 bg-gold/10 p-3.5 text-sm leading-relaxed"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
      <span>{t("seating.syntheticNotice")}</span>
    </p>
  )
}
