"use client"

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A structural limit of the sources, stated beside the figure it qualifies.
 *
 * This is the most-repeated element on the site, and it repeats because of a
 * deliberate editorial rule rather than a layout habit: a caveat here is a case
 * where a low number means "not published" rather than "did not happen"
 * (docs/api-research.md §4.4, §5.2, §6.4), so it renders next to the number
 * instead of under an "about" link. Nine components had the same twelve classes
 * inline — `Leaderboard.caveatKey`, `SeatingMode.caveatKey`,
 * `TrendChart.caveatKey` and `PartyMetric.caveatKey` all exist to carry one to
 * exactly this box, and components/trend-graphs.tsx had already extracted a
 * private `Note` for its own two.
 *
 * One component so the boxes cannot drift apart. That matters more than it
 * sounds: these sit on five different pages, and a reader who learns to
 * recognise the shape should find the same shape everywhere it applies. A copy
 * that lost its border would read as ordinary body text — which is precisely the
 * opposite of what a caveat is for.
 *
 * Takes children rather than a `TranslationKey`, so a caller can interpolate,
 * compose two sentences, or pass an already-resolved string. `t(...)` at the
 * call site is also what keeps this component free of `useLocale` and usable
 * from a server component.
 */
export function CaveatNote({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-xs leading-relaxed",
        className,
      )}
    >
      {/* `aria-hidden`: the icon is a visual marker for a box whose meaning is
          entirely in its text, and an announced "info" adds nothing a screen
          reader's user can act on. */}
      <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}
