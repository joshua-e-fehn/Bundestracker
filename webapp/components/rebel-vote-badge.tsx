import { Badge } from "@/components/ui/badge"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Marks a vote cast against the voter's own group's majority.
 *
 * ## What this badge claims, and what it must not
 *
 * It is the only label on the site that says something about an individual's
 * *conduct* rather than reporting a count, so the claim behind it is narrow and
 * stated on the badge itself: this MP voted differently from the majority of
 * their own Fraktion, in this ballot. Not that they rebelled against a whip —
 * no source records whipping — and not that they were wrong.
 *
 * Whether a row qualifies is decided in convex/votes.ts (`isRebel`), never
 * here. Three cases are deliberately excluded there and a component that
 * re-derived the flag from `vote !== groupVote` would get them wrong: an
 * absence is not a dissent, a tied group has no line to break, and an MP with
 * no group has nothing to be measured against. This component only renders a
 * decision already made.
 *
 * The colouring is a neutral outline with an amber cast rather than the red of
 * a `no` vote: dissent is notable, not bad, and red on a name reads as an
 * error state.
 *
 * A server component — the tooltip is the native `title`, so nothing here needs
 * to reach the client bundle. `components/ui/tooltip.tsx` would; the extra
 * hydration is not worth one word of explanation, and `title` is what a
 * keyboard user gets from a focused element anyway.
 */
export function RebelVoteBadge({
  locale,
  /** Renders only the marker, without the word — for a dense table cell where
   * the column header already says what the mark means. */
  compact = false,
  className,
}: {
  locale: Locale
  compact?: boolean
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-vote-abstain/40 bg-vote-abstain/15 font-medium text-foreground",
        className,
      )}
      title={t("votes.rebelTooltip", locale)}
    >
      {/* The dot repeats the meaning without colour being the only carrier:
          the badge still reads as a badge in a greyscale print or for a reader
          who cannot distinguish the amber from the surface. */}
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-vote-abstain" />
      {compact ? (
        <span className="sr-only">{t("votes.rebel", locale)}</span>
      ) : (
        t("votes.rebel", locale)
      )}
    </Badge>
  )
}
