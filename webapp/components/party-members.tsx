"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { RankMedal } from "@/components/rank-medal"
import { MPPhoto } from "@/components/mp-photo"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { formatCount, formatRate, formatScore, initials } from "@/lib/format"
import { partyByKey, type PartyKey } from "@/lib/parties"

/**
 * One Fraktion's members, ranked by activity score — what clicking a party on
 * `/parties` opens.
 *
 * ## Why this is not `/rankings?fraktion=…`
 *
 * It very nearly is, and the difference is the reason `getPartyMembers` exists.
 * The rankings filter narrows on the **stored `fraktion` string**; this narrows
 * on the folded party key. §6.4 and §5.2 catalogue four spellings of one group,
 * and a live deployment already produced `Fraktionslos` and `fraktionslos` as
 * two distinct rows — so a filtered leaderboard can return half a Fraktion and
 * give no sign that it has. A page headed "Members of the CDU/CSU group" must
 * list the whole group.
 *
 * ## Unscored members are listed, and are not ranked
 *
 * A mandate the nightly sweep has not reached appears at the foot of the table
 * with a dash where a rank and a score would be. Both halves of that matter:
 * dropping them would make this list disagree with the seat count on the
 * dashboard, and ranking them at the bottom would assert they are the least
 * active — the distinction `getMPsWithScores` draws by returning `null` rather
 * than `0`, and `seatingLevel` draws by returning `null` rather than the bottom
 * of the ramp.
 */
export function PartyMembers({ party, wahlperiode }: { party: PartyKey; wahlperiode: number }) {
  const { t, locale } = useLocale()
  const result = useQuery(api.parties.getPartyMembers, { wahlperiode, party })

  if (result === undefined) {
    return (
      <output className="flex flex-col gap-2" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        {Array.from({ length: 8 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
          <Skeleton key={index} className="h-11 w-full rounded-md" />
        ))}
      </output>
    )
  }

  if (result.rows.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("parties.members.empty")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("parties.members.count", {
          scored: formatCount(result.scored, locale),
          total: formatCount(result.total, locale),
        })}
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t("rankings.rank")}</TableHead>
              <TableHead>{t("rankings.member")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("mp.constituency")}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                {t("rankings.column.participation")}
              </TableHead>
              <TableHead className="text-right">{t("rankings.score")}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {result.rows.map((row) => (
              <TableRow
                key={row.mpInternalId}
                // The top three of a Fraktion, matching the rankings table's own
                // podium tint so the two read as the same kind of list.
                className={row.rank > 0 && row.rank <= 3 ? "bg-muted/30" : undefined}
              >
                <TableCell>
                  {/* Rank 0 is `getPartyMembers`' marker for an unscored
                      mandate — distinguishable from every real rank, which
                      starts at 1. Rendered as a dash rather than as a position. */}
                  {row.rank === 0 ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <RankMedal rank={row.rank} />
                  )}
                </TableCell>

                <TableCell>
                  <Link
                    href={`/mps/${encodeURIComponent(row.mpInternalId)}`}
                    className="flex items-center gap-2.5 font-medium hover:underline"
                  >
                    <MPPhoto
                      name={row.name}
                      photoUrl={row.photoUrl}
                      credit={row.photoCredit}
                      className="size-7"
                    />
                    <span className="truncate">{row.name}</span>
                  </Link>
                  {/* The group repeats under the name only where a member sits
                      with a Fraktion spelled differently from the page's own —
                      §6.4's mid-period movers, whose row would otherwise look
                      identical to everyone else's on a page that folded them in.
                      On a page about one group, a badge on all 209 rows is
                      noise; on the six rows where it differs, it is the fact. */}
                  {partyByKey(party).label !== row.fraktion && (
                    <PartyBadge fraktion={row.fraktion} className="mt-1" />
                  )}
                </TableCell>

                <TableCell className="hidden text-muted-foreground text-sm md:table-cell">
                  {/* Null for a list MP, who has no constituency — a fact about
                      how they were elected, not missing data. */}
                  {row.constituency ?? t("mps.listMandate")}
                </TableCell>

                <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                  {row.voteParticipationRate === null
                    ? "—"
                    : formatRate(row.voteParticipationRate, locale)}
                </TableCell>

                <TableCell className="text-right font-medium tabular-nums">
                  {row.totalScore === null ? (
                    // Named rather than dashed: this cell is the one the table
                    // is sorted on, so "not scored yet" is what the reader needs
                    // to know about the row's position.
                    <span className="text-muted-foreground text-xs">
                      {t("parties.members.unscored")}
                    </span>
                  ) : (
                    formatScore(row.totalScore, locale)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
