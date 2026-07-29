"use client"

import { type Preloaded, usePreloadedQuery } from "convex/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useDeferredValue, useMemo, useState } from "react"
import { ALL, FilterSelect } from "@/components/filter-select"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MandateBadge } from "@/components/mandate-badge"
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
import { formatNumber, formatPercent, occupationOf, stateOf } from "@/lib/bundestag"
import { landNameFor } from "@/lib/laender"
import { scoreCeiling } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"
import { foldName } from "@/lib/search"
import { MANDATE_LABEL_KEYS, MANDATE_TYPES, mandateType } from "@/lib/taxonomy"

/**
 * The roster table: search, filter, sort, page.
 *
 * Everything here operates on the full list the server preloaded — see the note
 * on app/mps/page.tsx for why all ~630 rows come down at once. The consequence
 * is that no interaction on this page is a network round-trip.
 *
 * ## Every option comes from the data, and an unanswerable filter is not shown
 *
 * The five filters are built by scanning the loaded rows, never from a constant
 * list — the same rule `RankingsFilters` states for the rankings page, and for
 * the same reason: a control that offers values nothing matches reads as broken
 * data rather than as an absent field.
 *
 * **Federal state is the case that rule was written for**, and it is now the
 * case that vindicates it. `WKR_LAND` is a stored column
 * (`mps.federalState`), so the control renders — but it renders *its period's
 * own codes*, which is the point: WP1–17 spell Lower Saxony `NDS` where
 * WP18–21 say `NI` (§6.2), so a hardcoded list of sixteen Länder would select
 * nothing at all on a historical roster. It still hides itself when no row
 * yields a state, which is no longer the common case but remains the correct
 * behaviour for a period the pipeline has not re-ingested.
 *
 * The field it replaced parsed a trailing `(BW)` off the constituency name.
 * That returned null for **every** MP in the corpus — 0 of 13 046 `WKR_NAME`
 * values carry one — so this filter was invisible for as long as it existed,
 * and looked like a sparse field rather than a broken one.
 *
 * Committee membership carries its own ambiguity, and it is not the same one:
 * §6.4 records that committees are published for the *current* Wahlperiode
 * only, so on a historical period the filter finds nothing to offer and is
 * likewise hidden rather than showing a chamber that sat on no committees.
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
    /** Stammdaten `WKR_LAND`, as published. Null where the source carries none
     * — 21 of WP21's 635 mandates — and `undefined` on a row written before the
     * column existed. `stateOf` folds the two into "unknown". */
    federalState?: string | null
    /** `Direktwahl` or `Landesliste` — Stammdaten's `MANDATSART`, stored raw.
     * Nullable: an MP whose mandate type was not ingested is unknown, not a
     * list MP, so the filter must not fold the two together. */
    electionMethod: string | null
    photoUrl: string | null
    /** Rendered with the portrait or not at all — the licence condition. See
     * components/mp-photo.tsx. */
    photoCredit?: string | null
    /**
     * What the MP does now (abgeordnetenwatch), falling back to what they did
     * before (Stammdaten `BERUF`) — resolved through `occupationOf`, never by
     * reading one of them here. That function is the one place the precedence
     * lives, and the roster, the seating tooltip, the profile and the search
     * card all go through it.
     *
     * ⚠ `?:` as well as `| null`: these are `v.optional` in storage
     * (convex/schema.ts) because Wave 8 added them to a populated table, so an
     * un-enriched row has the key *absent* rather than null — and a deploy that
     * lands before its Convex counterpart serves rows without the field at all
     * (components/seat-tooltip.tsx documents the outage that caused).
     */
    occupation?: string | null
    profession?: string | null
  }
  score: { totalScore: number; voteParticipationRate: number } | null
  committees: string[]
}

type SortKey = "name" | "fraktion" | "occupation" | "constituency" | "score" | "participation"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 25

/**
 * The mandate type as a *word*, for a cell that has no room for a badge.
 *
 * The same vocabulary `MandateBadge` renders, resolved through the same
 * `mandateType` narrowing — so the constituency column and the badge beside it
 * cannot disagree about what an unrecognised `MANDATSART` means. An em dash for
 * the unknown case, matching the score columns: see the call site.
 */
function mandateLabel(electionMethod: string | null, t: (key: TranslationKey) => string): string {
  const type = mandateType(electionMethod)
  if (type === null) return "—"
  return t(MANDATE_LABEL_KEYS[type])
}

/**
 * Every column the sort dropdown offers, in the order it offers them.
 *
 * The same `SortKey`s the column headers toggle — one source, so the dropdown
 * and the headers cannot drift into offering different sorts. Each key appears
 * twice, once per direction, because a `<select>` that sets only the column
 * leaves the reader unable to say which end they want.
 */
const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; direction: SortDirection }> = [
  { key: "name", direction: "asc" },
  { key: "name", direction: "desc" },
  { key: "fraktion", direction: "asc" },
  { key: "fraktion", direction: "desc" },
  { key: "occupation", direction: "asc" },
  { key: "occupation", direction: "desc" },
  { key: "constituency", direction: "asc" },
  { key: "constituency", direction: "desc" },
  { key: "score", direction: "desc" },
  { key: "score", direction: "asc" },
  { key: "participation", direction: "desc" },
  { key: "participation", direction: "asc" },
]

/** The column labels, shared by the headers and the sort dropdown. */
const SORT_LABEL_KEYS: Record<SortKey, TranslationKey> = {
  name: "mps.columnName",
  fraktion: "mp.party",
  occupation: "mp.occupation",
  constituency: "mps.columnConstituency",
  score: "mps.columnScore",
  participation: "mps.columnParticipation",
}

/** `key:direction`, the dropdown's value — a `<select>` carries one string, and
 * a sort is two things. */
function sortValue(sort: { key: SortKey; direction: SortDirection }): string {
  return `${sort.key}:${sort.direction}`
}

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
  const [state, setState] = useState<string>(ALL)
  const [committee, setCommittee] = useState<string>(ALL)
  const [electionMethod, setElectionMethod] = useState<string>(ALL)
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

  /** The states this period's roster can be filtered to. Read from the rows
   * rather than from a list of sixteen Länder, because the codes are
   * period-scoped — see the header — and because a member whose record carries
   * none must not invent an option. `stateOf` is shared with the rankings so
   * the two surfaces answer "which state" by one rule rather than two.
   *
   * Carries the code *and* its label: the code is what the filter compares on
   * and the label is what the reader picks, and they must not be the same
   * string. Sorted by the label, in the reader's collation — an English reader
   * scanning for Bavaria looks under B, and sorting by the code would file it
   * under `BY` between `BW` and `BE`, which is an order neither language reads. */
  const states = useMemo(() => {
    const codes = [...new Set(rows.flatMap((row) => stateOf(row.mp.federalState) ?? []))]
    return codes
      .map((code) => ({ code, label: landNameFor(code, locale) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale))
  }, [rows, locale])

  /** Committees anyone on this roster sits on. Empty on a historical period —
   * see the header. */
  const committees = useMemo(
    () =>
      [...new Set(rows.flatMap((row) => row.committees))].sort((a, b) => a.localeCompare(b, "de")),
    [rows],
  )

  /** Only the mandate types actually present, so a roster of list MPs does not
   * offer a "Direktwahl" filter that selects nobody. */
  const electionMethods = useMemo(() => {
    const present = new Set(rows.flatMap((row) => row.mp.electionMethod ?? []))
    return MANDATE_TYPES.filter((method) => present.has(method))
  }, [rows])

  // The ceiling for the score slider. `scoreCeiling` carries the rounding rule
  // and the empty-roster fallback, shared with the feed's threshold slider in
  // components/activity-feed.tsx.
  const maxScore = useMemo(
    () => scoreCeiling(rows.map((row) => row.score?.totalScore ?? 0)),
    [rows],
  )

  const filtered = useMemo(() => {
    const needle = foldName(deferredSearch)
    return rows.filter((row) => {
      if (fraktion !== ALL && row.mp.fraktion !== fraktion) return false
      if (state !== ALL && stateOf(row.mp.federalState) !== state) return false
      if (committee !== ALL && !row.committees.includes(committee)) return false
      // An MP whose mandate type was never ingested matches neither value
      // rather than defaulting into one — see `ELECTION_METHODS`.
      if (electionMethod !== ALL && row.mp.electionMethod !== electionMethod) return false
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
  }, [rows, deferredSearch, fraktion, state, committee, electionMethod, minScore])

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

      {/* `minmax(0,…)` on every track: a grid item's `min-width` is `auto`, so
          a long committee name in one select would otherwise widen its column
          past the viewport rather than truncating inside it. */}
      <div className="grid gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]">
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

        <FilterSelect
          id="mp-fraktion"
          label={t("mps.filterFraktion")}
          value={fraktion}
          onChange={(value) => {
            setFraktion(value)
            setPage(0)
          }}
          allLabel={t("common.all")}
          options={fraktionen.map((name) => ({ value: name, label: name }))}
        />

        {/* Rendered only where the data can answer it — see the header. */}
        {states.length > 0 && (
          <FilterSelect
            id="mp-state"
            label={t("mps.filterState")}
            value={state}
            onChange={(value) => {
              setState(value)
              setPage(0)
            }}
            allLabel={t("mps.allStates")}
            // The value stays the raw `WKR_LAND` code and only the label is
            // translated: a locale-dependent filter value would make the same
            // selection mean different things to a German and an English reader.
            options={states.map(({ code, label }) => ({ value: code, label }))}
          />
        )}

        {committees.length > 0 && (
          <FilterSelect
            id="mp-committee"
            label={t("mps.filterCommittee")}
            value={committee}
            onChange={(value) => {
              setCommittee(value)
              setPage(0)
            }}
            allLabel={t("mps.allCommittees")}
            options={committees.map((name) => ({ value: name, label: name }))}
          />
        )}

        {electionMethods.length > 0 && (
          <FilterSelect
            id="mp-election-method"
            label={t("mps.filterElectionMethod")}
            value={electionMethod}
            onChange={(value) => {
              setElectionMethod(value)
              setPage(0)
            }}
            allLabel={t("mps.allElectionMethods")}
            options={electionMethods.map((method) => ({
              value: method,
              label: t(MANDATE_LABEL_KEYS[method]),
            }))}
          />
        )}

        {/* The sort dropdown duplicates what the column headers already do,
            deliberately: the headers are the faster control once you have found
            them, and on a phone the score and participation headers are the two
            the layout hides. Both write the same state, so they always agree —
            picking here moves the arrow in the header, and clicking a header
            moves the selection here. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mp-sort">{t("mps.sortBy")}</Label>
          <Select
            value={sortValue(sort)}
            onValueChange={(value) => {
              const [key, direction] = value.split(":")
              setSort({ key: key as SortKey, direction: direction as SortDirection })
              setPage(0)
            }}
          >
            <SelectTrigger id="mp-sort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={sortValue(option)} value={sortValue(option)}>
                  {t(SORT_LABEL_KEYS[option.key])} {option.direction === "asc" ? "↑" : "↓"}
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
            max={maxScore}
            step={Math.max(1, Math.round(maxScore / 100))}
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
        {(search ||
          fraktion !== ALL ||
          state !== ALL ||
          committee !== ALL ||
          electionMethod !== ALL ||
          minScore > 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("")
              setFraktion(ALL)
              setState(ALL)
              setCommittee(ALL)
              setElectionMethod(ALL)
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
              {/* After the party. `lg:` rather than the constituency's `md:`:
                  occupations are free text and run to 60 characters, so on a
                  tablet this column and that one together squeeze the name —
                  which is the column the table is read by. The sort dropdown
                  above still offers it at every width, so a phone reader can
                  order by it even where the cells are hidden. */}
              <SortableHead
                label={t("mp.occupation")}
                sortKey="occupation"
                sort={sort}
                onSort={toggleSort}
                className="hidden lg:table-cell"
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
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
            {t("common.page", { page: currentPage + 1, pages: pageCount })}
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
 * ## The name is a real link; the rest of the row is an enhancement
 *
 * A `<tr>` cannot contain an anchor, so a row-wide hit target has to be built.
 * This used to be a stretched `::after` on the name link, anchored to a
 * `position: relative` on the `<tr>` — and that is the bug where every row
 * opened the *last* MP on the page.
 *
 * `after:inset-0` resolves against the nearest positioned ancestor, and
 * `position: relative` on a table row is not reliably a containing block: CSS
 * 2.1 §9.3 leaves the effect on internal table elements undefined and engines
 * differ. Where the `<tr>` is skipped, every row's overlay resolves against the
 * next positioned ancestor instead — `components/ui/table.tsx`'s
 * `table-container`, which is `relative` — so all twelve overlays become the
 * same full-table box, stacked, and the one painted last wins every click.
 * Hence: click any row, get the bottom row's MP. Forcing `position: static` on
 * the `<tr>` reproduces it exactly, which is how it was confirmed.
 *
 * So the row-wide target is an `onClick` on the `<tr>` and the *name stays a
 * real `<a>`*. The objection to an onClick — that it is unreachable by keyboard
 * and unannounced by a screen reader — is an objection to using one *instead
 * of* a link. Here it is on top of one: the anchor is focusable, announceable,
 * and carries middle-click, "open in new tab" and the status-bar preview. The
 * handler only adds "clicking the empty part of the row does the same thing",
 * which is the seating map's position on its pan handlers — a pure enhancement
 * over something already fully usable without it.
 *
 * The alternative fix, anchoring the overlay to a plain `<div>` in the first
 * cell, works but has to reach across the columns to its right with something
 * like `w-screen`; that box is scrollable overflow inside `table-container`'s
 * `overflow-x-auto`, so it would put a horizontal scrollbar under every table.
 */
function MPRow({ row }: { row: Row }) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const href = `/mps/${encodeURIComponent(row.mp.internalId)}`
  const occupation = occupationOf(row.mp)

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>) {
    // The anchor handles its own clicks, including the modified ones this
    // cannot honour; intercepting them here would break "open in new tab".
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) return
    // Selecting a name should not navigate out from under the selection.
    if (window.getSelection()?.toString()) return
    router.push(href)
  }

  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={handleRowClick}>
      <TableCell>
        <div className="flex items-center gap-3">
          <MPPhoto
            name={row.mp.name}
            photoUrl={row.mp.photoUrl}
            credit={row.mp.photoCredit}
            className="size-8"
          />
          <Link
            href={href}
            className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            {row.mp.name}
          </Link>
        </div>
      </TableCell>
      <TableCell>
        {/* The mandate type shares the group's cell rather than taking a
            seventh column: this table already gives four columns to the two
            score figures and the constituency, and the roster is the widest
            table on the site. Compact, matching components/rankings-table.tsx,
            so the two tables badge the same field the same way.

            In *this* cell rather than the constituency one because that column
            is `hidden md:table-cell` — a phone would lose the badge entirely,
            and the mandate type is exactly the thing a narrow roster has room
            to say when the constituency name does not fit. */}
        <span className="flex items-center gap-1.5">
          <FraktionBadge fraktion={row.mp.fraktion} />
          <MandateBadge electionMethod={row.mp.electionMethod} locale={locale} compact />
        </span>
      </TableCell>
      {/* Truncated to one line: these are free text and run to 60 characters
          ("selbstständiger Immobilienunternehmer"), which would otherwise set
          the row height for the whole table. The full string is in the `title`,
          so nothing is unreachable.

          An em dash where nothing is recorded, matching the score columns
          below and meaning the same thing: *unknown*. It is emphatically not
          "unemployed" — neither source publishes that, and neither does this
          cell. `occupationOf` collapses absent, null and empty to null, all
          three of which occur on a roster the enrichment stage has not
          finished. */}
      <TableCell
        className="hidden max-w-56 truncate text-muted-foreground lg:table-cell"
        // Undefined rather than an empty string where nothing is recorded: an
        // empty `title` is still a tooltip, and hovering the dash to be told
        // nothing is worse than not being offered one.
        title={occupation ?? undefined}
      >
        {occupation ?? <span className="text-muted-foreground/60">—</span>}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {/* The fallback reads the *stored* mandate type, not the absence of a
            constituency. Those two agree today and are different claims —
            `ELECTION_METHODS` above says so at length about the filter, and the
            same trap was live in this cell: a direct mandate whose
            `WKR_NAME` failed to ingest printed "Landesliste" in the roster,
            asserting a list seat from a gap in the data.

            Three cases, so three renderings. An em dash where neither field is
            known, matching the score columns below — an unknown constituency is
            not a mandate type, and the word would invent one. */}
        {row.mp.constituency ?? mandateLabel(row.mp.electionMethod, t)}
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
    // Sorts to the bottom in both directions, like an unscored MP: a member
    // with no recorded trade is *unknown*, not alphabetically first. Folding
    // them into the comparison as `""` would open the ascending sort with a
    // block of blank cells that reads as the least employed members of the
    // chamber.
    case "occupation":
      return occupationOf(row.mp) === null
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
    // German collation, like every other text column here: it files "Ökonom"
    // with the O rather than after the Z, which is where a byte comparison puts
    // it and where nobody scanning this column will look for it.
    case "occupation":
      return (occupationOf(a.mp) ?? "").localeCompare(occupationOf(b.mp) ?? "", "de")
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
