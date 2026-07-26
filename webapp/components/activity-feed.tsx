"use client"

import { usePaginatedQuery, useQuery } from "convex/react"
import { useMemo, useState } from "react"
import { ActivityFeedItem, type FeedEvent } from "@/components/activity-feed-item"
import { EVENT_TYPE_STYLES, EventTypeIcon } from "@/components/event-type-icon"
import { FilterChips } from "@/components/filter-chips"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
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

export function ActivityFeed({ wahlperiode }: { wahlperiode: number }) {
  const { t } = useLocale()
  const [types, setTypes] = useState<EventType[]>([])
  const [fraktion, setFraktion] = useState<string>(ALL_FRAKTIONEN)

  const options = useQuery(api.feed.getFeedFilterOptions, { wahlperiode })

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

        <div className="flex items-center gap-2">
          <Select value={fraktion} onValueChange={setFraktion}>
            <SelectTrigger className="w-[15rem]" aria-label={t("rankings.filter.fraktion")}>
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
        </div>
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
          {results.map((event) => (
            <ActivityFeedItem key={event.id} event={event as FeedEvent} nowMs={nowMs} />
          ))}
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
