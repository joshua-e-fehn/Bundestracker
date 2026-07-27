"use client"

import { useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCount } from "@/lib/format"
import { type FractionSize, partyColor, partyLabel } from "@/lib/parties"
import {
  buildFractionArc,
  coalitionColor,
  coalitionRole,
  hemicycleViewBox,
  layoutHemicycle,
  MAX_DECORATIVE_SEAT_RADIUS,
  NO_DATA_COLOR,
  type SeatColorInput,
  type SeatingColorMode,
  seatColor,
  seatingMaxima,
  seatingMode,
  seatingRamp,
  seatingRank,
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
 * It is still the *same* picture. `layoutHemicycle` places the seats and
 * `seatColor` fills them — both from lib/seating.ts, both shared with /seating —
 * so a reader who has seen the full map recognises this one, and a change to the
 * palette or the geometry cannot reach one without the other.
 *
 * ## Two data sources, and why the fallback is not the plan
 *
 * The chapters colour the chamber five ways, and three of those — activity,
 * attendance, committee work — are *per MP*. Bloc counts cannot answer them:
 * `getFractionSizes` returns `{ fraktion, count }`, so a chamber drawn from it
 * knows which group a dot belongs to and nothing else.
 *
 * The first version of this component drew from bloc counts alone and rendered
 * those three modes in the no-data neutral. That is defensible in the abstract —
 * inventing a ramp would be far worse, and `seatingLevel` returns null rather
 * than 0 for exactly this reason — but it was wrong in practice: the deployment
 * *has* the per-seat data (635 seats, 634 scored), so three of the five chapters
 * greyed themselves out while the figures sat one query away. A caveat about
 * missing data is only honest when the data is actually missing.
 *
 * So this takes `seats` — `getSeatingWithMPs`, the same query /seating uses —
 * and falls back to the bloc arc only while that is loading or genuinely absent
 * (a deployment with a roster but no generated seating rows is a real state; see
 * the empty state in components/seating.tsx). The fallback still refuses to
 * invent a ramp, and the legend still names the neutral, so the honest-but-grey
 * rendering survives as the *degraded* path rather than as the design.
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
 * continuous modes read. Deliberately `SeatColorInput` plus the arc key, so a
 * caller passes `getSeatingWithMPs` rows through with no reshaping beyond the
 * null-handling that query's own header describes. */
export type ChamberSeat = SeatColorInput & {
  row: number | null
  column: number | null
}

/** One dot, ready to draw. */
type PlacedSeat = {
  key: string
  x: number
  y: number
  fill: string
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
   * and falls back to the bloc drawing below. */
  seats: readonly ChamberSeat[] | undefined
  /** Bloc counts — `getFractionSizes`. Drives the party legend in every mode,
   * and the whole picture when `seats` is unavailable. */
  fractionSizes: ReadonlyArray<FractionSize> | undefined
  mode: SeatingColorMode
  wahlperiode: number
  className?: string
}) {
  const { t, locale } = useLocale()

  /** The bloc arc: the fallback drawing, and the source of the party legend's
   * counts in every mode. */
  const arc = useMemo(() => buildFractionArc(fractionSizes, MAX_CHAMBER_SEATS), [fractionSizes])

  /**
   * The real chamber, when there is one.
   *
   * The seats are sorted into the same left-to-right political order the arc
   * uses and then paired with `layoutHemicycle`'s positions by index — rather
   * than matched on the stored `(row, column)` as components/seating-map.tsx
   * does. The two agree whenever the stored arc and the roster agree, and this
   * ordering degrades better when they do not: the map drops an unmatched seat
   * (correct there, where a dot is a link to a named MP), while here a dropped
   * dot would be a hole in a decorative picture. Sorting guarantees every seat
   * lands somewhere sensible even mid-regeneration.
   */
  const placed = useMemo((): PlacedSeat[] | null => {
    if (seats === undefined || seats.length === 0) return null

    const ordered = [...seats].sort(
      (a, b) =>
        seatingRank(a.fraktion) - seatingRank(b.fraktion) ||
        // Stable within a bloc, so the arc does not reshuffle between renders.
        // `(row, column)` is what the generator assigned; nulls sort last.
        (a.row ?? Number.MAX_SAFE_INTEGER) - (b.row ?? Number.MAX_SAFE_INTEGER) ||
        (a.column ?? 0) - (b.column ?? 0),
    )
    const layout = layoutHemicycle(ordered.length)
    // Over the seats actually on screen, so the busiest member defines the top
    // of the ramp — `seatingMaxima`'s own contract, and what stops a chamber
    // nobody has scored from painting everyone at full intensity. The radius is
    // not computed here: `geometry` below owns it for both drawing paths.
    const maxima = seatingMaxima(ordered)

    return ordered.map((seat, index) => {
      const position = layout.positions[index]
      return {
        key: `${position.row}-${position.column}`,
        x: position.x,
        y: position.y,
        // The shared function, so a seat is the same colour here as on
        // /seating — including its null handling, which is what keeps
        // "unscored" visually distinct from "scored zero".
        fill: seatColor(seat, mode, wahlperiode, maxima),
      }
    })
  }, [seats, mode, wahlperiode])

  /** The radius and box for whichever drawing is in use. Recomputed from the
   * capped radius — see `hemicycleViewBox` for why the layout's own box is
   * wrong once the radius is clamped. */
  const geometry = useMemo(() => {
    const count = placed?.length ?? arc?.total ?? 0
    if (count === 0) return null
    const radius = Math.min(layoutHemicycle(count).seatRadius, MAX_DECORATIVE_SEAT_RADIUS)
    return { radius, viewBox: hemicycleViewBox(radius) }
  }, [placed, arc])

  /**
   * The fallback fills: bloc colours where the mode allows, the no-data neutral
   * where it does not.
   *
   * Only reached while `getSeatingWithMPs` is unavailable. It walks the ordered
   * blocs once and asks per group rather than per dot — six calls, not 630 —
   * and it refuses to invent a value for the continuous modes, which is the
   * whole reason this path is allowed to exist at all.
   */
  const fallbackFills = useMemo(() => {
    if (arc === null) return []
    const derivable = mode === "party" || mode === "coalition"
    const out: string[] = []
    for (const group of arc.groups) {
      const color = derivable
        ? mode === "party"
          ? partyColor(group.fraktion)
          : coalitionColor(coalitionRole(group.fraktion, wahlperiode))
        : NO_DATA_COLOR
      for (let seat = 0; seat < group.count && out.length < arc.total; seat++) out.push(color)
    }
    return out
  }, [arc, mode, wahlperiode])

  if (arc === null && placed === null) {
    return <Skeleton className={cn("aspect-[2/1.15] w-full rounded-xl", className)} />
  }

  // An empty roster is a real state (the pipeline has not run), and the honest
  // thing is a box that says so rather than an empty arc — which reads as a
  // Bundestag with no members in it.
  if (geometry === null) {
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

  const definition = seatingMode(mode)
  const modeLabel = t(definition?.labelKey ?? "seating.mode.party")
  const total = placed?.length ?? arc?.total ?? 0
  /** Whether the colours on screen carry the mode's real meaning. False only on
   * the fallback path for a continuous mode, which is what the caption then has
   * to say out loud. */
  const measured = placed !== null || mode === "party" || mode === "coalition"

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      {/* `aria-hidden` for `SeatingPreview`'s reason: this is a picture of the
          same distribution the legend below spells out in words, so announcing
          635 unlabelled circles would repeat it without adding anything. The
          caption underneath carries the sentence. */}
      <svg
        aria-hidden="true"
        viewBox={`${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`}
        className="h-auto w-full"
      >
        {(
          placed ??
          (arc?.seats ?? []).map((seat, index) => ({
            key: `${seat.position.row}-${seat.position.column}`,
            x: seat.position.x,
            y: seat.position.y,
            fill: fallbackFills[index] ?? seat.fill,
          }))
        ).map((seat, index) => (
          <circle
            key={seat.key}
            className="sitzung-seat"
            cx={seat.x}
            cy={seat.y}
            r={geometry.radius}
            // An attribute rather than a class: it is a value from a table, not
            // a variant, and the CSS transition in globals.css animates it
            // either way.
            fill={seat.fill}
            style={
              {
                // From the dot's own centre, so a seat grows in place. Without
                // it every seat scales toward the SVG origin — the podium — and
                // the chamber inflates from the middle.
                transformOrigin: `${seat.x}px ${seat.y}px`,
                "--sitzung-seat-delay": `${Math.round(
                  (index / Math.max(1, total - 1)) * SEAT_ARRIVAL_MS,
                )}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </svg>

      {/* The legend. A categorical mode gets its swatches; a continuous one gets
          the ramp *and* the no-data shade named — the latter is not optional,
          for components/seating-legend.tsx's stated reason: without it the
          neutral dots are unexplained and a reader's only available reading is
          "the lowest bucket", which is the exact claim `seatingLevel` returns
          null to avoid making. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {mode === "party" ? (
          (arc?.groups ?? []).map((group) => (
            <Swatch
              key={group.fraktion}
              color={partyColor(group.fraktion)}
              label={partyLabel(group.fraktion)}
              count={formatCount(group.count, locale)}
            />
          ))
        ) : mode === "coalition" ? (
          <>
            <Swatch color={coalitionColor("government")} label={t("seating.government")} />
            <Swatch color={coalitionColor("opposition")} label={t("seating.opposition")} />
            <Swatch color={NO_DATA_COLOR} label={t("seating.coalitionUnknown")} />
          </>
        ) : (
          <>
            {/* Dimmed on the fallback path: the ramp is what this colouring
                *would* use, and showing the scale beside the neutral makes
                "not shown here" legible as a gap rather than as the absence of
                any scale at all. */}
            <span
              className={cn(
                "flex items-center gap-1.5 text-muted-foreground text-xs",
                measured ? null : "opacity-40",
              )}
            >
              <span>{t("seating.legendLow")}</span>
              {seatingRamp().map((color) => (
                <span
                  key={color}
                  aria-hidden="true"
                  className="size-2.5 rounded-[3px]"
                  style={{ backgroundColor: color }}
                />
              ))}
              <span>{t("seating.legendHigh")}</span>
            </span>
            <Swatch color={NO_DATA_COLOR} label={t("seating.noScore")} />
          </>
        )}
      </div>

      {/* `figcaption` rather than an `aria-label` on the SVG: this is content a
          sighted reader wants too — it names the mode the chamber is currently
          wearing, which is the one thing the picture changes between chapters
          and cannot itself say. */}
      <figcaption className="text-muted-foreground text-xs tabular-nums">
        {t("homeB.chamberCaption", { count: formatCount(total, locale), mode: modeLabel })}
        {measured ? null : (
          // Only on the degraded path, and said in the caption rather than only
          // in the legend — this is the sentence that stops a chamber of
          // neutral dots being read as a chamber of inactive members.
          <> — {t("seating.noScore")}</>
        )}
      </figcaption>
    </figure>
  )
}

function Swatch({ color, label, count }: { color: string; label: string; count?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      {label}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  )
}
