"use client"

import { useQuery } from "convex/react"
import { Info } from "lucide-react"
import { useMemo, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import {
  ANY,
  EMPTY_FILTERS,
  type RankingFilterState,
  RankingsFilters,
} from "@/components/rankings-filters"
import { RankingsTable, type RankingTableRow } from "@/components/rankings-table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import { boardById, DEFAULT_BOARD_ID, LEADERBOARDS } from "@/lib/leaderboards"
import {
  type AgeGroup,
  isAgeGroup,
  isRankingMetric,
  previousMonth,
  type RankingMetric,
  type SortDirection,
} from "@/lib/taxonomy"

/**
 * The rankings page: nine boards, four filters, one table.
 *
 * ## The three query shapes
 *
 * `LEADERBOARDS` says which of `getMetricRankings`, `getRisingRankings` and
 * `getCrossPartyRankings` answers each board. All three are called on every
 * render and two of the three are skipped — `useQuery`'s `"skip"` sentinel, so
 * a skipped query costs nothing and opens no subscription. That is the shape
 * React's rules of hooks require: a query cannot be called conditionally, so the
 * condition moves into the argument.
 *
 * ## Paging comes after ranking
 *
 * `offset`/`limit`, not a cursor. The rank *is* the offset — page 2 of "most
 * speeches" is ranks 51…100 — and a cursor would make that the one thing the
 * API could not express. convex/rankings.ts ranks the whole period and slices,
 * which is why the ranks on page 2 continue page 1's rather than restarting.
 */

const PAGE_SIZE = 50

export function Rankings({ wahlperiode }: { wahlperiode: number }) {
  const { t } = useLocale()
  const [boardId, setBoardId] = useState(DEFAULT_BOARD_ID)
  const [filters, setFilters] = useState<RankingFilterState>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ field: string; direction: SortDirection } | null>(null)

  const board = boardById(boardId) ?? LEADERBOARDS[0]
  const options = useQuery(api.rankings.getRankingFilterOptions, { wahlperiode })

  /**
   * The month the boards read.
   *
   * The rising board cannot use the period total — there is no month before
   * "the whole Wahlperiode" — so when no month is chosen it falls back to the
   * newest one with scores. `options.months` is sorted newest first by the
   * query, so `[0]` is that month.
   */
  const selectedMonth = filters.month === ANY ? null : filters.month
  const risingMonth = selectedMonth ?? options?.months[0] ?? null
  const risingPrevious = risingMonth === null ? null : previousMonth(risingMonth)

  const shared = {
    wahlperiode,
    fraktion: filters.fraktion === ANY ? undefined : filters.fraktion,
    state: filters.state === ANY ? undefined : filters.state,
    ageGroup:
      filters.ageGroup !== ANY && isAgeGroup(filters.ageGroup)
        ? (filters.ageGroup as AgeGroup)
        : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }

  /**
   * Which column the metric boards rank by.
   *
   * The board's own metric until the reader sorts, then whatever they picked —
   * but only if it is a real metric. A sort on a derived column (`change`,
   * `dissents`) belongs to a board that is not a metric board, and passing one
   * here would be rejected by the argument validator; falling back to the
   * board's metric keeps a stale sort from breaking the query.
   */
  const activeMetric: RankingMetric =
    sort !== null && isRankingMetric(sort.field) ? sort.field : (board.metric ?? "totalScore")

  const metricResult = useQuery(
    api.rankings.getMetricRankings,
    board.kind === "metric"
      ? {
          ...shared,
          month: selectedMonth,
          metric: activeMetric,
          direction: sort?.direction ?? "desc",
        }
      : "skip",
  )

  const risingResult = useQuery(
    api.rankings.getRisingRankings,
    board.kind === "rising" && risingMonth !== null && risingPrevious !== null
      ? { ...shared, month: risingMonth, previousMonth: risingPrevious }
      : "skip",
  )

  const crossPartyResult = useQuery(
    api.rankings.getCrossPartyRankings,
    board.kind === "crossParty" ? shared : "skip",
  )

  const result =
    board.kind === "metric"
      ? metricResult
      : board.kind === "rising"
        ? risingResult
        : crossPartyResult

  /**
   * Every change to the query resets to page 1.
   *
   * A page number is an offset into a *particular* ordering, so carrying page 5
   * across a filter change asks for ranks 201–250 of a board that may now hold
   * 40 rows — an empty page indistinguishable from no data.
   *
   * Done in the setters rather than in an effect. An effect would fire *after*
   * the render that already used the stale offset, so the reader would see one
   * frame of the empty page before it corrected itself; and its dependency
   * would have to be the `filters` object, whose identity changes on every
   * keystroke-free re-render too. Resetting where the change happens makes the
   * new page and the new filter land in the same render.
   */
  function applyFilters(next: RankingFilterState) {
    setFilters(next)
    setPage(0)
  }

  /** Sorting is only meaningful where the board ranks by a column the reader
   * can change; the two derived boards define their own order. */
  function handleSort(field: string) {
    if (board.kind !== "metric") return
    setSort((current) =>
      current?.field === field
        ? { field, direction: current.direction === "desc" ? "asc" : "desc" }
        : // First click on a new column sorts descending: on a leaderboard the
          // interesting end is the top, and ascending is the second press.
          { field, direction: "desc" },
    )
    setPage(0)
  }

  // A board switch abandons a sort belonging to the previous board's columns.
  function handleBoardChange(next: string) {
    setBoardId(next)
    setSort(null)
    setPage(0)
  }

  const rows = (result?.rows ?? []) as RankingTableRow[]
  const total = result?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const sortField = sort?.field ?? (board.kind === "metric" ? (board.metric ?? null) : null)

  const risingUnavailable =
    board.kind === "rising" && (risingMonth === null || risingPrevious === null)

  const boardTabs = useMemo(
    () =>
      LEADERBOARDS.map((entry) => ({
        id: entry.id,
        label: t(entry.labelKey),
      })),
    [t],
  )

  return (
    <div className="flex flex-col gap-6">
      {/* `min-w-0` is what makes the `overflow-x-auto` below actually work —
          the same fix `ColorModeToggle` documents for the seating page's five
          tabs, applied to the nine here, which are far wider. `Tabs` is a flex
          container, so its child's `min-width` is `auto`: the list refused to
          shrink past the nine labels' combined 1 516 px and the scroll
          container therefore never became narrow enough to scroll. It pushed
          the page instead — /rankings rendered 883 px wide inside a 768 px
          viewport, and the whole document scrolled sideways, header and all.
          The affordance was written for exactly this case and was unreachable.

          `shrink-0` on the triggers for the other half of it: `TabsTrigger`
          carries `flex-1`, which lets a tab shrink below its label and puts
          nine ellipsised stubs in a row instead of a scrollable strip. */}
      <Tabs value={boardId} onValueChange={handleBoardChange} className="min-w-0">
        <TabsList className="w-full max-w-full justify-start overflow-x-auto">
          {boardTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="shrink-0 whitespace-nowrap">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg">{t(board.labelKey)}</h2>
        <p className="text-muted-foreground text-sm">{t(board.descriptionKey)}</p>
      </div>

      <RankingsFilters
        options={options}
        filters={filters}
        onChange={applyFilters}
        // The rising board compares two months, so "whole electoral period" is
        // not an option it can honour — offering it would mean silently
        // substituting a month the reader did not pick.
        allowWholePeriod={board.kind !== "rising"}
      />

      {board.caveatKey !== undefined && (
        <p className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-xs leading-relaxed">
          <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
          {t(board.caveatKey)}
        </p>
      )}

      {board.kind === "crossParty" && crossPartyResult !== undefined && (
        // The window this board was computed over. Stated because a dissent
        // count over an unnamed subset of ballots is a number with no meaning —
        // see `getCrossPartyRankings`, which bounds the read explicitly.
        <p className="text-muted-foreground text-xs">
          {t("rankings.column.ballots")}: {crossPartyResult.ballotsExamined}
        </p>
      )}

      {risingUnavailable ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("rankings.noPreviousMonth")}
        </p>
      ) : result === undefined ? (
        <output className="flex flex-col gap-2" aria-live="polite">
          <span className="sr-only">{t("common.loading")}</span>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
            <Skeleton key={index} className="h-11 w-full rounded-md" />
          ))}
        </output>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("rankings.empty")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <RankingsTable
              rows={rows}
              columns={board.columns}
              sortField={sortField}
              sortDirection={sort?.direction ?? "desc"}
              onSort={handleSort}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-xs">
              {t("common.showingCount", {
                shown: `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length}`,
                total,
              })}
            </p>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  {t("common.previous")}
                </Button>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("common.page", { page: page + 1, pages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages - 1}
                  onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
                >
                  {t("common.next")}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <p className="text-muted-foreground text-xs leading-relaxed">
        {t("rankings.scoreExplainer")}
      </p>
    </div>
  )
}
