import { PartyBadge } from "@/components/party-badge"
import { RebelVoteBadge } from "@/components/rebel-vote-badge"
import { VoteBar, type VoteCounts } from "@/components/vote-bar"
import { type Vote, VoteResultBadge } from "@/components/vote-result-badge"
import { formatPercent } from "@/lib/format"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"

/**
 * How each parliamentary group voted on one ballot.
 *
 * The question a named ballot exists to answer, one row per group: what was the
 * group's line, how solid was it, and who broke it. Ordered largest group first
 * by the query (`breakdownRows`), so the table reads like the chamber.
 *
 * ## Why "no majority" is a rendered state rather than a blank
 *
 * A group can have no line — an exact split, or one where nobody cast a vote.
 * convex/votes.ts returns null for those cases deliberately, and this renders
 * the null as words. Leaving the cell empty would read as missing data, and
 * defaulting it to the plurality would invent a position the group did not
 * take. The same reasoning as `mp.partyLineUnknown` on the profile page.
 *
 * A server component: one table, no interactivity.
 */

export type FraktionBreakdown = VoteCounts & {
  fraktion: string
  total: number
  cast: number
  majority: { vote: Vote; share: number } | null
  rebels: number
}

export function FraktionVoteSummary({
  breakdown,
  locale,
}: {
  breakdown: ReadonlyArray<FraktionBreakdown>
  locale: Locale
}) {
  if (breakdown.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("votes.breakdownEmpty", locale)}
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {breakdown.map((group) => (
        <li key={group.fraktion} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <PartyBadge fraktion={group.fraktion} />

            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              {t("votes.groupMajority", locale)}:
              {group.majority === null ? (
                <span className="font-medium text-foreground">
                  {t("votes.groupMajorityNone", locale)}
                </span>
              ) : (
                <>
                  <VoteResultBadge vote={group.majority.vote} locale={locale} />
                  <span className="tabular-nums">
                    {t("votes.groupShare", locale, {
                      share: formatPercent(group.majority.share, locale),
                    })}
                  </span>
                </>
              )}
            </span>

            {group.rebels > 0 ? (
              <span className="flex items-center gap-1.5">
                <RebelVoteBadge locale={locale} />
                <span className="text-muted-foreground text-xs tabular-nums">{group.rebels}</span>
              </span>
            ) : null}

            {/* Members with a record on this ballot, absences included — the
                denominator the bar is drawn over, stated so a short group reads
                as a small group rather than as missing rows. */}
            <span className="ml-auto text-muted-foreground text-xs tabular-nums">
              {group.cast} / {group.total}
            </span>
          </div>

          <VoteBar counts={group} locale={locale} />
        </li>
      ))}
    </ul>
  )
}
