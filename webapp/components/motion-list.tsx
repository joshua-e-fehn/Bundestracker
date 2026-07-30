"use client"

import { usePaginatedQuery, useQuery } from "convex/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { CommitteeReferralsDisclosure } from "@/components/committee-referrals-disclosure"
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
import {
  MOTION_KIND_PARAM,
  MOTION_QUERY_PARAM,
  MOTION_YEAR_PARAM,
  normalizeMotionKind,
  normalizeMotionYear,
} from "@/lib/motions"
import {
  initSearchSync,
  reduceSearchSync,
  type SearchSyncAction,
} from "@/lib/motion-search-sync"

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
 * be a history entry — so the box holds local state and commits to the URL
 * through a debounced *event-handler write*, never through a URL-observing
 * effect. That distinction is what stops the browser Back button flapping the
 * URL back to its post-Reset form on a return to a shared-link entry — see
 * lib/motion-search-sync.ts for the full reducer and the regression test.
 * `replace`, not `push`, for the reason `search-page.tsx` gives: adjusting a
 * filter refines one query rather than starting a new one.
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

/** Milliseconds between the last keystroke and the URL write. Long enough
 * that a typist crosses "asyl" in one commit instead of four; short enough
 * that a paused hand sees the shared-linkable URL update. Same order of
 * magnitude as `useDeferredValue`'s effective delay, restated as a timer
 * because the debounce has to be *cancellable* from a URL-observing effect
 * — see lib/motion-search-sync.ts. */
const SEARCH_DEBOUNCE_MS = 300

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

  // Normalised at the boundary — the URL can carry anything a reader typed
  // into the address bar, and `?year=abc` or `?kind=` would otherwise reach
  // Convex as an index-selects-nothing query that renders as "no match" for
  // a period that has matches. See lib/motions.ts for the rules.
  const kind = normalizeMotionKind(params.get(MOTION_KIND_PARAM)) ?? ALL
  const year = normalizeMotionYear(params.get(MOTION_YEAR_PARAM)) ?? ALL
  const urlQuery = params.get(MOTION_QUERY_PARAM) ?? ""

  // The search box's state machine — see lib/motion-search-sync.ts for the
  // full reducer, the invariants and the test that pins them. The short of
  // it: local state so typing does not write per-keystroke history entries,
  // a debounced commit on user input, and — crucially — no URL-observing
  // effect that writes back, so browser Back/Forward cannot flap.
  //
  // `useState` rather than `useReducer` because the reducer returns both a
  // new state and an effect and React's `useReducer` signature is
  // state-only. The dispatch wrapper below applies the reducer, commits
  // the state, and runs the emitted effect against the current `setParam`.
  //
  // A ref mirrors the committed state so the debounce timer, which fires
  // outside React's render cycle, sees whatever landed last. Reading
  // `syncState` in a closure would freeze the state at whichever render
  // created the handler, and Strict Mode's double-invocation of pure
  // updaters would run the reducer twice against a live outer capture —
  // the reason an earlier attempt at capturing the effect inside the
  // functional updater ate every commit on the second pass.
  const [syncState, setSyncState] = useState(() => initSearchSync(urlQuery))
  const syncStateRef = useRef(syncState)
  syncStateRef.current = syncState
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = syncState.local

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

  /**
   * The one point where the reducer's effect is turned into a real URL
   * write. Every branch here goes through it, so the invariants in
   * lib/motion-search-sync.ts hold at runtime as well as on paper.
   *
   * `setSyncState`'s functional form runs the reducer against the *latest*
   * committed state — necessary because two rapid transitions (a keystroke
   * plus a debounce fire) can both touch state before React re-renders, and
   * a closure over the stale value would decide the second one wrongly.
   *
   * The URL write lives *outside* the updater. Calling `router.replace`
   * inside a `setState` updater triggers Next's own state update while
   * MotionList is rendering, which React logs as *"Cannot update a
   * component while rendering a different component"*. Capturing the
   * emitted effect and applying it once the updater returns keeps the
   * update within one render and no more.
   */
  const dispatchSync = useCallback(
    (action: SearchSyncAction) => {
      // Reduce once, against the latest committed state via the ref. Not
      // inside a functional `setState` updater: Strict Mode double-invokes
      // those, which would run the reducer twice on the second pass see
      // `pending` already cleared and drop the emitted effect. This
      // pattern reduces exactly once, so the effect is captured exactly
      // once and the URL write is emitted exactly once.
      const { next, effect } = reduceSearchSync(syncStateRef.current, action)
      syncStateRef.current = next
      setSyncState(next)
      if (effect !== null && effect.type === "commit") {
        const trimmed = effect.value.trim()
        setParam(MOTION_QUERY_PARAM, trimmed === "" ? null : trimmed)
      }
    },
    [setParam],
  )

  // Latest `dispatchSync` behind a ref so the URL-observing effect below can
  // depend on `urlQuery` *by value alone*, not on `dispatchSync`'s identity.
  //
  // `dispatchSync` closes over `setParam` closes over `params` — and
  // `useSearchParams()` returns a new `URLSearchParams` reference on every
  // URL change, sibling filter clicks included. Including `dispatchSync` in
  // the effect's dep array would therefore re-fire the effect on every
  // URL write regardless of `?q=`, and even though the reducer's
  // `lastSeenUrlQuery` guard now no-ops the state change, an unguarded
  // `clearTimeout` inside the effect would still erase in-flight typing.
  // The ref keeps the dep array to `[urlQuery]`, which React compares by
  // value for a string primitive — the effect runs only when `?q=` itself
  // changes. This is the wiring half of the re-review's finding; the
  // reducer's `lastSeenUrlQuery` guard is the data-flow half.
  const dispatchSyncRef = useRef(dispatchSync)
  dispatchSyncRef.current = dispatchSync

  // Adopt whatever the URL now carries — `?q=…` from Back, Forward, Reset, a
  // shared link. The reducer guarantees this never emits a URL write of its
  // own; the pending timer is cleared here to match the state transition
  // (`pending` becomes `null`), so an old keystroke's timer cannot commit
  // against the new URL. Sibling URL writes (kind/year/wp) do not reach
  // here at all — see the dep-narrowing note above.
  useEffect(() => {
    dispatchSyncRef.current({ type: "urlChanged", urlQuery })
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [urlQuery])

  // On unmount, drop any pending timer so a delayed commit cannot navigate a
  // gone component. Runs once — the effect above handles the mid-life cases.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleSearchInput = useCallback(
    (value: string) => {
      dispatchSync({ type: "userTyped", value })
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        // The `commitFired` transition is the one that emits the URL-write
        // effect. The reducer inspects the current `pending` value against
        // the value the timer carried and drops itself if they diverged
        // (a newer keystroke replaced it, or a `urlChanged` cleared it).
        dispatchSync({ type: "commitFired", value })
      }, SEARCH_DEBOUNCE_MS)
    },
    [dispatchSync],
  )

  const options = useQuery(api.motions.getMotionFilterOptions, { wahlperiode })
  // Coverage for referrals — read **once at the page level** so the row
  // disclosure can distinguish an unbackfilled period from a motion that had
  // no referral. Same shape and reasoning as the explanation coverage query
  // on components/vote-detail.tsx. The cheap boolean form: `.first()` on
  // the period index, one document read at most — the count-form
  // `getReferralCoverage` is kept for operators (dashboard-side breakdown),
  // but the UI needs only whether the period holds anything at all, so
  // paying for a `.collect()` here would be a whole period's read for a
  // single bit. Per-row fetches would multiply into `results.length`
  // reads of the same answer.
  const hasAnyReferrals = useQuery(api.committeeReferrals.hasAnyReferralsForPeriod, {
    wahlperiode,
  })

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
  // The searched-but-empty-with-more-behind case: the pager still has pages
  // to yield, and this one filtered every visible row away. The list below
  // otherwise renders an empty `<ul>` with no explanation of why the "load
  // more" button underneath might still find matches — see the caveat that
  // consumes this.
  const searchedNothingYetHasMore =
    searching &&
    results.length === 0 &&
    !isLoadingFirstPage &&
    (status === "CanLoadMore" || status === "LoadingMore")

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
    // The visible state clears immediately; the URL follows below. The
    // reducer's `urlChanged` will land on the next render once the
    // `router.replace` propagates through `useSearchParams`, so this is
    // belt-and-braces — the box is empty in the same frame the click fired
    // rather than waiting on the round-trip.
    dispatchSync({ type: "urlChanged", urlQuery: "" })
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
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
            // `type="search"` is the site-wide contract set by
            // components/search-bar.tsx and components/mp-table.tsx: it
            // surfaces the mobile keyboard's "Search" key and the browser's
            // native ✕-clear affordance, both of which a plain text input
            // hides. Same benefit here, no cost.
            type="search"
            value={search}
            onChange={(event) => handleSearchInput(event.target.value)}
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
        <>
          {/* An empty page during a title search does not mean "no matches" —
              the header explains why. Without this cue the reader sees an
              empty box and a "load more" button and has to infer the
              relationship between them; with it, the button reads as an
              action rather than as a fallback for a broken empty state.
              Wrapped in `<div role="status" aria-live="polite">` so a
              screen reader hears the explanation appear alongside the
              first-page skeleton clearing. The loading skeleton above
              carries the same live region (`<output aria-live="polite">`,
              via the `LoadingFirstPage` branch) and the transition from
              "loading" to "no visible rows but more behind them" is
              itself the update worth announcing. Wrapping keeps
              `CaveatNote` untouched — the same shell is used by many
              non-live caveats elsewhere on the site. */}
          {searchedNothingYetHasMore ? (
            // `<output>` gives us `role="status"` implicitly (the same
            // semantic-element rule Biome enforces elsewhere) and the
            // `aria-live="polite"` completes the announcement contract.
            // Same shell the LoadingFirstPage skeleton above uses.
            <output aria-live="polite" className="contents">
              <CaveatNote>{t("motions.searchedNothingYetHasMore")}</CaveatNote>
            </output>
          ) : null}
          <ul className="flex list-none flex-col gap-2 p-0">
            {results.map((motion) => (
              <MotionRow
                key={motion.id}
                motion={motion}
                hasAnyReferralsForPeriod={hasAnyReferrals}
              />
            ))}
          </ul>
        </>
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
  hasAnyReferralsForPeriod,
}: {
  motion: {
    id: string
    title: string
    date: string
    type: string | null
    vorgangstyp: string | null
    drucksacheNr: string | null
    /** The DIP procedure id, from `motionInput`. Null when the motion was
     * ingested by its Drucksache alone — a real case, since a row reaches
     * the pipeline as *either* a Vorgang or a Drucksache and rarely both
     * (schema note on `motions`). The referrals index is keyed by Vorgang,
     * so a null here means the disclosure has no honest read to make. */
    dipVorgangId: string | null
  }
  /** Threaded through from the caller's `getReferralCoverage` read — see the
   * page-level comment. */
  hasAnyReferralsForPeriod: boolean | undefined
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
      {/* The referrals disclosure lives beside sponsors, both using the same
          skip-when-closed contract. Kept as its own slot rather than folded
          into sponsors because the two answer different questions and both
          have their own caveats — merging would be exactly the merge
          convex/committeeReferrals.ts's boundary is written to prevent.
          `motionId` rather than the Vorgang id for the panel id — the
          Vorgang can be null on any number of rows and a fallback
          sentinel would collide across all of them; the motion id is
          unique by construction. */}
      <CommitteeReferralsDisclosure
        motionId={motion.id}
        dipVorgangId={motion.dipVorgangId}
        hasAnyForPeriod={hasAnyReferralsForPeriod}
      />
    </li>
  )
}
