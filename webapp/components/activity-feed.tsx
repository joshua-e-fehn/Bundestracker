"use client"

import { usePaginatedQuery, useQuery } from "convex/react"
import { useMemo, useState } from "react"
import { ActivityFeedItem } from "@/components/activity-feed-item"
import { CaveatNote } from "@/components/caveat-note"
import { EVENT_TYPE_STYLES, EventTypeIcon } from "@/components/event-type-icon"
import { FilterChips } from "@/components/filter-chips"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { api } from "@/convex/_generated/api"
import { type GroupableEvent, groupFeedEvents } from "@/lib/feed-grouping"
import { scoreGroup, sortableScore } from "@/lib/feed-scoring"
import { formatScore } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"
import { resolveWeights } from "@/lib/scoring"
import { EVENT_TYPES, type EventType } from "@/lib/taxonomy"

/**
 * The activity feed: filters, a list, and a "load more".
 *
 * ## One type at a time, on purpose
 *
 * The chips are multi-select in appearance and the query takes one type. That
 * is not an oversight — it is where the honest boundary falls. A type-filtered
 * feed is an indexed range scan (`by_wahlperiode_and_eventType_and_date`); *two*
 * types is two scans merged by date, and merging two paginated cursors client
 * side produces exactly the bug convex/schema.ts warns about in the per-MP
 * case: each stream's page has its own cutoff, so the merge silently drops the
 * older stream's rows past it.
 *
 * So selecting a second chip replaces the first, and the chips read as what
 * they are. `FilterChips` stays multi-select because the component is shared and
 * the *next* filter to use it may genuinely be one; this caller narrows.
 *
 * ## Why the group filter is a dropdown and not chips
 *
 * Because it behaves differently, and looking different is the point. Event
 * type narrows the query; Fraktion narrows the page after it is read (see
 * convex/feed.ts). Rendering both as identical chip rows would suggest they
 * cost the same and page the same, and they do not.
 *
 * ## Sorting and filtering by score order what is loaded, and say so
 *
 * Neither can be a query. The feed pages with a cursor over
 * `by_wahlperiode_and_date`, and a score is not on an event at all — it is
 * re-derived per row from the weights (lib/feed-scoring.ts), and the row it
 * belongs to is a *group*, which only exists after the page has been read and
 * collapsed on the client. A server-side score sort would need a stored score,
 * an index over it, and grouping moved into the query — the last of which
 * convex/feed.ts is arranged specifically to avoid, because grouping changes how
 * many rows a page holds and the cursor is defined over events.
 *
 * So both are client-side over the accumulated results, like
 * components/mp-table.tsx sorts its preloaded roster. The cost is that they
 * order and narrow *what has been loaded*, not the period — and a sorted list
 * looks complete, so that boundary is stated on the page rather than left for
 * the reader to infer. "Load more" keeps working and keeps feeding both.
 */

const PAGE_SIZE = 25

/**
 * Page size while a Fraktion filter is set.
 *
 * The group filter is applied *after* the page is read (see convex/feed.ts), so
 * it keeps roughly `groupSeats / chamberSeats` of each fetch — about one row in
 * eight for a large group, one in fifty for a small one. `usePaginatedQuery`
 * fetches once per `loadMore` rather than refilling, so at 25 a filtered feed
 * would deliver a page of two and look empty.
 *
 * Eight times the size rather than an arbitrary large number: the smallest real
 * Fraktion is 3 of 630 seats (§9), and no page size makes *that* case dense.
 * This makes the common ones readable without turning every fetch into a scan.
 */
const FILTERED_PAGE_SIZE = PAGE_SIZE * 8

/** Sentinel for "no group filter". `Select` cannot take an empty-string item
 * value — Radix reserves it to mean "clear" — so the absence needs a name. */
const ALL_FRAKTIONEN = "__all__"

/**
 * How the loaded rows are ordered.
 *
 * `chronological` is the feed's own order — the one the query returned — and
 * stays the default: a feed is a record of what happened, and reordering it by
 * anything is a view of that record rather than the record itself.
 */
const FEED_SORTS = ["chronological", "score"] as const
type FeedSort = (typeof FEED_SORTS)[number]

/** `Record<FeedSort, TranslationKey>` rather than `…, string>`: the latter
 * widens the values and `t()` would take them as untyped strings, so a
 * mistyped key here would render as its own name instead of failing the
 * typecheck. Same guard components/rankings-filters.tsx uses for `AGE_LABEL_KEYS`. */
const SORT_LABEL_KEYS: Record<FeedSort, TranslationKey> = {
  chronological: "feed.sort.chronological",
  score: "feed.sort.score",
}

export function ActivityFeed({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const [types, setTypes] = useState<EventType[]>([])
  const [fraktion, setFraktion] = useState<string>(ALL_FRAKTIONEN)
  const [sort, setSort] = useState<FeedSort>("chronological")
  const [minScore, setMinScore] = useState(0)

  const options = useQuery(api.feed.getFeedFilterOptions, { wahlperiode })

  /**
   * The reader's own weights, if they have saved any.
   *
   * A signed-in user re-weights their view (`userPreferences.customWeights`), and
   * a feed scoring at the defaults while the rest of the site scored at theirs
   * would make the same act worth two different numbers on two pages.
   * `resolveWeights` handles the null that means "no override", so a signed-out
   * reader gets the defaults through the same path rather than a branch here.
   */
  const preferences = useQuery(api.userPreferences.getPreferences, {})
  const weights = useMemo(
    () => resolveWeights(preferences?.customWeights ?? null),
    [preferences?.customWeights],
  )

  // Larger pages while a group filter is set — see FILTERED_PAGE_SIZE.
  const pageSize = fraktion === ALL_FRAKTIONEN ? PAGE_SIZE : FILTERED_PAGE_SIZE

  const { results, status, loadMore } = usePaginatedQuery(
    api.feed.getFeed,
    {
      wahlperiode,
      // Only ever one — see the header. `undefined` is "every type", which is
      // the unfiltered index rather than a filter matching everything.
      eventType: types[0],
      fraktion: fraktion === ALL_FRAKTIONEN ? undefined : fraktion,
    },
    { initialNumItems: pageSize },
  )

  /**
   * "Now", fixed for the whole list.
   *
   * Read once here and passed down rather than read per row: `Date.now()` in a
   * component body differs between the server render and the hydration pass,
   * which makes React warn, and fifty rows each reading the clock can straddle
   * midnight and label two same-day events differently. Deliberately not
   * refreshed on an interval — a feed whose timestamps tick while being read is
   * a distraction, and a reload is the natural refresh.
   */
  const nowMs = useMemo(() => Date.now(), [])

  /**
   * Joint acts collapsed into one row each.
   *
   * Applied to the *accumulated* results rather than inside `convex/feed.ts`,
   * and that placement is the point: the pagination cursor is defined over
   * events, so grouping server-side would deliver a page of 25 as 3 rows and
   * reintroduce the short-page ambiguity that module is built to avoid. Here a
   * group split across a page boundary simply merges when the next page lands,
   * because `results` grows rather than being replaced.
   *
   * See lib/feed-grouping.ts for what groups and — more importantly — what
   * must not.
   */
  const groups = useMemo(() => groupFeedEvents(results as unknown as GroupableEvent[]), [results])

  /**
   * Each row with its score, scored once.
   *
   * Here rather than inside the row component so a weight change re-scores the
   * list in one pass, and so the sort and the threshold below read the same
   * numbers the rows display — computing per row would let a filter drop a row
   * on a figure different from the one printed on it.
   */
  const scored = useMemo(
    () =>
      groups.map((group) => ({
        group,
        score: scoreGroup(
          { eventType: group.eventType, title: group.title, count: group.actors.length },
          weights,
        ),
      })),
    [groups, weights],
  )

  /** The slider's ceiling, from the loaded rows and rounded up so the top one
   * sits inside the range rather than exactly at its end. Derived rather than
   * fixed, like components/mp-table.tsx's: a group's total scales with its
   * signature count and has no natural bound. */
  const maxScore = useMemo(
    () => Math.ceil(Math.max(0, ...scored.map((row) => sortableScore(row.score))) / 10) * 10,
    [scored],
  )

  /**
   * The threshold actually applied, clamped to a ceiling that can move under it.
   *
   * `maxScore` is derived from the loaded rows, so it *falls* when the reader
   * narrows to a type whose rows all score low. Without the clamp the stored
   * `minScore` would stay above the new ceiling: `Slider` pins its thumb to
   * `max` — so the control would read "20" while filtering at 200, every row
   * would vanish, and dragging to the far left would not bring them back
   * because the thumb was already there. Clamping here rather than in an effect
   * keeps the displayed value, the filter and the control the same number
   * without a render pass where they disagree.
   *
   * The reader's own `minScore` is deliberately not overwritten: widening the
   * type filter again restores the ceiling, and with it the threshold they set.
   */
  const threshold = Math.min(minScore, maxScore || 100)

  /**
   * The rows as displayed: filtered, then ordered.
   *
   * A row with no apportionable score is kept at threshold zero and dropped
   * above it. Keeping it would be worse than either alternative looks: the
   * reader asked for "at least N points" and a row that cannot be compared to N
   * cannot satisfy it — but at zero nothing is being asked, so hiding every vote
   * and speech would read as missing data. `feed.filter.minScoreNote` says which
   * of the two is happening.
   *
   * The sort is stable in both modes: `Array.prototype.sort` is stable per spec,
   * so equal scores keep the chronological order they arrived in rather than
   * shuffling as later pages land.
   */
  const visible = useMemo(() => {
    const kept =
      threshold <= 0
        ? scored
        : scored.filter((row) => row.score.total !== null && row.score.total >= threshold)
    return sort === "score"
      ? [...kept].sort((a, b) => sortableScore(b.score) - sortableScore(a.score))
      : kept
  }, [scored, sort, threshold])

  const hiddenByScore = scored.length - visible.length

  const chipOptions = useMemo(
    () =>
      EVENT_TYPES.map((type) => {
        const stat = options?.eventTypes.find((entry) => entry.value === type)
        return {
          value: type,
          label: t(EVENT_TYPE_STYLES[type].labelKey),
          icon: <EventTypeIcon type={type} size="sm" />,
          count: stat?.count,
          atLeast: stat?.atLeast,
        }
      }),
    [options, t],
  )

  const isLoadingFirstPage = status === "LoadingFirstPage"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <FilterChips
          options={chipOptions}
          selected={types}
          // Keeps the *last* chip pressed rather than the first, so pressing a
          // second one reads as "switch to this" rather than as a no-op.
          onChange={(next) => setTypes(next.slice(-1))}
          allLabel={t("feed.allTypes")}
          label={t("feed.filterByType")}
        />

        <div className="flex flex-wrap items-end gap-3">
          <Select value={fraktion} onValueChange={setFraktion}>
            <SelectTrigger
              className="w-[15rem] max-w-full"
              aria-label={t("rankings.filter.fraktion")}
            >
              <SelectValue placeholder={t("rankings.filter.allFraktionen")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FRAKTIONEN}>{t("rankings.filter.allFraktionen")}</SelectItem>
              {options?.fraktionen.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.value} ({entry.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(value) => setSort(value as FeedSort)}>
            <SelectTrigger className="w-[13rem] max-w-full" aria-label={t("feed.sort.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEED_SORTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(SORT_LABEL_KEYS[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* The threshold, in the shape components/mp-table.tsx established for
              its score slider: the readout lives inside the `<Label>` with
              `tabular-nums`, and `mt-3` compensates for the thumb's optical
              offset. Same control, same place to look. */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="feed-min-score">
              {t("feed.filter.minScore")}
              <span className="ml-1 text-muted-foreground tabular-nums">
                {formatScore(threshold, locale)}
              </span>
            </Label>
            <Slider
              id="feed-min-score"
              min={0}
              max={maxScore || 100}
              step={Math.max(1, Math.round((maxScore || 100) / 100))}
              value={[threshold]}
              onValueChange={([value]) => setMinScore(value)}
              className="mt-3 w-[12rem] max-w-full"
            />
          </div>

          {(sort !== "chronological" || threshold > 0) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSort("chronological")
                setMinScore(0)
              }}
            >
              {t("common.reset")}
            </Button>
          )}
        </div>

        {/* The honest boundary of both controls, stated rather than implied — a
            sorted list looks complete. Only once either is actually in use: a
            reader on the default chronological feed is not being shown a
            reordering and does not need to be warned about one. */}
        {(sort === "score" || threshold > 0) && (
          <CaveatNote>
            {t("feed.sort.loadedOnly")}
            {threshold > 0 && ` ${t("feed.filter.minScoreNote")}`}
            {hiddenByScore > 0 && ` ${t("feed.filter.hidden", { count: hiddenByScore })}`}
          </CaveatNote>
        )}
      </div>

      {isLoadingFirstPage ? (
        <output className="flex flex-col gap-3" aria-live="polite">
          <span className="sr-only">{t("common.loading")}</span>
          {Array.from({ length: 6 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
            <Skeleton key={index} className="h-24 w-full rounded-lg" />
          ))}
        </output>
      ) : results.length === 0 && status === "Exhausted" ? (
        // Only once the source is exhausted. A group filter can empty an early
        // page while events remain further down (see convex/feed.ts), and
        // "keine Aktivitäten" is a claim about the data — not about this page.
        // Until then the "load more" below stays offered instead.
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("feed.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* The threshold can empty a page that has rows, which is a different
              statement from `feed.empty` — that one is a claim about the data,
              this is a claim about the filter. Offering the reader the way out
              rather than the dead end. */}
          {visible.length === 0 && threshold > 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border border-dashed p-8 text-center">
              <p className="text-muted-foreground text-sm">
                {t("feed.filter.hidden", { count: hiddenByScore })}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => setMinScore(0)}>
                {t("common.reset")}
              </Button>
            </div>
          ) : (
            visible.map(({ group, score }) => (
              <ActivityFeedItem key={group.id} group={group} score={score} nowMs={nowMs} />
            ))
          )}
        </div>
      )}

      <div className="flex justify-center">
        {status === "CanLoadMore" && (
          <Button variant="outline" onClick={() => loadMore(pageSize)}>
            {t("common.loadMore")}
          </Button>
        )}
        {status === "LoadingMore" && (
          <Skeleton className="h-9 w-32 rounded-md" aria-label={t("common.loading")} />
        )}
        {status === "Exhausted" && results.length > 0 && (
          <p className="text-muted-foreground text-xs">{t("feed.end")}</p>
        )}
      </div>
    </div>
  )
}
