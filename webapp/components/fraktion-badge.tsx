import { Badge } from "@/components/ui/badge"
import { fraktionClassName } from "@/lib/bundestag"
import { cn } from "@/lib/utils"

/**
 * A parliamentary group, in its own colour.
 *
 * One component rather than a `<Badge className={fraktionClassName(…)}>` at
 * each of the six call sites (the table, the card, the profile header, the
 * committee list, the vote list, the sponsor list), because the empty case has
 * to be decided once: `mpLabel` in convex/mps.ts returns `""` for an MP whose
 * mandate row is missing (§7.3's Stammdaten lag), and rendering an empty badge
 * would show a coloured smudge where a group name should be.
 */
export function FraktionBadge({ fraktion, className }: { fraktion: string; className?: string }) {
  if (!fraktion) return null
  return (
    <Badge variant="outline" className={cn(fraktionClassName(fraktion), className)}>
      {fraktion}
    </Badge>
  )
}
