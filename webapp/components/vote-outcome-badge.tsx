import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * A ballot's published outcome, as a badge.
 *
 * Distinct from `components/vote-result-badge.tsx`, which renders how one *MP*
 * voted — a closed union of five positions. This renders what the *chamber*
 * decided, which is free text: DIP's `beschlusstenor` is a string, not an enum
 * (§3.2 of docs/api-research.md), so there is no set of outcomes to enumerate
 * and no lookup table this could be.
 *
 * So the string is matched loosely for a colour and **always printed verbatim**.
 * An unrecognised tenor keeps its own words in a neutral badge rather than being
 * forced into "passed" or "rejected" — those are the two things nobody should
 * guess about a vote, and the sources carry outcomes ("Erledigt",
 * "Zurückgezogen", referrals to committee) that are neither.
 *
 * Matching is on the German because that is what the field contains, in both
 * locales: the badge shows the official wording of the Bundestag's own decision,
 * which is not ours to translate.
 *
 * A server component, so it renders inside the vote list without shipping JS.
 */
export function VoteOutcomeBadge({ result, className }: { result: string; className?: string }) {
  const folded = result.toLowerCase()
  const rejected = folded.includes("ablehnung") || folded.includes("abgelehnt")
  const passed = folded.includes("annahme") || folded.includes("angenommen")
  const color = passed ? "var(--vote-yes)" : rejected ? "var(--vote-no)" : null

  return (
    <Badge
      variant="outline"
      className={cn("max-w-[14rem] shrink-0 justify-start truncate", className)}
      style={
        color === null
          ? undefined
          : {
              // The same 14 % tint `PartyBadge` uses, so the two badge families
              // sit at one weight in a row that carries both.
              backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
              color,
              borderColor: "transparent",
            }
      }
      // The cell truncates; the full tenor stays reachable on hover.
      title={result}
    >
      {result}
    </Badge>
  )
}
