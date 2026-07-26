"use client"

import { type Preloaded, usePreloadedQuery } from "convex/react"
import Link from "next/link"
import { useDeferredValue, useMemo, useState } from "react"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MPPhoto } from "@/components/mp-photo"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { api } from "@/convex/_generated/api"
import { formatNumber, formatPercent } from "@/lib/bundestag"
import { foldName } from "@/lib/search"

/**
 * The roster table: search, filter, sort, page.
 *
 * Everything here operates on the full list the server preloaded — see the note
 * on app/mps/page.tsx for why all ~630 rows come down at once. The consequence
 * is that no interaction on this page is a network round-trip.
 *
 * **Federal-state filtering is not implemented, and cannot be from this data.**
 * The task asked for it "if available"; it is not. `mps.constituency` holds a
 * Wahlkreis *name* (`Ludwigsburg`) with no state attached, and the Stammdaten
 * field that would carry it — `WKR_LAND` — is neither in `mpInput`
 * (convex/schema.ts) nor ingested by the pipeline. §6.2 also warns those codes
 * are not stable across time. Offering the control with nothing behind it would
 * be worse than its absence: a filter that returns everything reads as a
 * chamber where every MP sits in every state.
 */

type Row = {
  mp: {
    internalId: string
    name: string
    /** Sorted on, and separately from `name`: see `compareRows`. */
    nachname: string
    vorname: string
    fraktion: string
    constituency: string | null
    photoUrl: string | null
  }
  score: { totalScore: number; voteParticipationRate: number } | null
}

type SortKey = "name" | "fraktion" | "constituency" | "score" | "participation"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 25

/** Sentinel for "no filter". Radix's Select forbids an empty-string value —
 * it reserves that for the cleared state — so the all-groups option needs a
 * value of its own rather than `""`. */
const ALL = "__all__"

export function MPTable({
  preloaded,
  wahlperiode,
}: {
  preloaded: Preloaded<typeof api.mps.getMPsWithScores>
  wahlperiode: number
}) {
  const rows = usePreloadedQuery(preloaded)
  const { t, locale } = useLocale()

  const [search, setSearch] = useState("")
  const [fraktion, setFraktion] = useState<string>(ALL)
  const [minScore, setMinScore] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  })
  const [page, setPage] = useState(0)

  // Typing re-filters 630 rows per keystroke. Deferring lets React keep the
  // input responsive and drop intermediate results, which matters on the slow
  // devices this list is longest on.
  const deferredSearch = useDeferredValue(search)

  const fraktionen = useMemo(
    () =>
      [...new Set(rows.map((row) => row.mp.fraktion).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "de"),
      ),
    [rows],
  )

  // The ceiling for the score slider, rounded up so the top MP is inside the
  // range rather than exactly at its end. Derived rather than fixed: scores are
  // unbounded sums and grow through a Wahlperiode.
  const maxScore = useMemo(
    () => Math.ceil(Math.max(0, ...rows.map((row) => row.score?.totalScore ?? 0)) / 10) * 10,
    [rows],
  )

  const filtered = useMemo(() => {
    const needle = foldName(deferredSearch)
    return rows.filter((row) => {
      if (fraktion !== ALL && row.mp.fraktion !== fraktion) return false
      // An unscored MP is filtered out by any non-zero minimum. Treating null
      // as 0 would be the same behaviour, but stating it here is the point:
      // the row is excluded because its score is unknown, not because it is low.
      if (minScore > 0 && (row.score?.totalScore ?? 0) < minScore) return false
      if (needle) {
        const haystack = foldName(`${row.mp.name} ${row.mp.constituency ?? ""}`)
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [rows, deferredSearch, fraktion, minScore])

  const sorted = useMemo(() => {
    const factor = sort.direction === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      // Missing values sort last in *both* directions, so the direction factor
      // is applied only to the comparison of two present values. Folding
      // absence into that comparison instead would put every unscored MP at the
      // top of a descending sort — presented as the chamber's most active.
      const aMissing = isMissing(a, sort.key)
      const bMissing = isMissing(b, sort.key)
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      // The tie-break is *not* negated with the rest: two MPs on the same score
      // should stay in roster order whichever way the column points, rather
      // than swapping places when the arrow flips.
      return factor * compareRows(a, b, sort.key) || compareByName(a, b)
    })
  }, [filtered, sort])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  // Clamped rather than reset in an effect: a filter that shortens the list
  // below the current page would otherwise render an empty table for one paint
  // before the effect ran.
  const currentPage = Math.min(page, pageCount - 1)
  const visible = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    setPage(0)
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === "asc" ? "desc" : "asc" }
        : // Scores and rates open descending — "who is most active" is the
          // question those columns are clicked to answer. Text opens ascending.
          { key, direction: key === "score" || key === "participation" ? "desc" : "asc" },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-3xl tracking-tight">{t("mps.title")}</h1>
        <p className="text-muted-foreground">{t("mps.subtitle", { wahlperiode })}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mp-search">{t("common.search")}</Label>
          <Input
            id="mp-search"
            type="search"
            value={search}
            placeholder={t("mps.searchPlaceholder")}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mp-fraktion">{t("mps.filterFraktion")}</Label>
          <Select
            value={fraktion}
            onValueChange={(value) => {
              setFraktion(value)
              setPage(0)
            }}
          >
            <SelectTrigger id="mp-fraktion">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("common.all")}</SelectItem>
              {fraktionen.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mp-score">
            {t("mps.filterScore")}
            <span className="ml-1 text-muted-foreground tabular-nums">
              {formatNumber(minScore, locale)}
            </span>
          </Label>
          <Slider
            id="mp-score"
            min={0}
            max={maxScore || 100}
            step={Math.max(1, Math.round((maxScore || 100) / 100))}
            value={[minScore]}
            onValueChange={([value]) => {
              setMinScore(value)
              setPage(0)
            }}
            className="mt-3"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("mps.count", { count: sorted.length, total: rows.length })}
        </p>
        {(search || fraktion !== ALL || minScore > 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("")
              setFraktion(ALL)
              setMinScore(0)
              setPage(0)
            }}
          >
            {t("common.reset")}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label={t("mps.columnName")}
                sortKey="name"
                sort={sort}
                onSort={toggleSort}
              />
              <SortableHead
                label={t("mp.party")}
                sortKey="fraktion"
                sort={sort}
                onSort={toggleSort}
              />
              <SortableHead
                label={t("mps.columnConstituency")}
                sortKey="constituency"
                sort={sort}
                onSort={toggleSort}
                className="hidden md:table-cell"
              />
              <SortableHead
                label={t("mps.columnScore")}
                sortKey="score"
                sort={sort}
                onSort={toggleSort}
                align="end"
              />
              <SortableHead
                label={t("mps.columnParticipation")}
                sortKey="participation"
                sort={sort}
                onSort={toggleSort}
                align="end"
                className="hidden sm:table-cell"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? t("mps.emptyRoster") : t("mps.empty")}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => <MPRow key={row.mp.internalId} row={row} />)
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label={t("mps.title")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            {t("common.page", { page: currentPage + 1, total: pageCount })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("common.next")}
          </Button>
        </nav>
      ) : null}
    </div>
  )
}

/**
 * One MP's row.
 *
 * The link wraps the *name cell* rather than the row. A `<tr>` cannot contain
 * an anchor, and the usual workaround — an onClick on the row — produces
 * something a keyboard cannot reach and a screen reader does not announce. A
 * real link in the first cell, stretched over the row with `after:absolute`,
 * navigates on a click anywhere while staying one focusable, announceable link.
 */
function MPRow({ row }: { row: Row }) {
  const { t, locale } = useLocale()
  return (
    <TableRow className="relative hover:bg-muted/50">
      <TableCell>
        <div className="flex items-center gap-3">
          <MPPhoto name={row.mp.name} photoUrl={row.mp.photoUrl} className="size-8" />
          <Link
            href={`/mps/${encodeURIComponent(row.mp.internalId)}`}
            className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            {row.mp.name}
          </Link>
        </div>
      </TableCell>
      <TableCell>
        <FraktionBadge fraktion={row.mp.fraktion} />
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {row.mp.constituency ?? t("mps.listMandate")}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {/* An em dash, not a zero: the cron has not scored this MP, which is a
            different statement from "scored zero" — see `getMPsWithScores`. */}
        {row.score === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatNumber(row.score.totalScore, locale)
        )}
      </TableCell>
      <TableCell className="hidden text-right tabular-nums sm:table-cell">
        {row.score === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatPercent(row.score.voteParticipationRate, locale)
        )}
      </TableCell>
    </TableRow>
  )
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "start",
  className,
}: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; direction: SortDirection }
  onSort: (key: SortKey) => void
  align?: "start" | "end"
  className?: string
}) {
  const active = sort.key === sortKey
  return (
    <TableHead
      className={className}
      // `aria-sort` is what makes the sort state audible. Without it the arrow
      // is the only indication, and it is decorative to a screen reader.
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex w-full items-center gap-1 font-medium hover:text-foreground ${
          align === "end" ? "justify-end" : "justify-start"
        } ${active ? "text-foreground" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {active ? (sort.direction === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </TableHead>
  )
}

/**
 * Whether a row has nothing to sort by in this column.
 *
 * Unscored MPs and list MPs (who hold no constituency) are missing rather than
 * low. The sort keeps them last in both directions on the strength of this,
 * because the alternative — treating a null as 0 — makes an MP the cron has not
 * reached indistinguishable from one who did nothing, and puts them at the top
 * of the "most active" sort.
 */
function isMissing(row: Row, key: SortKey): boolean {
  switch (key) {
    case "constituency":
      return row.mp.constituency === null
    case "score":
    case "participation":
      return row.score === null
    default:
      return false
  }
}

/**
 * Orders two rows by one column, ascending, assuming neither is missing.
 *
 * **By surname, not by display name.** A parliamentary roster is read as a
 * directory: someone looking for Friedrich Merz looks under M. Sorting on
 * `name` puts him under F, between Cansel Kiziltepe and Joana Cotar, and the
 * list stops being scannable — which is also why `getMPs` and
 * `getMPsWithScores` sort on `(nachname, vorname)` server-side. Repeating the
 * rule here rather than trusting the arrival order keeps the column's own sort
 * agreeing with the page's default.
 *
 * German collation throughout: `localeCompare(…, "de")` puts "Ö" with "O"
 * rather than after "Z", which is where a byte comparison puts it and where no
 * reader of this list will look for it.
 */
function compareRows(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "name":
      return compareByName(a, b)
    case "fraktion":
      return a.mp.fraktion.localeCompare(b.mp.fraktion, "de")
    case "constituency":
      return (a.mp.constituency ?? "").localeCompare(b.mp.constituency ?? "", "de")
    case "score":
      return (a.score?.totalScore ?? 0) - (b.score?.totalScore ?? 0)
    case "participation":
      return (a.score?.voteParticipationRate ?? 0) - (b.score?.voteParticipationRate ?? 0)
  }
}

/** Surname then forename — the roster's own order, and the tie-break every
 * other column falls back to so equal scores do not shuffle between renders. */
function compareByName(a: Row, b: Row): number {
  return (
    a.mp.nachname.localeCompare(b.mp.nachname, "de") ||
    a.mp.vorname.localeCompare(b.mp.vorname, "de")
  )
}
