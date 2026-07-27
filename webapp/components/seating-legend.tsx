"use client"

import { useMemo } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { partyColor, partyFor, partyLabel } from "@/lib/parties"
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
 */
export function SeatingLegend({
  mode,
  /** Group counts for the party legend, largest first — `getFractionSizes`'
   * output. Only the party mode uses them; the others have no per-value tally to
   * show. */
  fractionSizes,
  className,
}: {
  mode: SeatingColorMode
  fractionSizes: ReadonlyArray<{ fraktion: string; count: number }>
  className?: string
}) {
  const { t } = useLocale()
  const definition = seatingMode(mode)

  /**
   * Counts folded onto one entry per *party*, not per stored string.
   *
   * `getFractionSizes` groups by `mps.fraktion` verbatim, and the sources do not
   * agree on spelling — a real deployment answered with both `Fraktionslos` and
   * `fraktionslos` as separate rows, which rendered as two legend entries in the
   * same colour with the seats split between them. §6.4 and §5.2 catalogue the
   * rest (the long Stammdaten legal form, `BÜ90/GR`, a non-breaking space in the
   * protocol XML), so this is the rule and not the exception.
   *
   * Folding through `partyFor` is what makes the legend agree with the map,
   * which colours the same seats through `partyColor` and so had already merged
   * them. Insertion order is preserved, and the query sorts by size, so the
   * largest group still leads.
   */
  const byParty = useMemo(() => {
    const merged = new Map<string, { fraktion: string; count: number }>()
    for (const entry of fractionSizes) {
      const key = partyFor(entry.fraktion).key
      const existing = merged.get(key)
      if (existing) existing.count += entry.count
      else merged.set(key, { fraktion: entry.fraktion, count: entry.count })
    }
    return [...merged.values()]
  }, [fractionSizes])

  if (definition?.scale === "categorical") {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
        {mode === "party"
          ? byParty.map((entry) => (
              <Swatch
                key={entry.fraktion}
                color={partyColor(entry.fraktion)}
                label={partyLabel(entry.fraktion)}
                // The one genuinely official number on this page (§9: the
                // distribution is derivable, the assignment is not), so it is
                // shown rather than left to the tooltip.
                count={entry.count}
              />
            ))
          : (
              // The colours come from `coalitionColor`, not from literals
              // repeated here. They were literals, and they were the two the map
              // happened to use at the time — so changing the map's palette
              // silently left the legend naming the old colours, which is the
              // one bug a legend can have that makes the chart actively
              // misleading rather than merely plain.
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
            ).map((entry) => <Swatch key={entry.key} color={entry.color} label={entry.label} />)}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span>{t("seating.legendLow")}</span>
        {seatingRamp().map((color) => (
          <span
            key={color}
            aria-hidden="true"
            className="size-3 rounded-[3px] ring-1 ring-foreground/10"
            style={{ backgroundColor: color }}
          />
        ))}
        <span>{t("seating.legendHigh")}</span>
      </div>
      <Swatch color={NO_DATA_COLOR} label={t("seating.noScore")} />
    </div>
  )
}

function Swatch({ color, label, count }: { color: string; label: string; count?: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-[3px] ring-1 ring-foreground/10"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      {count !== undefined && <span className="font-medium tabular-nums">{count}</span>}
    </span>
  )
}
