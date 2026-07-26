"use client"

import { Minus, Plus, RotateCcw } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { SeatTooltip, type SeatTooltipData } from "@/components/seat-tooltip"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { layoutHemicycle, type SeatingColorMode, seatColor, seatingMaxima } from "@/lib/seating"
import { cn } from "@/lib/utils"

/**
 * The hemicycle itself.
 *
 * ## The coordinates are recomputed, not stored
 *
 * `getSeatingWithMPs` returns each seat's `(row, column)`; this lays out the same
 * seat count with `layoutHemicycle` and matches on that pair. Storing `x`/`y`
 * would freeze the arc's shape into the database, so changing the geometry would
 * need a migration and a regeneration rather than a deploy — and the stored
 * coordinates of a chamber whose roster has since changed would be wrong in a way
 * nothing checks. The layout is deterministic in the seat count alone (see
 * `layoutHemicycle`), which is what makes recomputing safe.
 *
 * A seat whose `(row, column)` is not in the layout is dropped rather than
 * drawn at the origin — that only happens when the stored arc and the roster
 * disagree, and a dot piled at the centre of the chamber would be a rendering
 * artefact indistinguishable from a real seat.
 *
 * ## Why plain SVG and not a chart library
 *
 * 630 circles with one `fill` each. A charting dependency would bring an axis and
 * scale model this has no use for, and the one hard part — the arc — is
 * lib/seating.ts, which is testable precisely because it is not entangled with
 * rendering.
 *
 * ## Zoom and pan
 *
 * A CSS `transform` on a wrapper, not a mutated `viewBox`. Transforms are
 * composited, so a drag does not re-layout 630 nodes per frame; and the seat
 * radius stays in user units, so dots keep their relative size and the arc scales
 * as a picture rather than reflowing. `touch-action: none` is what stops a phone
 * scrolling the page while panning.
 */

export type SeatingMapSeat = SeatTooltipData & {
  mpInternalId: string
  row: number | null
  column: number | null
  fraktion: string
}

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const ZOOM_STEP = 1.4

export function SeatingMap({
  seats,
  mode,
  wahlperiode,
  className,
}: {
  seats: readonly SeatingMapSeat[]
  mode: SeatingColorMode
  wahlperiode: number
  className?: string
}) {
  const { t } = useLocale()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragState = useRef<{ pointerId: number; startX: number; startY: number } | null>(null)

  const layout = useMemo(() => layoutHemicycle(seats.length), [seats.length])
  const maxima = useMemo(() => seatingMaxima(seats), [seats])

  /** Seats paired with their position, by `(row, column)`. A map rather than an
   * index lookup because the query's sort and the layout's are different orders
   * — see the note on `layoutHemicycle`. */
  const placed = useMemo(() => {
    const byKey = new Map(
      layout.positions.map((position) => [`${position.row}-${position.column}`, position]),
    )
    return seats.flatMap((seat) => {
      const position = byKey.get(`${seat.row}-${seat.column}`)
      return position ? [{ seat, position }] : []
    })
  }, [seats, layout])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  /** Zoom about the centre. Resets the pan on the way back to 1 so a zoomed-out
   * chamber cannot end up parked off-screen with no way back but the button. */
  const zoomBy = useCallback((factor: number) => {
    setZoom((current) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor))
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  }, [])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Only pan when there is something to pan to.
    if (zoom <= MIN_ZOOM) return
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX - pan.x,
      startY: event.clientY - pan.y,
    }
    // Capture, so a drag that leaves the element still finishes here rather
    // than sticking on until the next click.
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan({ x: event.clientX - drag.startX, y: event.clientY - drag.startY })
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId !== event.pointerId) return
    dragState.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label={t("seating.zoomIn")}
          disabled={zoom >= MAX_ZOOM}
        >
          <Plus />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label={t("seating.zoomOut")}
          disabled={zoom <= MIN_ZOOM}
        >
          <Minus />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={resetView}
          aria-label={t("seating.resetView")}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
        >
          <RotateCcw />
        </Button>
      </div>

      {/* The pointer handlers pan the view and nothing else — a pure
          enhancement over a diagram that is already fully usable without them:
          every seat is a real link and the zoom controls above are buttons. */}
      <div
        className="overflow-hidden rounded-lg border border-border bg-card"
        style={{ touchAction: "none", cursor: zoom > MIN_ZOOM ? "grab" : "default" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            // No transition on the pan, or the drag lags the pointer.
            transition: dragState.current ? "none" : "transform 150ms ease-out",
          }}
        >
          {/* `<title>` is the accessible name here — an SVG with one is exposed
              as a labelled graphic, so `role="group"` with an `aria-label`
              would be restating in ARIA what the markup already says. */}
          <svg
            viewBox={`${layout.viewBox.x} ${layout.viewBox.y} ${layout.viewBox.width} ${layout.viewBox.height}`}
            className="h-auto w-full"
          >
            <title>{t("seating.mapLabel")}</title>
            {placed.map(({ seat, position }) => (
              <Seat
                key={seat.mpInternalId}
                seat={seat}
                cx={position.x}
                cy={position.y}
                r={layout.seatRadius}
                fill={seatColor(
                  {
                    fraktion: seat.fraktion,
                    totalScore: seat.totalScore,
                    voteParticipationRate: seat.voteParticipationRate,
                    committeeCount: seat.committeeCount,
                  },
                  mode,
                  wahlperiode,
                  maxima,
                )}
                mode={mode}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}

/**
 * One seat: a link to an MP's profile, shaped like a circle.
 *
 * An `<a>` rather than a circle carrying `role="button"`. A seat *navigates*, so
 * a link is what it is — and being one for real is what gives it middle-click,
 * "open in new tab", a status-bar preview and Enter, none of which a scripted
 * button reimplements for free. `next/link` does not accept SVG children, so
 * this is a plain anchor inside the SVG; the route is a normal href either way.
 *
 * This is a deliberate departure from `activity-heatmap.tsx`, where 365 cells
 * are `role="img"` and *not* focusable: those cells are read-only, so focus
 * stops would be 365 dead ends between the graph and the next link. Here every
 * seat goes somewhere, so it must be reachable without a mouse.
 *
 * The accessible name carries the MP's name, so a screen reader announces whose
 * seat it is rather than "link".
 */
function Seat({
  seat,
  cx,
  cy,
  r,
  fill,
  mode,
}: {
  seat: SeatingMapSeat
  cx: number
  cy: number
  r: number
  fill: string
  mode: SeatingColorMode
}) {
  const { t } = useLocale()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={`/mps/${seat.mpInternalId}`}
          aria-label={t("seating.seatOf", { name: seat.name })}
          className="outline-none [&>circle]:hover:stroke-foreground [&>circle]:focus-visible:stroke-foreground"
        >
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={fill}
            className="cursor-pointer"
            // Stroke in user units, so the highlight keeps its weight relative
            // to the dot at every zoom level rather than thickening as you zoom.
            strokeWidth={r * 0.35}
            stroke="transparent"
            paintOrder="stroke"
          />
        </a>
      </TooltipTrigger>
      <TooltipContent>
        <SeatTooltip seat={seat} mode={mode} />
      </TooltipContent>
    </Tooltip>
  )
}
