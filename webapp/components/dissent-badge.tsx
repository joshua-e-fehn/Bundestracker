import { Badge } from "@/components/ui/badge"
import { DISSENT_BADGE_RATE, type DissentTally, isNotableDissenter } from "@/lib/dissent"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Marks a member who breaks with their group unusually often, across a whole
 * electoral period.
 *
 * ## What separates this from `RebelVoteBadge`
 *
 * That one marks **one vote** — this MP voted differently from their group in
 * *this ballot* — and appears in a table of that ballot's records. This marks a
 * **pattern**, and appears beside a name in lists where no ballot is in view.
 * The two are deliberately not the same component: a badge that meant "dissented
 * once" on the ballot page and "dissents often" on a leaderboard would be one
 * word doing two jobs, and the second is a much larger claim.
 *
 * They do share the gold cast, and for the reason `RebelVoteBadge` gives at
 * length: dissent is notable, not bad. Red on a name reads as an error state,
 * and this badge sits beside a photograph.
 *
 * ## The threshold is not this component's
 *
 * `isNotableDissenter` in lib/dissent.ts decides, and it takes two conditions
 * where the obvious implementation takes one — a rate *and* a floor on the votes
 * behind it. Without the floor a member sworn in last week who broke with their
 * group in their only ballot would carry a 100 % rate and the loudest mark on
 * the site. A component that re-derived the rule from `rate > 0.05` would get
 * exactly that wrong, which is why it does not have the rate to compare.
 *
 * Renders **nothing** below the threshold, rather than an inverse "loyal" badge.
 * Every list on this site shows the same 630 members, and a mark on the majority
 * is not information — it is furniture. The absence of the badge is the
 * unremarkable case.
 *
 * A server component: the tooltip is the native `title`, so nothing here reaches
 * the client bundle. Same construction as `RebelVoteBadge`, and the same reason.
 */
export function DissentBadge({
  tally,
  locale,
  /** Renders the marker without the word — for a card row where a full badge
   * would crowd the name it belongs to. The label stays in the accessible name,
   * so this is a visual compaction rather than a loss of meaning. */
  compact = false,
  className,
}: {
  /** The member's period tally, or null where none has been computed. Null is
   * not zero: see `isNotableDissenter`. */
  tally: DissentTally | null | undefined
  locale: Locale
  compact?: boolean
  className?: string
}) {
  if (!isNotableDissenter(tally)) return null

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-vote-abstain/40 bg-vote-abstain/15 font-medium text-foreground",
        compact && "gap-0 px-1.5",
        className,
      )}
      title={t("mp.dissentBadgeTooltip", locale)}
    >
      {/* The dot carries the meaning alongside the colour, so the badge still
          reads as a badge in greyscale or for a reader who cannot distinguish
          the gold from the surface. */}
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-vote-abstain" />
      {compact ? (
        <span className="sr-only">{t("mp.dissentBadge", locale)}</span>
      ) : (
        t("mp.dissentBadge", locale)
      )}
    </Badge>
  )
}

/** Re-exported so a caller that renders the badge can also state the rule it
 * applies — the profile panel prints the threshold beside the figure rather
 * than leaving a reader to infer why one member is marked and another is not. */
export { DISSENT_BADGE_RATE }
