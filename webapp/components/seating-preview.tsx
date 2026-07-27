"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"
import { type FractionSize, foldFractionSizes, partyColor, partyLabel } from "@/lib/parties"
import { layoutHemicycle, seatingRank } from "@/lib/seating"
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

/**
 * One dot per seat, in political order, coloured by group.
 *
 * Expanding the counts into seats here rather than asking the server for rows is
 * what keeps this to a single cheap query — and the expansion is the same
 * left-to-right bloc order `generateSeating` uses, so the wedges land where a
 * reader who has seen /seating expects them.
 */
function useArc(fractionSizes: ReadonlyArray<FractionSize> | undefined) {
  return useMemo(() => {
    if (fractionSizes === undefined) return null

    // Folded onto one entry per *party* before anything is sorted or drawn.
    //
    // Without it this legend rendered "Fraktionslos 1" and "Fraktionslos 3" as
    // two entries in the same grey, because `getFractionSizes` groups by the
    // stored string and production holds both spellings. The dots were already
    // right — `partyColor` folds — so it was only the key beside them that
    // disagreed, with /seating and /parties showing the correct merged 4.
    //
    // `foldFractionSizes` rather than a fold written here: this component built
    // its own legend from raw strings while components/seating-legend.tsx
    // folded, which is how the two came to answer the same question
    // differently. One home for the rule, in lib/parties.ts.
    const ordered = foldFractionSizes(fractionSizes).sort(
      (a, b) =>
        seatingRank(a.fraktion) - seatingRank(b.fraktion) ||
        a.fraktion.localeCompare(b.fraktion, "de"),
    )

    const fills: string[] = []
    for (const { fraktion, count } of ordered) {
      const seats = Math.max(0, Math.min(count, MAX_PREVIEW_SEATS - fills.length))
      for (let seat = 0; seat < seats; seat++) fills.push(partyColor(fraktion))
    }

    const layout = layoutHemicycle(fills.length)
    return {
      layout,
      // `seatRadius` is derived from the *tightest spacing in the arc*, which
      // is right at 630 seats (0.019 of the unit radius) and far too generous
      // at the low end: a 12-seat development fixture spreads so loosely that
      // the same rule sizes each dot at 0.164 and the card renders a dozen
      // balloons rather than a chamber.
      //
      // Capped rather than the row count forced. Overriding `rows` was the
      // first attempt and is worse: short rows put their seats at the arc's
      // extreme angles, so a 12-seat chamber scatters into corners instead of
      // reading as a bank. Capping keeps the geometry `layoutHemicycle`
      // computed — which is the geometry /seating draws — and only declines to
      // draw a dot larger than a thumbnail can carry.
      //
      // 0.08 is four times the real chamber's radius, so every roster from
      // ~90 seats up is unaffected and renders at its natural density; only a
      // fixture small enough to look wrong either way is clamped.
      seatRadius: Math.min(layout.seatRadius, 0.08),
      // `positions` comes back sorted left to right, so index i of the arc is
      // index i of the bloc-ordered fills — the property `layoutHemicycle`'s
      // header documents and the reason the wedges read as wedges.
      seats: layout.positions.map((position, index) => ({ position, fill: fills[index] })),
      total: fills.length,
      groups: ordered,
    }
  }, [fractionSizes])
}

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
  const arc = useArc(skip ? undefined : fractionSizes)

  // `undefined` is Convex still loading; an empty roster is a real answer and
  // gets no card at all rather than an empty arc — the hero should not carry a
  // second "no data" message when the page below it already says so.
  if (arc === null) {
    return <Skeleton className={cn("aspect-[2/1.15] w-full rounded-xl", className)} />
  }
  if (arc.total === 0) return null

  // Recomputed from the capped radius rather than taken from the layout, which
  // sized its box for the uncapped dots — using it would leave a band of empty
  // space around a small-dotted arc and float the picture inside its card.
  const extent = 1 + arc.seatRadius
  const viewBox = {
    x: -extent,
    y: -extent,
    width: 2 * extent,
    height: extent + arc.seatRadius,
  }

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
