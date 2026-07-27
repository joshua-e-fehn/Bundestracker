"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"
import { partyColor, partyLabel } from "@/lib/parties"
import { buildFractionArc } from "@/lib/seating"
import { cn } from "@/lib/utils"

/**
 * The hemicycle, small enough to sit in the home page's hero.
 *
 * ## Why this is not `<SeatingMap>` at a smaller size
 *
 * The full map is 630 individually focusable links, each wrapped in a tooltip,
 * inside a pan-and-zoom surface. At hero size none of that is usable — a 3 px
 * dot is not a click target, and 630 tab stops between the headline and the
 * first call-to-action would make the top of the page unnavigable by keyboard.
 * So this draws the *same arc* as one link, from the same geometry: it is a
 * picture of the chamber, and the picture is the affordance.
 *
 * The parts that could be wrong without looking wrong are shared rather than
 * reimplemented. `layoutHemicycle` places the seats and `seatingRank` orders the
 * blocs left to right, both from lib/seating.ts, so this arc and the one on
 * /seating cannot disagree about the chamber's shape. `partyColor` gives the
 * fills, so a group is the same colour here as in every badge on the site.
 *
 * ## It draws from the counts, not from the seat rows
 *
 * `getFractionSizes` — one grouped read of the roster — rather than
 * `getSeatingWithMPs`, which joins four documents per seat to answer questions
 * (tooltip, colour modes) this has no use for. §9's point stands either way: the
 * *distribution* is the real information and the position within a bloc is
 * arbitrary, so a preview built from bloc sizes says everything the picture can
 * honestly say. It also means the preview renders on a deployment that has a
 * roster but no generated seating rows, which is a real state — see the empty
 * state in `components/seating.tsx`.
 */

/** Cap on the dots drawn. The real chamber is 630 and every one of them fits;
 * this only bounds a pathological roster from turning the hero into a
 * thousand-node SVG. */
const MAX_PREVIEW_SEATS = 700

export function SeatingPreview({
  wahlperiode,
  className,
}: {
  wahlperiode: number | null | undefined
  className?: string
}) {
  const { t, locale } = useLocale()
  const skip = wahlperiode === null || wahlperiode === undefined
  const fractionSizes = useQuery(api.mps.getFractionSizes, skip ? "skip" : { wahlperiode })
  // `buildFractionArc` rather than an expansion written here. This component
  // used to fold, order, expand and cap inline — the same four steps the
  // narrative chamber needs — and a second copy is how two pictures of one
  // Bundestag come to seat their blocs in different places. See lib/seating.ts.
  const arc = useMemo(
    () => buildFractionArc(skip ? undefined : fractionSizes, MAX_PREVIEW_SEATS),
    [skip, fractionSizes],
  )

  // `undefined` is Convex still loading; an empty roster is a real answer and
  // gets no card at all rather than an empty arc — the hero should not carry a
  // second "no data" message when the page below it already says so.
  if (arc === null) {
    return <Skeleton className={cn("aspect-[2/1.15] w-full rounded-xl", className)} />
  }
  if (arc.total === 0) return null

  const viewBox = arc.viewBox

  return (
    <Link
      href="/seating"
      aria-label={t("home.seatingPreviewLink")}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-4 outline-none transition-colors hover:border-border hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">{t("seating.title")}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("seating.seatCount", { count: formatCount(arc.total, locale) })}
        </span>
      </div>

      {/* Decorative here, unlike the full map: the arc is a picture of the same
          distribution the legend below spells out in words, so announcing 630
          unlabelled circles would repeat it without adding anything. The link
          carries the accessible name. */}
      <svg
        aria-hidden="true"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="h-auto w-full"
      >
        {arc.seats.map(({ position, fill }) => (
          <circle
            key={`${position.row}-${position.column}`}
            cx={position.x}
            cy={position.y}
            r={arc.seatRadius}
            fill={fill}
          />
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {arc.groups.map((group) => (
          <span
            key={group.fraktion}
            className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: partyColor(group.fraktion) }}
            />
            {partyLabel(group.fraktion)}
            <span className="tabular-nums">{formatCount(group.count, locale)}</span>
          </span>
        ))}
      </div>

      {/* Gold, not `--primary`: this is a call to action inside a card, and
          `--primary` is the page's near-black text colour in light mode, so the
          line read as a caption rather than as a link. The arrow moves on
          hover, so the affordance does not rest on the colour alone. */}
      <span className="flex items-center gap-1 font-medium text-gold text-xs">
        {t("home.seatingPreviewCta")}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
