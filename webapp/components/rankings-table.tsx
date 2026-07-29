"use client"

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import Link from "next/link"
import { MandateBadge } from "@/components/mandate-badge"
import { MPPhoto } from "@/components/mp-photo"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { useMPHref } from "@/components/providers/period-provider"
import { RankMedal } from "@/components/rank-medal"
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
  /** Rendered with the portrait or not at all — the licence condition these
   * images carry. See components/mp-photo.tsx. */
  photoCredit?: string | null
  /** `Direktwahl` or `Landesliste`, badged beside the group. Optional because
   * two boards are built from shapes that predate the field — `mandateType`
   * turns anything it does not recognise, absent included, into no badge. */
  electionMethod?: string | null
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
  // Carries the page's Wahlperiode into the profile link — see
  // components/providers/period-provider.tsx. On a page that is not
  // period-scoped this is the bare path it always was.
  const mpHref = useMPHref()

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
                href={mpHref(row.mpInternalId)}
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
              {/* The group repeats here below the name on narrow screens, where
                  its own column is hidden — dropping it entirely would remove
                  the one piece of context that makes a name legible. */}
              <span className="sm:hidden">
                <PartyBadge fraktion={row.fraktion} className="mt-1" />
              </span>
            </TableCell>

            {/* The mandate type rides in the group's column rather than taking
                one of its own. A board already carries up to four metric
                columns plus the score, and a fifth non-numeric column would
                push the numbers — which are what a leaderboard is read for —
                off a laptop's width. Compact for the same reason: the word
                would be wider than the group badge above it.

                Not repeated in the narrow-screen fallback above: that block
                exists to keep a name legible when its column is hidden, and the
                group is what does that. A second badge there would spend a
                phone's width on the less contextual of the two. */}
            <TableCell className="hidden sm:table-cell">
              <span className="flex items-center gap-1.5">
                <PartyBadge fraktion={row.fraktion} />
                <MandateBadge electionMethod={row.electionMethod} locale={locale} compact />
              </span>
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
