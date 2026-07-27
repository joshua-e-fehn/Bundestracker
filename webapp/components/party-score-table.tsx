"use client"

import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { RankMedal } from "@/components/rank-medal"
import { useLocale } from "@/components/providers/locale-provider"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCount, formatScore } from "@/lib/format"
import { partyByKey, partyKeyColor } from "@/lib/parties"
import { type PartyAggregate, rankPartiesBy } from "@/lib/party-comparison"
import { competitionRanks } from "@/lib/ranking"

/**
 * The single number Wave 9 asks for: average activity index per Fraktion,
 * ranked.
 *
 * ## Four columns, and each of the last three is a guard on the first
 *
 * The mean is the headline. On its own it is also the most misreadable figure on
 * the page, so the three columns beside it are not decoration:
 *
 *  - **Mandate** — §9 puts fraktionslos at 3 seats against CDU/CSU's 209. One
 *    busy independent moves a three-member mean by a third, and a reader cannot
 *    know that from the mean alone.
 *  - **bewertet** — the denominator. A mean over 4 of 209 members is a real
 *    figure about a sweep that has not finished, not about the Fraktion.
 *  - **Median** — the two diverge exactly where the mean is least trustworthy.
 *    One hyperactive member lifts a mean and leaves a median alone.
 *
 * ## Every row is a link
 *
 * Clicking a Fraktion opens its members, ranked — the second thing Wave 9 asks
 * for. The whole row rather than the name alone: a 44 px-tall row is a far
 * easier target than a 60 px-wide word, and the arrow in the last cell is what
 * makes the affordance visible rather than something to discover by hovering.
 *
 * Ranked by mean score only, and not sortable. The per-metric ordering is what
 * the bar charts below are for, and a sortable head here would be a second
 * answer to that question — the thing AGENTS.md's structure pass exists to
 * catch.
 */
export function PartyScoreTable({ parties }: { parties: readonly PartyAggregate[] }) {
  const { t, locale } = useLocale()

  const ranked = rankPartiesBy(parties, "totalScore")
  /**
   * Groups with no scored member, listed after the ranked ones.
   *
   * `rankPartiesBy` drops them, and it is right to — they cannot be ranked. But
   * they hold seats, and omitting them entirely would make this table disagree
   * with the seat count above it and with the chamber. So they appear below the
   * rule, with a dash where a score would be, which is the same call
   * `getPartyMembers` makes for an unscored mandate.
   */
  const unranked = parties.filter((row) => row.scored === 0)
  const ranks = competitionRanks(ranked.map((row) => row.means.totalScore))

  if (parties.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("parties.empty")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t("rankings.rank")}</TableHead>
              <TableHead>{t("parties.column.party")}</TableHead>
              <TableHead className="text-right">{t("parties.column.seats")}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                {t("parties.column.scored")}
              </TableHead>
              <TableHead className="text-right">{t("parties.column.meanScore")}</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                {t("parties.column.medianScore")}
              </TableHead>
              {/* No header text: the column holds only the row's affordance,
                  and "" beats a label naming something that is not a figure. */}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {ranked.map((row, index) => (
              <PartyRow
                key={row.partyKey}
                row={row}
                // `competitionRanks` in lib/ranking.ts — the same numbering the
                // leaderboards and the per-Fraktion member list use, so two
                // groups on the same mean share a rank here exactly as two MPs
                // on the same score do there. Numbered in this component rather
                // than in `rankPartiesBy` because only this table numbers its
                // rows; the charts' ordering is their ranking.
                rank={ranks[index]}
                locale={locale}
              />
            ))}
            {unranked.map((row) => (
              <PartyRow key={row.partyKey} row={row} rank={null} locale={locale} />
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">{t("parties.medianNote")}</p>
    </div>
  )
}

function PartyRow({
  row,
  rank,
  locale,
}: {
  row: PartyAggregate
  /** Null for a group with no scored member — see the note on `unranked`. */
  rank: number | null
  locale: Parameters<typeof formatScore>[1]
}) {
  const { t } = useLocale()
  const party = partyByKey(row.partyKey)
  const color = partyKeyColor(party.key)
  const href = `/parties/${row.partyKey}`

  return (
    <TableRow className="group/row">
      <TableCell>
        {rank === null ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <RankMedal rank={rank} />
        )}
      </TableCell>

      <TableCell>
        {/* The link is on the name and repeated as the arrow at the end of the
            row. One anchor spanning every cell is not possible inside a table —
            a `<tr>` cannot be wrapped — and `onClick` on the row would be a
            click target no keyboard or screen reader could reach. */}
        <Link
          href={href}
          className="flex items-center gap-2 rounded-md font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          {party.label}
        </Link>
      </TableCell>

      <TableCell className="text-right tabular-nums">{formatCount(row.mandates, locale)}</TableCell>

      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
        {formatCount(row.scored, locale)}
      </TableCell>

      <TableCell className="text-right font-medium tabular-nums">
        {/* A dash, not a zero. A mean over nobody is undefined, and a 0 here
            would place an unswept group at the bottom of a ranking it is not in
            — the distinction `getMPsWithScores` draws by returning null. */}
        {row.scored === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatScore(row.means.totalScore, locale)
        )}
      </TableCell>

      <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
        {row.scored === 0 ? "—" : formatScore(row.medianScore, locale)}
      </TableCell>

      <TableCell className="text-right">
        <Link
          href={href}
          // Named for a screen reader, which would otherwise reach an anchor
          // whose only content is a decorative icon.
          aria-label={t("parties.viewMembers")}
          className="inline-flex rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 group-hover/row:text-foreground"
        >
          <ArrowRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </TableCell>
    </TableRow>
  )
}
