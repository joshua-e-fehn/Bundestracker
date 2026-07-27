"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { useDeferredValue, useState } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { VoteBar } from "@/components/vote-bar"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { api } from "@/convex/_generated/api"
import { formatDateShort } from "@/lib/format"

/**
 * The ballot list — `/votes`.
 *
 * ## Filtering happens on the server, unlike the per-MP table
 *
 * The two tables in this feature page differently on purpose.
 * `components/vote-table.tsx` receives one ballot's 630 records and filters them
 * in the browser, because that set is bounded by the chamber and every filter is
 * a predicate over what the reader is already looking at.
 *
 * This one cannot: it needs `total` to render a pager, and a total is not
 * something a client-side slice of one page can know. So the filters are query
 * arguments and `getVoteSheetsPage` returns the page plus the size of the
 * filtered set — the same division as the rankings page, for the same reason.
 *
 * The dropdown options come back with the page rather than from a constant,
 * because the published outcome is free text (§3.2) — there is no enum of
 * results to hardcode, and a filter offering a value that selects nothing reads
 * as broken data.
 */

/** Sentinel for "no filter" — Radix reserves the empty string on `SelectItem`. */
const ANY = "__any__"

/**
 * Sentinel for "outcome not published yet".
 *
 * A ballot awaiting its outcome stores `result: ""` — and the empty string is
 * exactly what Radix reserves, so passing the stored value straight through, as
 * this list did, renders an option Radix rejects. It is not a rare row either:
 * the outcome arrives from a later pipeline stage than the ballot, so every
 * ballot is result-less for a while and most of WP21 was at once.
 *
 * Distinct from `ANY`: this *selects* the pending ballots rather than clearing
 * the filter, so it maps back to `""` — not `undefined` — on the way out.
 */
const PENDING = "__pending__"

const PAGE_SIZE = 25

export function VoteList({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const [search, setSearch] = useState("")
  const [result, setResult] = useState<string>(ANY)
  const [year, setYear] = useState<string>(ANY)
  const [page, setPage] = useState(0)

  // Deferred so a keystroke does not open a new subscription per character.
  const deferredSearch = useDeferredValue(search)

  const data = useQuery(api.votes.getVoteSheetsPage, {
    wahlperiode,
    search: deferredSearch.trim() === "" ? undefined : deferredSearch.trim(),
    // `undefined` clears the filter; `""` selects the ballots whose outcome is
    // not published — a real value the server matches exactly, not an absence.
    result: result === ANY ? undefined : result === PENDING ? "" : result,
    year: year === ANY ? undefined : year,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /** Every filter change returns to page 1 — see the note in vote-table.tsx. */
  function change<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setPage(0)
    }
  }

  const filtersActive = search !== "" || result !== ANY || year !== ANY

  return (
    <div className="flex flex-col gap-6">
      {/* The caveat that governs the whole page. A named ballot is the
          exception in the Bundestag, not the rule (§4.4), so a reader counting
          rows here is not counting votes — and this is the one place that can
          say so before they start. */}
      <CaveatNote>{t("votes.namedOnlyNotice")}</CaveatNote>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <label htmlFor="vote-list-search" className="text-muted-foreground text-xs">
            {t("common.search")}
          </label>
          <Input
            id="vote-list-search"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
            placeholder={t("votes.searchPlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="vote-list-result-label" className="text-muted-foreground text-xs">
            {t("votes.filterResult")}
          </span>
          <Select value={result} onValueChange={change(setResult)}>
            <SelectTrigger
              id="vote-list-result"
              aria-labelledby="vote-list-result-label"
              className="w-[15rem]"
            >
              <SelectValue placeholder={t("votes.allResults")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("votes.allResults")}</SelectItem>
              {data?.results.map((entry) => (
                <SelectItem
                  key={entry.value}
                  value={entry.value === "" ? PENDING : entry.value}
                >
                  {entry.value === "" ? t("votes.outcome.pending") : entry.value} ({entry.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="vote-list-year-label" className="text-muted-foreground text-xs">
            {t("votes.filterYear")}
          </span>
          <Select value={year} onValueChange={change(setYear)}>
            <SelectTrigger
              id="vote-list-year"
              aria-labelledby="vote-list-year-label"
              className="w-[9rem]"
            >
              <SelectValue placeholder={t("votes.allYears")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("votes.allYears")}</SelectItem>
              {data?.years.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.value} ({entry.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("")
              setResult(ANY)
              setYear(ANY)
              setPage(0)
            }}
          >
            {t("common.reset")}
          </Button>
        ) : null}
      </div>

      {data === undefined ? (
        <output className="flex flex-col gap-2" aria-live="polite">
          <span className="sr-only">{t("common.loading")}</span>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
            <Skeleton key={index} className="h-12 w-full rounded-md" />
          ))}
        </output>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {/* "no ballots loaded" and "none match your filters" are different
              facts, and only one of them is the reader's doing. */}
          {filtersActive ? t("votes.empty") : t("votes.emptyAll")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[7rem]">{t("votes.columnDate")}</TableHead>
                  <TableHead>{t("votes.columnTitle")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("votes.columnResult")}</TableHead>
                  <TableHead className="hidden w-[14rem] sm:table-cell">
                    {t("votes.columnBreakdown")}
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((sheet) => (
                  <TableRow key={sheet.id}>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {formatDateShort(sheet.date, locale)}
                    </TableCell>

                    <TableCell>
                      <Link
                        href={`/votes/${sheet.id}`}
                        className="font-medium text-sm hover:underline"
                      >
                        {sheet.title}
                      </Link>
                      <div className="mt-0.5 text-muted-foreground text-xs tabular-nums">
                        {t("votes.sitting", {
                          sitzungnr: sheet.sitzungnr,
                          abstimmnr: sheet.abstimmnr,
                        })}
                      </div>
                      {/* The outcome and the bar both drop out of the row on a
                          phone, so the outcome comes back under the title —
                          it is the one thing a list of votes must show. */}
                      <div className="mt-1 md:hidden">
                        <VoteOutcomeBadge result={sheet.result} locale={locale} />
                      </div>
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      <VoteOutcomeBadge result={sheet.result} locale={locale} />
                    </TableCell>

                    <TableCell className="hidden sm:table-cell">
                      <VoteBar
                        counts={{
                          yes: sheet.yesCount,
                          no: sheet.noCount,
                          abstain: sheet.abstainCount,
                          invalid: sheet.invalidCount,
                          absent: sheet.absentCount,
                        }}
                        locale={locale}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-xs">
              {t("votes.count", { count: rows.length, total })}
            </p>
            {pages > 1 ? (
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
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
