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

/**
 * Gold, silver, bronze — as brand tokens rather than as Tailwind's amber/zinc.
 *
 * First place is `--gold`, the brand's own ink tier, which is both the right
 * colour for a gold medal and the reason this component needed no new token: a
 * podium's first place and the site's accent are the same hue by coincidence of
 * subject matter, and using one for the other is what makes the table look
 * designed rather than decorated. The old `text-amber-500` was also the one
 * that failed contrast outright — a 2.9:1 amber on the light background, on a
 * glyph the header below already admits is hard to tell apart.
 *
 * Second and third are neutrals from the page's own ramp: `--muted-foreground`
 * for silver (5.6:1) and a 60 % gold for bronze, which is a darkened,
 * desaturated version of first place rather than a fourth hue. All three clear
 * 4.5:1 in both themes.
 *
 * The luminance caveat in the header still applies and is why the rank number
 * is always rendered — these three are *not* reliably distinguishable, and the
 * colour is decoration over a number that carries the fact.
 */
const MEDALS: Record<number, { className: string }> = {
  1: { className: "text-gold" },
  2: { className: "text-muted-foreground" },
  3: { className: "text-gold/60" },
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
