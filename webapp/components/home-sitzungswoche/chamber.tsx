"use client"

import { useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { SeatingLegend } from "@/components/seating-legend"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCount } from "@/lib/format"
import type { FractionSize } from "@/lib/parties"
import {
  blocColor,
  buildFractionArc,
  hemicycleViewBox,
  isDerivableFromBlocs,
  placeSeats,
  type SeatColorInput,
  type SeatingColorMode,
  seatingMode,
} from "@/lib/seating"
import { cn } from "@/lib/utils"

/**
 * The chamber that stays on screen while the story scrolls past it.
 *
 * ## Why this is not `<SeatingMap>`
 *
 * The same reason `components/seating-preview.tsx` is not: the full map is 630
 * focusable links inside a pan-and-zoom surface, and 630 tab stops in a *pinned*
 * element is worse than in a static one — §9 of the design research names it
 * exactly, a keyboard user whose focus lands inside a sticky region cannot
 * scroll it into view, because it is already in view and never moves. So this is
 * a picture: `aria-hidden`, no focus stops, no pointer targets. Everything it
 * shows in colour, the legend under it says in words.
 *
 * It is still the *same* picture, and this file owns none of the parts that make
 * it one. `placeSeats` and `buildFractionArc` lay the dots out, `seatColor`
 * fills them and `SeatingLegend` explains them — all shared with /seating, so a
 * change to the palette or the geometry cannot reach one without the other.
 * What is left here is the choice between two data sources and the markup.
 *
 * ## Two sources, and why the fallback is not the plan
 *
 * The chapters colour the chamber five ways, and three of those — activity,
 * attendance, committee work — are *per MP*. Bloc counts cannot answer them:
 * `getFractionSizes` returns `{ fraktion, count }`, so a chamber drawn from it
 * knows which group a dot belongs to and nothing else.
 *
 * The first version drew from bloc counts alone and rendered those three modes
 * in the no-data neutral. Defensible in the abstract — inventing a ramp would be
 * far worse, and `seatingLevel` returns null rather than 0 for exactly this
 * reason — but wrong in practice: the deployment *has* the per-seat data (635
 * seats, 634 scored), so three of the five chapters greyed themselves out while
 * the figures sat one query away. A caveat about missing data is only honest
 * when the data is actually missing.
 *
 * So this prefers `getSeatingWithMPs` and falls back to the bloc arc only while
 * that is loading or genuinely absent (a deployment with a roster but no
 * generated seating rows is a real state; see the empty state in
 * components/seating.tsx). The fallback still refuses to invent a ramp — that is
 * `blocColor`'s job — and the legend dims its scale to say so.
 */

/** Cap on the dots drawn — the same bound the hero preview applies, and for the
 * same reason: the real chamber is 630 and fits comfortably; this only stops a
 * pathological roster from becoming a thousand-node SVG. */
const MAX_CHAMBER_SEATS = 700

/**
 * How long the whole chamber takes to arrive, in milliseconds.
 *
 * Spread across however many seats there are rather than a fixed per-seat step,
 * so a 12-seat fixture and a 630-seat Bundestag both finish in the same beat.
 * 600 ms sits inside §6's budget and inside the register the research measured
 * on the federal sites, where entrance motion runs 150–500 ms.
 */
const SEAT_ARRIVAL_MS = 600

/** What this component needs per seat: the group, and the three values the
 * continuous modes read. Deliberately `SeatColorInput` plus the stored arc
 * position, so a caller passes `getSeatingWithMPs` rows through with no
 * reshaping beyond the null-handling that query's own header describes. */
export type ChamberSeat = SeatColorInput & {
  row: number | null
  column: number | null
}

export function SitzungswocheChamber({
  seats,
  fractionSizes,
  mode,
  wahlperiode,
  className,
}: {
  /** The chamber with its per-MP values — `getSeatingWithMPs`. `undefined`
   * while loading; `[]` when no arc has been generated, which is a real state
   * and falls back to the bloc drawing. */
  seats: readonly ChamberSeat[] | undefined
  /** Bloc counts — `getFractionSizes`. Drives the legend in every mode, and the
   * whole picture when `seats` is unavailable. */
  fractionSizes: ReadonlyArray<FractionSize> | undefined
  mode: SeatingColorMode
  wahlperiode: number
  className?: string
}) {
  const { t, locale } = useLocale()

  /** The bloc arc: the fallback drawing, and the source of the legend's counts
   * in every mode. */
  const arc = useMemo(() => buildFractionArc(fractionSizes, MAX_CHAMBER_SEATS), [fractionSizes])

  /**
   * One list of dots, whichever source produced them.
   *
   * Resolved here rather than branched inside the JSX, which is what the first
   * version did — a `??` between two differently-shaped arrays, inside the
   * `<svg>`, with a nested ternary feeding one of them. The markup below now
   * maps over a list and knows nothing about where it came from.
   */
  const drawing = useMemo(() => {
    // Preferred: the real chamber, coloured by the real per-MP values.
    if (seats !== undefined && seats.length > 0) {
      const placed = placeSeats(seats, mode, wahlperiode)
      return { ...placed, total: placed.seats.length, measured: true }
    }
    // Degraded: bloc counts, honest about what they cannot say.
    if (arc !== null && arc.total > 0) {
      const fills = arc.groups.flatMap((group) =>
        new Array<string>(group.count).fill(blocColor(group.fraktion, mode, wahlperiode)),
      )
      return {
        seats: arc.seats.map((seat, index) => ({
          key: `${seat.position.row}-${seat.position.column}`,
          position: seat.position,
          // `?? seat.fill` falls back to the arc's own party colour. Unreachable
          // while the fills cover the arc, and the right answer if they ever do
          // not: an unset `fill` on a `<circle>` paints it black.
          fill: fills[index] ?? seat.fill,
        })),
        seatRadius: arc.seatRadius,
        total: arc.total,
        measured: isDerivableFromBlocs(mode),
      }
    }
    return null
  }, [seats, arc, mode, wahlperiode])

  // `undefined` from both queries is Convex still loading.
  if (drawing === null && arc === null) {
    return <Skeleton className={cn("aspect-[2/1.15] w-full rounded-xl", className)} />
  }

  // An empty roster is a real state (the pipeline has not run), and the honest
  // thing is a box that says so rather than an empty arc — which reads as a
  // Bundestag with no members in it.
  if (drawing === null) {
    return (
      <div
        className={cn(
          "flex aspect-[2/1.15] items-center justify-center rounded-xl border border-border/60 border-dashed p-6 text-center",
          className,
        )}
      >
        <p className="text-muted-foreground text-sm">{t("seating.empty")}</p>
      </div>
    )
  }

  const viewBox = hemicycleViewBox(drawing.seatRadius)
  const modeLabel = t(seatingMode(mode)?.labelKey ?? "seating.mode.party")

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      {/* `aria-hidden` for `SeatingPreview`'s reason: this is a picture of the
          same distribution the legend below spells out in words, so announcing
          635 unlabelled circles would repeat it without adding anything. The
          caption underneath carries the sentence. */}
      <svg
        aria-hidden="true"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="h-auto w-full"
      >
        {drawing.seats.map((seat, index) => (
          <circle
            key={seat.key}
            className="sitzung-seat"
            cx={seat.position.x}
            cy={seat.position.y}
            r={drawing.seatRadius}
            // An attribute rather than a class: it is a value from a table, not
            // a variant, and the CSS transition in globals.css animates it
            // either way.
            fill={seat.fill}
            style={
              {
                // From the dot's own centre, so a seat grows in place. Without
                // it every seat scales toward the SVG origin — the podium — and
                // the chamber inflates from the middle.
                transformOrigin: `${seat.position.x}px ${seat.position.y}px`,
                "--sitzung-seat-delay": `${Math.round(
                  (index / Math.max(1, drawing.total - 1)) * SEAT_ARRIVAL_MS,
                )}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </svg>

      {/* The shared legend, not a copy of it. This component carried its own —
          a second `Swatch` and a second set of mode branches, keyed on `mode
          ===` where the original keys on the declared `scale`, which is exactly
          the drift components/seating-legend.tsx warns about. `measured` was
          the only real difference and now lives there. */}
      <SeatingLegend
        mode={mode}
        fractionSizes={arc?.groups ?? []}
        measured={drawing.measured}
        size="sm"
      />

      {/* `figcaption` rather than an `aria-label` on the SVG: this is content a
          sighted reader wants too — it names the mode the chamber is currently
          wearing, which is the one thing the picture changes between chapters
          and cannot itself say. */}
      <figcaption className="text-muted-foreground text-xs tabular-nums">
        {t("homeB.chamberCaption", {
          count: formatCount(drawing.total, locale),
          mode: modeLabel,
        })}
        {drawing.measured ? null : (
          // Only on the degraded path, and said in the caption rather than only
          // in the legend — this is the sentence that stops a chamber of
          // neutral dots being read as a chamber of inactive members.
          <> — {t("seating.noScore")}</>
        )}
      </figcaption>
    </figure>
  )
}
