"use client"

import { usePaginatedQuery, useQuery } from "convex/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useDeferredValue, useEffect, useState } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { ALL, FilterSelect } from "@/components/filter-select"
import { MotionSponsors } from "@/components/motion-sponsors"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { drucksachePdfUrl } from "@/lib/bundestag"
import { formatCount, formatDateShort } from "@/lib/format"
import { MOTION_KIND_PARAM, MOTION_QUERY_PARAM, MOTION_YEAR_PARAM } from "@/lib/motions"

/**
 * The motions list — `/motions`.
 *
 * ## Why this pages with a cursor where `/votes` pages with numbers
 *
 * `components/vote-list.tsx` renders "page 3 of 9" because `getVoteSheetsPage`
 * can afford to count: §4.4 puts named ballots at ~1 015 in the Bundestag's
 * entire history. This table is not that. The WP19 backfill logged **37 726**
 * motions for one period, so counting the filtered set is exactly the read
 * `convex/motions.ts` is arranged to avoid — and a page number over a set nobody
 * has counted would be a figure invented for the chrome.
 *
 * So this is the `components/activity-feed.tsx` shape: `usePaginatedQuery`, a
 * "load more" button, and a count of what is *loaded* rather than of what
 * exists. The label says "geladen"/"loaded" for that reason; it is not a total
 * and must never be presented as one.
 *
 * ## The filters live in the URL, the search box does not — and that split is
 * deliberate
 *
 * The two structured filters write query parameters, like
 * `components/search-page.tsx`: a colleague opening `?kind=Kleine+Anfrage&year=2026`
 * sees the same page, and the back button undoes a filter rather than leaving
 * the site. The reader's *typing* is different in kind — every keystroke would
 * be a history entry — so the box holds local state and commits to the URL when
 * the deferred value settles. `replace`, not `push`, for the reason
 * `search-page.tsx` gives: adjusting a filter refines one query rather than
 * starting a new one.
 *
 * ## Short pages are honest here, and the count is what says so
 *
 * The title search is applied to each page after it is read (see
 * `getMotionsPage`), so a fetch of 25 can yield 3. `isDone` comes back untouched
 * from the underlying pagination, so "load more" stays offered and reaches the
 * rest — the same contract convex/feed.ts documents for its group filter. The
 * empty state is therefore only shown once the source is `Exhausted`; until then
 * a page with no visible rows still has more behind it.
 */

/** Rows per fetch. Matches `/votes`' page size so the two lists feel alike. */
const PAGE_SIZE = 25

/**
 * Rows per fetch while a title search is set.
 *
 * The search filters the page after it is read, keeping only the titles that
 * match — which for a specific word is a small fraction. `usePaginatedQuery`
 * fetches once per `loadMore` rather than refilling, so at 25 a searched list
 * would deliver one row and look empty.
 *
 * Four times the size, and that multiplier *is* the cost: because the filter is
 * applied after `.paginate()`, the read is exactly `numItems` rows whatever the
 * search matches (measured — see `getMotionsPage`). So this trades 100 document
 * reads per fetch for a page dense enough to read, with no scan hiding behind
 * it. Same trade, and the same reasoning, as `FILTERED_PAGE_SIZE` in
 * components/activity-feed.tsx.
 */
const SEARCHED_PAGE_SIZE = PAGE_SIZE * 4

export function MotionList({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const params = useSearchParams()

  const kind = params.get(MOTION_KIND_PARAM) ?? ALL
  const year = params.get(MOTION_YEAR_PARAM) ?? ALL
  const urlQuery = params.get(MOTION_QUERY_PARAM) ?? ""

  // The box's own state, so typing does not write a history entry per keystroke.
  // Seeded from the URL and resynced when the URL changes from elsewhere — the
  // reset button, the back button, a shared link.
  const [search, setSearch] = useState(urlQuery)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    setSearch(urlQuery)
  }, [urlQuery])

  /**
   * Rewrites one parameter, preserving the rest.
   *
   * The period is among the parameters preserved, which is what keeps a reader
   * on `/motions?wp=19` there when they pick a year — `periodHref`'s rule
   * applied through the same mechanism components/search-page.tsx uses.
   */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value === null || value === ALL || value === "") next.delete(key)
      else next.set(key, value)
      const query = next.toString()
      router.replace(query ? `/motions?${query}` : "/motions", { scroll: false })
    },
    [params, router],
  )

  // The typed query reaches the URL once it settles, so a shared link carries
  // what the reader was looking at without the address bar flickering per key.
  useEffect(() => {
    const trimmed = deferredSearch.trim()
    if (trimmed === urlQuery) return
    setParam(MOTION_QUERY_PARAM, trimmed === "" ? null : trimmed)
  }, [deferredSearch, urlQuery, setParam])

  const options = useQuery(api.motions.getMotionFilterOptions, { wahlperiode })

  const searching = urlQuery !== ""
  const pageSize = searching ? SEARCHED_PAGE_SIZE : PAGE_SIZE

  const { results, status, loadMore } = usePaginatedQuery(
    api.motions.getMotionsPage,
    {
      wahlperiode,
      vorgangstyp: kind === ALL ? undefined : kind,
      year: year === ALL ? undefined : year,
      search: urlQuery === "" ? undefined : urlQuery,
    },
    { initialNumItems: pageSize },
  )

  const filtersActive = kind !== ALL || year !== ALL || search !== ""
  const isLoadingFirstPage = status === "LoadingFirstPage"

  /**
   * Clears this page's three filters and nothing else.
   *
   * Written as a *deletion* rather than as a rebuild from an empty
   * `URLSearchParams`, and the difference is load-bearing. A rebuild has to
   * re-add every parameter worth keeping, which means naming `wp` here — a
   * second place that reads the period, when lib/period.ts owns exactly one
   * (`parsePeriodParam`, asserted by lib/period-links.test.ts). Deleting only
   * `MOTION_*` keeps the period, and keeps whatever parameter is added next,
   * without this component knowing either exists.
   *
   * One navigation rather than three, so the back button undoes a reset in one
   * press rather than walking back through two half-cleared states.
   */
  function reset() {
    setSearch("")
    const next = new URLSearchParams(params.toString())
    for (const key of [MOTION_KIND_PARAM, MOTION_YEAR_PARAM, MOTION_QUERY_PARAM]) {
      next.delete(key)
    }
    const query = next.toString()
    router.replace(query ? `/motions?${query}` : "/motions", { scroll: false })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The caveat that governs the whole page: this is a record of what was
          tabled, not of what became of it. Above the filters rather than under
          the table, the same placement `/votes` gives `namedOnlyNotice` — a
          reader who takes this list for a record of outcomes has been misled by
          us, so it is said before they start. */}
      <CaveatNote>{t("motions.recordOnlyNotice")}</CaveatNote>

      <div className="grid gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="motion-search">{t("motions.searchLabel")}</Label>
          <Input
            id="motion-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("motions.searchPlaceholder")}
          />
        </div>

        <FilterSelect
          id="motion-kind"
          label={t("motions.filterKind")}
          value={kind}
          onChange={(value) => setParam(MOTION_KIND_PARAM, value)}
          allLabel={t("motions.allKinds")}
          // Every option comes from the data — the rule components/search-page.tsx
          // and components/rankings-filters.tsx both state. It matters more here
          // than anywhere: `vorgangstyp` is an open string with no published
          // value list, and the vocabulary genuinely differs between periods.
          options={(options?.kinds ?? []).map((entry) => ({
            value: entry.value,
            label: t(entry.atLeast ? "motions.kindCountAtLeast" : "motions.kindCount", {
              value: entry.value,
              count: formatCount(entry.count, locale),
            }),
          }))}
        />

        <FilterSelect
          id="motion-year"
          label={t("motions.filterYear")}
          value={year}
          onChange={(value) => setParam(MOTION_YEAR_PARAM, value)}
          allLabel={t("motions.allYears")}
          options={(options?.years ?? []).map((value) => ({ value, label: value }))}
        />

        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={reset} className="justify-self-start">
            {t("common.reset")}
          </Button>
        ) : null}
      </div>

      {/* Only where it is true. The kind list is drawn from a sample of the
          period's most recent rows (see `getMotionFilterOptions`), and on a
          period small enough to have been read whole there is nothing to warn
          about. */}
      {options?.partial === true ? <CaveatNote>{t("motions.kindsPartial")}</CaveatNote> : null}

      {isLoadingFirstPage ? (
        <output className="flex flex-col gap-2" aria-live="polite">
          <span className="sr-only">{t("common.loading")}</span>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
            <Skeleton key={index} className="h-16 w-full rounded-md" />
          ))}
        </output>
      ) : results.length === 0 && status === "Exhausted" ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {/* Three different facts, and only one of them is the reader's doing.
              `options.empty` is the query's own answer to "does this period hold
              any motion at all", so "not backfilled" is never reported as "no
              match" — the distinction lib/period.ts exists to keep, applied to
              the one source with no permanent boundary of its own. */}
          {options?.empty === true
            ? t("motions.emptyAll")
            : filtersActive
              ? t("motions.empty")
              : t("motions.emptyAll")}
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {results.map((motion) => (
            <MotionRow key={motion.id} motion={motion} />
          ))}
        </ul>
      )}

      <div className="flex flex-col items-center gap-3">
        {/* What is on screen, named as such. Not a total: nothing has counted
            the filtered set, and a number labelled "of 37 726" would be the
            invented figure this page is arranged to avoid. */}
        {results.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("motions.loaded", { count: formatCount(results.length, locale) })}
          </p>
        ) : null}
        {status === "CanLoadMore" ? (
          <Button variant="outline" onClick={() => loadMore(pageSize)}>
            {t("common.loadMore")}
          </Button>
        ) : null}
        {status === "LoadingMore" ? (
          <Skeleton className="h-9 w-32 rounded-md" aria-label={t("common.loading")} />
        ) : null}
        {status === "Exhausted" && results.length > 0 ? (
          <p className="text-muted-foreground text-xs">{t("motions.end")}</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One procedure: what it is, when it was tabled, and where the paper is.
 *
 * A list of blocks rather than a `<table>`, unlike `/votes`. The reason is the
 * one components/about-page.tsx sets out for its definition lists: a table
 * column is at least as wide as its longest unbreakable word, and these titles
 * are German administrative prose — "Bürokratierückbau und
 * Staatsmodernisierung" in a 343 px viewport. `/votes` gets away with a table
 * because three of its four columns are numbers. This one would scroll sideways
 * on a phone, and the column pushed off the edge would be the title.
 *
 * ⚠ **No outcome, no status, no summary.** The `motions` row carries `title`,
 * `date`, `type`, `vorgangstyp` and `drucksacheNr` and nothing else; there is no
 * result field to render and inventing one is exactly the plausible-but-wrong
 * figure this codebase is written to avoid. What is shown is what is stored.
 */
function MotionRow({
  motion,
}: {
  motion: {
    id: string
    title: string
    date: string
    type: string | null
    vorgangstyp: string | null
    drucksacheNr: string | null
  }
}) {
  const { t, locale } = useLocale()
  const pdf = drucksachePdfUrl(motion.drucksacheNr)

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 font-medium text-sm leading-snug">{motion.title}</span>
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {formatDateShort(motion.date, locale)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
        {/* `vorgangstyp` is the procedure kind and `type` the paper kind; they
            answer different questions and disagree usefully — a `Gesetzgebung`
            procedure whose paper is an `Antwort`. Both are shown when both
            exist and differ, and neither is invented when absent. */}
        {motion.vorgangstyp ? <span>{motion.vorgangstyp}</span> : null}
        {motion.type && motion.type !== motion.vorgangstyp ? <span>{motion.type}</span> : null}
        {motion.drucksacheNr ? <span className="tabular-nums">{motion.drucksacheNr}</span> : null}
        {pdf ? (
          <a
            href={pdf}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("motions.openDrucksache")}
          </a>
        ) : (
          // Stated rather than omitted, and stated as a fact about the record
          // rather than about the site. `drucksachePdfUrl` refuses to guess for
          // a paper with no Bundestag number (§5.1: Bundesrat numbering is a
          // bare running number any `split("/")` misparses), so the absence of a
          // link here is the refusal working — not a missing feature.
          <span title={t("motions.noDocumentHint")}>{t("motions.noDocument")}</span>
        )}
      </div>

      <MotionSponsors motionId={motion.id} />
    </li>
  )
}
