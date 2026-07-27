"use client"

import { Minus, Plus, RotateCcw } from "lucide-react"
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { SeatTooltip, type SeatTooltipData } from "@/components/seat-tooltip"
import { Button } from "@/components/ui/button"
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
 *
 * ## Hovering a seat, and why this is not `<Tooltip>`
 *
 * Each seat used to be its own Radix `Tooltip` root. It reported as broken —
 * the card appeared on *click*, which also navigated, so it flashed and was
 * gone — and the reason is structural rather than a missing handler:
 *
 *  - **630 tooltip roots share one `TooltipProvider`**, and the provider owns a
 *    single `isPointerInTransitRef`. Radix sets it while the pointer crosses
 *    the grace area between a trigger and its open content, and
 *    `TooltipTrigger`'s `onPointerMove` refuses to open while it is set. With
 *    seats a few pixels apart the pointer is *always* leaving one trigger as it
 *    enters the next, so the flag is set far more often than the design
 *    assumes and the hover open is skipped.
 *  - **Click still worked**, because `TooltipTrigger`'s `onFocus` calls
 *    `onOpen()` directly and bypasses the pointer path entirely. That is
 *    exactly the reported symptom: nothing on hover, a flash on click.
 *
 * So the map owns the hover itself. One card, one piece of state, and the
 * handlers live on the `<svg>` rather than on 630 elements — `pointerover`,
 * `pointerout`, `focusin` and `focusout` all bubble, so a single listener
 * covers every seat and the seat layer never re-renders as the pointer moves
 * across it. Each seat stays a real `<a>`, so middle-click, "open in new tab"
 * and Enter keep working, and the click still navigates.
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

/** How far the hover card sits from the pointer, and from the viewport edge it
 * would otherwise overhang. */
const CARD_OFFSET = 16

type HoverState = {
  seat: SeatingMapSeat
  /** Viewport coordinates. Read from the pointer (or from the focused seat's
   * box), so zoom and pan need no special handling — a `getBoundingClientRect`
   * is already post-transform. */
  x: number
  y: number
}

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
  const [hover, setHover] = useState<HoverState | null>(null)
  const dragState = useRef<{ pointerId: number; startX: number; startY: number } | null>(null)
  const tooltipId = useId()

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

  /**
   * The seat an event happened on, by the index stamped on its circle.
   *
   * `closest` rather than reading `event.target` directly: the target is the
   * `<circle>`, but a future child of the anchor (a label, a focus ring) would
   * be the target instead, and a lookup that only handles today's markup breaks
   * silently when that changes.
   */
  const seatAt = useCallback(
    (target: EventTarget | null): SeatingMapSeat | null => {
      if (!(target instanceof Element)) return null
      const element = target.closest("[data-seat-index]")
      if (element === null) return null
      const index = Number(element.getAttribute("data-seat-index"))
      return Number.isInteger(index) ? (placed[index]?.seat ?? null) : null
    },
    [placed],
  )

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
    // A drag is not a hover. Clearing here also covers the touch tap, where the
    // card would otherwise sit over the chamber until the next tap.
    setHover(null)
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

  /**
   * Pointer entering, moving within, and leaving a seat.
   *
   * `pointerover`/`pointerout` rather than `pointerenter`/`pointerleave`: only
   * the first pair bubbles, which is what lets one listener on the `<svg>`
   * serve every seat. The move handler tracks the card to the pointer *and*
   * covers the case where the pointer was already over a seat before this
   * component could listen — a re-render under a stationary cursor.
   *
   * Touch is skipped: a tap navigates, and a card that appears under the finger
   * on the way there covers the thing being tapped.
   */
  function handleSeatOver(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch" || dragState.current !== null) return
    const seat = seatAt(event.target)
    if (seat !== null) setHover({ seat, x: event.clientX, y: event.clientY })
  }

  function handleSeatMove(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch" || dragState.current !== null) return
    const seat = seatAt(event.target)
    if (seat !== null) setHover({ seat, x: event.clientX, y: event.clientY })
  }

  /**
   * Leaving a seat, or the chamber.
   *
   * `relatedTarget` is where the pointer went, so moving from one seat to its
   * neighbour is not treated as leaving — the `pointerover` on the new seat has
   * already replaced the card, and clearing here would blank it for a frame.
   * Null (`pointerout` off the document, or into a non-Element) means gone.
   */
  function handleSeatOut(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") return
    if (seatAt(event.relatedTarget) !== null) return
    setHover(null)
  }

  /**
   * Keyboard focus opens the same card.
   *
   * `focus`/`blur` are `focusin`/`focusout` in React, so they bubble and the
   * one listener on the `<svg>` covers all 630 anchors — the same reason the
   * pointer pair above is `over`/`out`.
   *
   * Positioned from the seat's own box rather than from a pointer that may be
   * somewhere else entirely, and `aria-describedby` is set on the focused
   * anchor so a screen reader reads the figures rather than only "Sitz von X,
   * Link". Set imperatively because the alternative is a prop on every seat,
   * which would re-render all 630 on every focus move — the exact cost the
   * memoised layer below exists to avoid.
   */
  function handleSeatFocus(event: React.FocusEvent<SVGSVGElement>) {
    const seat = seatAt(event.target)
    if (seat === null) return
    const anchor = (event.target as Element).closest("[data-seat-index]")
    if (anchor === null) return
    anchor.setAttribute("aria-describedby", tooltipId)
    const box = anchor.getBoundingClientRect()
    setHover({ seat, x: box.left + box.width / 2, y: box.bottom })
  }

  function handleSeatBlur(event: React.FocusEvent<SVGSVGElement>) {
    const anchor = (event.target as Element).closest?.("[data-seat-index]")
    anchor?.removeAttribute("aria-describedby")
    setHover(null)
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
            onPointerOver={handleSeatOver}
            onPointerMove={handleSeatMove}
            onPointerOut={handleSeatOut}
            onFocus={handleSeatFocus}
            onBlur={handleSeatBlur}
          >
            <title>{t("seating.mapLabel")}</title>
            <SeatLayer
              placed={placed}
              radius={layout.seatRadius}
              maxima={maxima}
              mode={mode}
              wahlperiode={wahlperiode}
            />
          </svg>
        </div>
      </div>

      {/* Outside the panned wrapper, deliberately. A `transform` makes an
          ancestor the containing block for `position: fixed`, so a card
          rendered inside it would be positioned against the transformed box and
          then clipped by that wrapper's `overflow-hidden`. Out here it is
          positioned against the viewport, which is what its coordinates are. */}
      {hover !== null && <SeatHoverCard id={tooltipId} hover={hover} mode={mode} />}
    </div>
  )
}

/**
 * Every seat, drawn once.
 *
 * `memo` is load-bearing rather than a precaution: hovering updates state in the
 * parent, and without this all 630 anchors would re-render on every pointer
 * move across the chamber. Its props are the layout and the colour inputs, none
 * of which change while the pointer moves, so the layer renders when the arc or
 * the colour mode changes and at no other time.
 */
const SeatLayer = memo(function SeatLayer({
  placed,
  radius,
  maxima,
  mode,
  wahlperiode,
}: {
  placed: ReadonlyArray<{ seat: SeatingMapSeat; position: { x: number; y: number } }>
  radius: number
  maxima: ReturnType<typeof seatingMaxima>
  mode: SeatingColorMode
  wahlperiode: number
}) {
  const { t } = useLocale()

  return (
    <>
      {placed.map(({ seat, position }, index) => (
        /**
         * An `<a>` rather than a circle carrying `role="button"`. A seat
         * *navigates*, so a link is what it is — and being one for real is what
         * gives it middle-click, "open in new tab", a status-bar preview and
         * Enter, none of which a scripted button reimplements for free.
         * `next/link` does not accept SVG children, so this is a plain anchor
         * inside the SVG; the route is a normal href either way.
         *
         * This is a deliberate departure from `activity-heatmap.tsx`, where 365
         * cells are `role="img"` and *not* focusable: those cells are
         * read-only, so focus stops would be 365 dead ends between the graph
         * and the next link. Here every seat goes somewhere, so it must be
         * reachable without a mouse.
         *
         * `data-seat-index` is how the one listener on the `<svg>` finds which
         * seat an event came from — see `seatAt`.
         */
        <a
          key={seat.mpInternalId}
          data-seat-index={index}
          href={`/mps/${seat.mpInternalId}`}
          aria-label={t("seating.seatOf", { name: seat.name })}
          className="outline-none [&>circle]:hover:stroke-foreground [&>circle]:focus-visible:stroke-foreground"
        >
          <circle
            cx={position.x}
            cy={position.y}
            r={radius}
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
            className="cursor-pointer"
            // Stroke in user units, so the highlight keeps its weight relative
            // to the dot at every zoom level rather than thickening as you zoom.
            strokeWidth={radius * 0.35}
            stroke="transparent"
            paintOrder="stroke"
          />
        </a>
      ))}
    </>
  )
})

/**
 * The card that follows the pointer.
 *
 * A popover surface (`bg-popover`) rather than the inverted one `TooltipContent`
 * uses. This is not a one-line hint: it carries a portrait, a group badge and
 * three figures, and `SeatTooltip` renders its labels in `text-muted-foreground`
 * — a token defined against `--background`, which on the inverted surface came
 * out as low-contrast grey on near-black. On the popover surface those tokens
 * mean what they were defined to mean.
 *
 * `pointer-events-none` so the card can never sit between the pointer and the
 * seat it describes. That is also why there is no grace area to cross and none
 * of the transit bookkeeping the Radix version needed.
 */
function SeatHoverCard({
  id,
  hover,
  mode,
}: {
  id: string
  hover: HoverState
  mode: SeatingColorMode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState({
    left: hover.x + CARD_OFFSET,
    top: hover.y + CARD_OFFSET,
  })

  /**
   * Keeps the card inside the viewport.
   *
   * Measured rather than assumed: the card's height depends on whether the seat
   * has a constituency line and on how long the group's name is, so a fixed
   * offset would push it off the bottom for some seats and not others.
   * `useLayoutEffect` so the correction lands before paint — in an effect the
   * card would be visible for one frame at the unclamped position, which reads
   * as a jump.
   */
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const { width, height } = element.getBoundingClientRect()

    // Flip to the other side of the pointer when the preferred side overhangs,
    // then clamp — flipping alone is not enough for a pointer near a corner.
    let left = hover.x + CARD_OFFSET
    if (left + width > window.innerWidth - CARD_OFFSET) left = hover.x - width - CARD_OFFSET
    left = Math.max(CARD_OFFSET, Math.min(left, window.innerWidth - width - CARD_OFFSET))

    let top = hover.y + CARD_OFFSET
    if (top + height > window.innerHeight - CARD_OFFSET) top = hover.y - height - CARD_OFFSET
    top = Math.max(CARD_OFFSET, Math.min(top, window.innerHeight - height - CARD_OFFSET))

    setPlacement({ left, top })
  }, [hover])

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
      style={{ left: placement.left, top: placement.top }}
    >
      <SeatTooltip seat={hover.seat} mode={mode} />
    </div>
  )
}
