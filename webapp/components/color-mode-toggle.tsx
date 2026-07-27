"use client"

import { useLocale } from "@/components/providers/locale-provider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isSeatingColorMode, SEATING_MODES, type SeatingColorMode } from "@/lib/seating"
import { useOverflowEdges } from "@/lib/use-overflow-edges"
import { cn } from "@/lib/utils"

/**
 * Picks what the seating map colours by.
 *
 * Renders `SEATING_MODES` (lib/seating.ts) rather than listing the modes here,
 * so the toggle, the legend and the map read one table. A mode added there
 * appears in all three at once; listing them per component is how a mode ends up
 * selectable but unlabelled in the legend.
 *
 * ## Tabs, because this is the same control the rankings already use
 *
 * `components/rankings.tsx` switches between nine leaderboards with `Tabs`, and
 * this is that interaction exactly: one exclusive choice, applied immediately, to
 * the view below it. A hand-rolled `role="radiogroup"` would be a second answer
 * to a question this codebase has already answered — and a worse one, since Radix
 * brings the roving tabindex, arrow-key navigation and focus management that a
 * bespoke version has to reimplement and then keep working.
 *
 * Deliberately *not* `components/filter-chips.tsx`, which looks similar and means
 * something different: chips are independent toggles where several can be on and
 * "none" means "everything". A chamber is coloured one way at a time, so "none
 * selected" is not a state this control can be in.
 */
export function ColorModeToggle({
  value,
  onChange,
  className,
}: {
  value: SeatingColorMode
  onChange: (next: SeatingColorMode) => void
  className?: string
}) {
  const { t } = useLocale()
  // Same strip as the rankings' nine boards. These five fit from `sm` up, so
  // the fade appears only on a phone — which is exactly why the hook measures
  // rather than keying on a breakpoint. See lib/use-overflow-edges.ts.
  const tabStrip = useOverflowEdges<HTMLDivElement>()

  return (
    // `min-w-0` is what makes the `overflow-x-auto` below actually work. A flex
    // item's `min-width` is `auto`, so this wrapper refused to shrink past the
    // five tab labels' combined width and the scroll container never got narrow
    // enough to need scrolling — instead it pushed /seating to 686 px inside a
    // 375 px viewport and the whole page scrolled sideways, seating map and all.
    // The scroll affordance was written for this case (see the note on
    // `TabsList` below) and was simply unreachable.
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span id="seating-color-mode-label" className="font-medium text-muted-foreground text-xs">
        {t("seating.colorMode")}
      </span>
      <Tabs
        value={value}
        // Radix hands back a plain string; the guard is what keeps this
        // component's contract to `SeatingColorMode` honest rather than casting.
        onValueChange={(next) => {
          if (isSeatingColorMode(next)) onChange(next)
        }}
      >
        {/* Scrolls rather than wraps, as the rankings' nine tabs do: five mode
            names wrapped to two rows on a phone push the map below the fold.
            `scroll-strip` is that same shared behaviour — no visible scrollbar,
            snapping to whole tabs, and a fade on whichever edge still has modes
            beyond it. Defined once in app/globals.css so this strip and the
            rankings' cannot drift into scrolling differently. */}
        <TabsList
          ref={tabStrip.ref}
          data-overflow={tabStrip.dataOverflow}
          aria-labelledby="seating-color-mode-label"
          className="scroll-strip w-full justify-start"
        >
          {SEATING_MODES.map((mode) => (
            <TabsTrigger
              key={mode.id}
              value={mode.id}
              className="scroll-strip-item shrink-0 whitespace-nowrap"
            >
              {t(mode.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
