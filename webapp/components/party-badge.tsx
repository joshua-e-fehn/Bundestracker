import { Badge } from "@/components/ui/badge"
import { partyColor, partyLabel } from "@/lib/parties"
import { cn } from "@/lib/utils"

/**
 * A Fraktion, in its own colour.
 *
 * Everything about which colour and which spelling lives in lib/parties.ts —
 * this is only the rendering. That split matters because the same question
 * ("which party is this string?") is asked by the MP card, the vote list and the
 * activity feed, and the sources spell a group three different ways (§6.4).
 *
 * The colour is applied as text on a neutral surface rather than as a solid
 * fill: six of these can appear in one list, and six saturated blocks compete
 * with the figures they are meant to annotate.
 *
 * The surface is `--muted` and *not* a tint of the party colour, which is what
 * it used to be (`color-mix(… 14%, transparent)`). Tinting a background with
 * the foreground colour moves the two toward each other, so the badge lost
 * ~12 % of its contrast in light and ~45 % in dark — every dark party badge
 * measured under 4.5:1. lib/bundestag.ts carries the full reasoning; the two
 * badge families must agree, so the fix is the same on both sides.
 *
 * A server component — no interactivity, so it stays out of the client bundle
 * and can be rendered directly by a server page.
 */
export function PartyBadge({
  fraktion,
  className,
}: {
  /** The Fraktion as stored, in whatever spelling the source used. */
  fraktion: string | null | undefined
  className?: string
}) {
  const color = partyColor(fraktion)

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent bg-muted font-medium", className)}
      style={{ color }}
    >
      {/* The dot carries the colour at full strength, so the party stays
          identifiable for a reader who finds the tinted text too subtle. */}
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {partyLabel(fraktion)}
    </Badge>
  )
}
