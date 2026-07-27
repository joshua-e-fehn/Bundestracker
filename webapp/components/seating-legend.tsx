"use client"

import { useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { foldFractionSizes, partyColor, partyLabel } from "@/lib/parties"
import {
  coalitionColor,
  NO_DATA_COLOR,
  type SeatingColorMode,
  seatingMode,
  seatingRamp,
} from "@/lib/seating"
import { cn } from "@/lib/utils"

/**
 * The key to the chamber's colours.
 *
 * Two shapes, chosen by the mode's declared `scale` rather than by its id: a
 * categorical mode needs one swatch per value, a continuous one needs a ramp with
 * a low-to-high axis. Reading `scale` from `SEATING_MODES` (lib/seating.ts) is
 * what lets a new mode arrive with the right legend instead of falling through to
 * whichever branch was written last.
 *
 * ## The no-data swatch is not optional
 *
 * Every continuous mode ends with a `NO_DATA_COLOR` swatch labelled "no score
 * computed". Without it the neutral dots in the chamber are unexplained, and a
 * reader's only available reading is "the lowest bucket" — which is the exact
 * claim `seatingLevel` returns null to avoid making. The legend is where that
 * distinction becomes visible rather than merely encoded.
 *
 * ## `measured` is the second consumer's one addition
 *
 * /home-b's chamber draws from bloc counts while its per-seat query is in
 * flight, and bloc counts cannot answer a continuous mode (see
 * `isDerivableFromBlocs`). Its ramp is therefore showing a scale nothing on
 * screen is currently using, so it is dimmed — the scale stays visible, which is
 * what makes "not shown here" read as a gap rather than as the absence of any
 * scale at all.
 *
 * That component first carried its own copy of this legend, complete with a
 * second `Swatch` and a second set of mode branches — and the copy branched on
 * `mode ===` where this one branches on the declared `scale`, which is exactly
 * the drift the note above warns about. One flag was the whole difference, so
 * the flag is here and the copy is gone.
 */
export function SeatingLegend({
  mode,
  /** Group counts for the party legend, largest first — `getFractionSizes`'
   * output. Only the party mode uses them; the others have no per-value tally to
   * show. */
  fractionSizes,
  /** Whether the colours on screen carry this mode's real meaning. False dims
   * the ramp — see the note above. Defaults to true, so /seating, which always
   * has the per-seat values, does not have to say so. */
  measured = true,
  /** Size of the swatches. The narrative chamber sits in a 22 rem column beside
   * body copy and wants the legend to read as a caption; /seating gives it a
   * full-width row under a diagram. Two sizes rather than two components. */
  size = "md",
  className,
}: {
  mode: SeatingColorMode
  fractionSizes: ReadonlyArray<{ fraktion: string; count: number }>
  measured?: boolean
  size?: "sm" | "md"
  className?: string
}) {
  const { t } = useLocale()
  const definition = seatingMode(mode)

  /**
   * Counts folded onto one entry per *party*, not per stored string.
   *
   * The fold now lives in `foldFractionSizes` (lib/parties.ts) rather than here,
   * because it was here *and nowhere else*: components/seating-preview.tsx built
   * the home page's legend from the raw strings and so rendered "Fraktionslos 1"
   * beside "Fraktionslos 3" while this one correctly showed 4. One rule, one
   * home — see that function for why the spellings differ at all.
   */
  const byParty = useMemo(() => foldFractionSizes(fractionSizes), [fractionSizes])

  if (definition?.scale === "categorical") {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
        {mode === "party"
          ? byParty.map((entry) => (
              <Swatch
                key={entry.fraktion}
                color={partyColor(entry.fraktion)}
                label={partyLabel(entry.fraktion)}
                size={size}
                // The one genuinely official number on this page (§9: the
                // distribution is derivable, the assignment is not), so it is
                // shown rather than left to the tooltip.
                count={entry.count}
              />
            ))
          : // The colours come from `coalitionColor`, not from literals
            // repeated here. They were literals, and they were the two the map
            // happened to use at the time — so changing the map's palette
            // silently left the legend naming the old colours, which is the
            // one bug a legend can have that makes the chart actively
            // misleading rather than merely plain.
            (
              [
                {
                  key: "government",
                  color: coalitionColor("government"),
                  label: t("seating.government"),
                },
                {
                  key: "opposition",
                  color: coalitionColor("opposition"),
                  label: t("seating.opposition"),
                },
                // Shown always, not only when a seat needs it: its absence would
                // be the reader's only clue that a period's coalition is
                // unrecorded, and an absent thing explains nothing.
                {
                  key: "unknown",
                  color: NO_DATA_COLOR,
                  label: t("seating.coalitionUnknown"),
                },
              ] as const
            ).map((entry) => (
              <Swatch key={entry.key} color={entry.color} label={entry.label} size={size} />
            ))}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <div
        className={cn(
          "flex items-center gap-1.5 text-muted-foreground text-xs",
          // Dimmed, not hidden: the scale is what this mode *would* use, and
          // showing it beside the neutral is what makes the gap legible.
          measured ? null : "opacity-40",
        )}
      >
        <span>{t("seating.legendLow")}</span>
        {seatingRamp().map((color) => (
          <span
            key={color}
            aria-hidden="true"
            className={cn(SWATCH_SIZE[size], "rounded-[3px] ring-1 ring-foreground/10")}
            style={{ backgroundColor: color }}
          />
        ))}
        <span>{t("seating.legendHigh")}</span>
      </div>
      <Swatch color={NO_DATA_COLOR} label={t("seating.noScore")} size={size} />
    </div>
  )
}

/** The two swatch sizes. A table rather than a ternary at each of the four call
 * sites, so the sizes cannot drift apart between the ramp and the swatches. */
const SWATCH_SIZE = { sm: "size-2.5", md: "size-3" } as const

function Swatch({
  color,
  label,
  count,
  size = "md",
}: {
  color: string
  label: string
  count?: number
  size?: "sm" | "md"
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className={cn(SWATCH_SIZE[size], "shrink-0 rounded-[3px] ring-1 ring-foreground/10")}
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      {count !== undefined && <span className="font-medium tabular-nums">{count}</span>}
    </span>
  )
}
