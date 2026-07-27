"use client"

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import Link from "next/link"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { RankMedal } from "@/components/rank-medal"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatBy, initials } from "@/lib/format"
import type { BoardColumn } from "@/lib/leaderboards"
import type { SortDirection } from "@/lib/taxonomy"
import { cn } from "@/lib/utils"

/**
 * A leaderboard, rendered.
 *
 * Presentational: it takes rows and reports sort intent, and knows nothing
 * about which query produced them. That is what lets the same table serve all
 * nine boards including the two that are not metric slices.
 *
 * ## Sorting is the server's job
 *
 * `onSort` reports intent; it does not reorder anything locally. Sorting the
 * page in the browser would sort *this page* — 50 of 630 rows — and produce
 * ranks that are positions within a page, which is the one thing a ranking must
 * not be. The server re-ranks the whole population and returns page 1 of the new
 * order.
 */

export type RankingTableRow = {
  rank: number
  mpInternalId: string
  name: string
  fraktion: string
  photoUrl: string | null
  totalScore: number
} & Record<string, unknown>

function SortIcon({ state }: { state: SortDirection | null }) {
  if (state === "desc") return <ArrowDown className="size-3.5" aria-hidden="true" />
  if (state === "asc") return <ArrowUp className="size-3.5" aria-hidden="true" />
  return <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden="true" />
}

export function RankingsTable({
  rows,
  columns,
  sortField,
  sortDirection,
  onSort,
}: {
  rows: RankingTableRow[]
  columns: BoardColumn[]
  /** Which column is currently ranked, or null for a board whose ordering is
   * fixed by its definition (cross-party, rising). */
  sortField: string | null
  sortDirection: SortDirection
  onSort: (field: string) => void
}) {
  const { t, locale } = useLocale()

  /**
   * The activity score, as a column like any other.
   *
   * Every board ends with it — it is the common scale the whole site is built
   * on, so a board about speeches should still say what the speaker's overall
   * score is. Appending it here rather than repeating it in all nine entries of
   * `LEADERBOARDS` keeps that a single decision; a board that wanted to *omit*
   * it would be the thing to add a flag for, and none does.
   *
   * Deduplicated because `most-active` ranks on `totalScore` itself: without
   * this the score would render twice, once as the ranked column and once as
   * the trailing one, with two sort buttons for the same field.
   */
  const allColumns: BoardColumn[] = columns.some((column) => column.field === "totalScore")
    ? columns
    : [
        ...columns,
        {
          field: "totalScore",
          labelKey: "rankings.score",
          format: "score",
          sortable: true,
        },
      ]

  /** `aria-sort` on the header cell, so a screen reader announces the ordering
   * rather than leaving it to the icon. */
  function ariaSort(column: BoardColumn): "ascending" | "descending" | "none" {
    if (!column.sortable || sortField !== column.field) return "none"
    return sortDirection === "asc" ? "ascending" : "descending"
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">{t("rankings.rank")}</TableHead>
          <TableHead>{t("rankings.member")}</TableHead>
          <TableHead className="hidden sm:table-cell">{t("mp.party")}</TableHead>
          {allColumns.map((column) => (
            <TableHead key={column.field} className="text-right" aria-sort={ariaSort(column)}>
              {column.sortable ? (
                <button
                  type="button"
                  onClick={() => onSort(column.field)}
                  className="ml-auto inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {t(column.labelKey)}
                  <SortIcon state={sortField === column.field ? sortDirection : null} />
                </button>
              ) : (
                t(column.labelKey)
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.mpInternalId} className={cn(row.rank <= 3 && "bg-muted/30")}>
            <TableCell>
              <RankMedal rank={row.rank} />
            </TableCell>

            <TableCell>
              <Link
                href={`/mps/${encodeURIComponent(row.mpInternalId)}`}
                className="flex items-center gap-2.5 font-medium hover:underline"
              >
                <Avatar className="size-7">
                  {row.photoUrl !== null && <AvatarImage src={row.photoUrl} alt="" />}
                  <AvatarFallback className="text-[10px]">{initials(row.name)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{row.name}</span>
              </Link>
              {/* The group repeats here below the name on narrow screens, where
                  its own column is hidden — dropping it entirely would remove
                  the one piece of context that makes a name legible. */}
              <span className="sm:hidden">
                <PartyBadge fraktion={row.fraktion} className="mt-1" />
              </span>
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <PartyBadge fraktion={row.fraktion} />
            </TableCell>

            {allColumns.map((column) => (
              <TableCell key={column.field} className="text-right tabular-nums">
                {formatBy(column.format, Number(row[column.field] ?? 0), locale)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
