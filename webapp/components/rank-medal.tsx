import { Medal } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The rank number, with a medal for the top three.
 *
 * ## Ties
 *
 * The medal follows the *rank*, not the row position — `ranked()` in
 * convex/rankings.ts gives tied rows the same rank, so two MPs on identical
 * records both get silver and nobody gets bronze. That is the correct reading
 * of a tie, and the alternative (medal by position) would award them by
 * whatever order the index happened to return.
 *
 * ## Colour is not the signal
 *
 * The number is always rendered, and the medal is `aria-hidden` with the rank
 * announced as text. Gold, silver and bronze are close enough in luminance that
 * a reader with a colour vision deficiency cannot reliably tell them apart, and
 * a podium encoded only in hue is a podium those readers cannot read.
 */

const MEDALS: Record<number, { className: string }> = {
  1: { className: "text-amber-500" },
  2: { className: "text-zinc-400" },
  3: { className: "text-amber-700" },
}

export function RankMedal({ rank, className }: { rank: number; className?: string }) {
  const medal = MEDALS[rank]
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", className)}>
      {medal ? (
        <Medal className={cn("size-4 shrink-0", medal.className)} aria-hidden="true" />
      ) : (
        // Holds the column width so the numbers stay aligned between medalled
        // and unmedalled rows.
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className={cn(medal && "font-semibold")}>{rank}</span>
    </span>
  )
}
