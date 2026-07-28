import { Badge } from "@/components/ui/badge"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { isLameDuckVote } from "@/lib/lame-duck"
import { cn } from "@/lib/utils"

/**
 * Marks a ballot taken after an election and before the new Bundestag convened.
 *
 * ## What it claims
 *
 * Exactly one thing, and it is a fact about the calendar rather than about the
 * vote: on this date the chamber that voted had already been replaced at the
 * ballot box and its successor had not yet convened (Art. 39(1) GG). Not that
 * the vote was illegitimate — it was lawful, and the outgoing Bundestag holds
 * its full powers until the last minute of its term. The tooltip says so; the
 * badge is a pointer to context, not a verdict.
 *
 * That restraint is the same one `RebelVoteBadge` documents at length. The
 * difference is what the claim is *about*: that badge says something about a
 * person's conduct, this one says nothing about any person at all. It qualifies
 * the ballot.
 *
 * ## Why it decides for itself rather than taking a boolean
 *
 * `isLameDuckVote` is called here, from the date and period the caller already
 * has, instead of the caller passing `lameDuck={true}`. Three surfaces render
 * ballots — the list, the detail page, the home page's five-row panel — and a
 * boolean prop is three chances to compute the window slightly differently, or
 * to forget the half-open end and badge the incoming Bundestag's first sitting.
 * The rule has one home in lib/lame-duck.ts and one caller.
 *
 * Renders **nothing** for an ordinary ballot, rather than an "in term" badge.
 * Almost every ballot is ordinary, so the unmarked case is the unremarkable one
 * — the same reason `DissentBadge` renders nothing below its threshold.
 *
 * A server component: the tooltip is the native `title`, so nothing reaches the
 * client bundle. Same construction and same reasoning as `RebelVoteBadge`.
 */
export function LameDuckBadge({
  date,
  wahlperiode,
  locale,
  /** Renders the marker without the word — for a dense table row where the
   * label would crowd the ballot title it sits beside. The label stays in the
   * accessible name, so this is a visual compaction rather than a loss. */
  compact = false,
  className,
}: {
  /** The ballot's date, ISO `YYYY-MM-DD`. */
  date: string
  /** Which Bundestag took it. Load-bearing rather than incidental: the same
   * calendar day is inside one period's window and outside another's, so a
   * date alone cannot answer the question. */
  wahlperiode: number
  locale: Locale
  compact?: boolean
  className?: string
}) {
  if (!isLameDuckVote(date, wahlperiode)) return null

  return (
    <Badge
      variant="outline"
      // The gold ink tier, matching `RebelVoteBadge` and `DissentBadge` — the
      // three marks on this site that mean "notable, look closer" rather than
      // "good" or "bad". Red would read as an error state and green as
      // approval; this is neither. The token is redefined per theme and each
      // side clears 4.5:1, which is why there is no `dark:` half.
      className={cn(
        "shrink-0 border-vote-abstain/40 bg-vote-abstain/15 font-medium text-foreground",
        compact && "gap-0 px-1.5",
        className,
      )}
      title={t("votes.lameDuckTooltip", locale)}
    >
      {/* The dot carries the meaning alongside the colour, so the badge still
          reads as a badge in greyscale or for a reader who cannot distinguish
          the gold from the surface. */}
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-vote-abstain" />
      {compact ? (
        <span className="sr-only">{t("votes.lameDuck", locale)}</span>
      ) : (
        t("votes.lameDuck", locale)
      )}
    </Badge>
  )
}
