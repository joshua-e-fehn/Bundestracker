"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { EventTypeIcon } from "@/components/event-type-icon"
import { MPPhoto } from "@/components/mp-photo"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatDate, occupationOf } from "@/lib/bundestag"
import { foldSearchQuery } from "@/lib/search"
import type { EventType } from "@/lib/taxonomy"
import { expandQuery } from "@/lib/thesaurus"

/**
 * The result list: MPs, each with the records that matched.
 *
 * ## The evidence is the feature
 *
 * Every card says *why* this person is on the list — which motion, speech,
 * question or committee contained the keyword. Without it the search would be
 * asking the reader to take its word for it, and a search over parliamentary
 * data that cannot be checked is worth less than no search at all. It is also
 * the thing that makes an approximate lexicon (lib/thesaurus.ts) acceptable: a
 * spurious hit is visibly spurious, because the record that caused it is right
 * there.
 *
 * ## The folding happens here, not in Convex
 *
 * `foldSearchQuery` and `expandQuery` run in the browser and their output is
 * passed as arguments. Convex could do it — both modules are runtime-agnostic —
 * but doing it here is what lets the page *show* what it searched for
 * (`search.alsoSearched`), which a reader needs when a query for `lawyer`
 * returns a card whose evidence says `Rechtsanwalt`.
 */

type Reason = {
  eventType: EventType
  date: string
  title: string
  description: string | null
  referenceId: string | null
  referenceType: string | null
}

export function SearchResults({
  query,
  wahlperiode,
  fraktion,
  committee,
  eventType,
}: {
  /** The reader's raw query, exactly as typed. Folded below. */
  query: string
  wahlperiode: number
  fraktion?: string
  committee?: string
  eventType?: EventType
}) {
  const { t, locale } = useLocale()

  const folded = foldSearchQuery(query)
  const alsoSearch = expandQuery(folded)

  const result = useQuery(
    api.search.searchMPs,
    // `"skip"` rather than an empty query: a query with no terms is not a
    // search, and running one would spend a round-trip to be told so.
    folded ? { wahlperiode, query: folded, alsoSearch, fraktion, committee, eventType } : "skip",
  )

  if (!folded) {
    return <Notice>{t("search.prompt")}</Notice>
  }

  if (result === undefined) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (result.results.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Notice>{t("search.empty")}</Notice>
        {/* The hint names the one thing that does work — prefix matching — so
            an empty result reads as "spelled differently" rather than as "the
            Bundestag has never discussed this". */}
        <p className="text-muted-foreground text-sm">{t("search.emptyHint")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <p className="font-medium text-sm" aria-live="polite">
            {result.total === 1
              ? t("search.resultCountOne")
              : t("search.resultCount", { count: result.total })}
          </p>
          {alsoSearch.length > 0 && (
            // Named rather than silent: a card matching "Rechtsanwalt" for a
            // query of "lawyer" is otherwise inexplicable on the page.
            <p className="text-muted-foreground text-xs">
              {t("search.alsoSearched", { terms: alsoSearch.slice(0, 5).join(", ") })}
            </p>
          )}
        </div>

        <PartyBreakdown breakdown={result.breakdown} />

        {result.truncated && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
            {t("search.truncatedNotice")}
          </p>
        )}
      </div>

      <ul className="flex list-none flex-col gap-3 p-0">
        {result.results.map((mp) => (
          <li key={mp.mpInternalId}>
            <ResultCard
              mp={mp}
              // Rendered by the card rather than passed as text, so the date
              // format follows the reader's locale like every other date.
              locale={locale}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The party breakdown — "3 CDU, 2 SPD, 1 Grüne".
 *
 * Describes the whole result set rather than the page, which is why the count
 * comes from the server (convex/search.ts) instead of being tallied from the
 * rows below it. A breakdown computed in the browser would silently describe
 * only the first `MAX_RESULTS` and read as the composition of the answer.
 */
function PartyBreakdown({
  breakdown,
}: {
  breakdown: ReadonlyArray<{ fraktion: string; count: number }>
}) {
  const { t } = useLocale()
  if (breakdown.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs">{t("search.breakdown")}:</span>
      {breakdown.map((entry) => (
        <span key={entry.fraktion} className="inline-flex items-center gap-1">
          <PartyBadge fraktion={entry.fraktion} />
          <span className="font-medium text-xs tabular-nums">{entry.count}</span>
        </span>
      ))}
    </div>
  )
}

function ResultCard({
  mp,
  locale,
}: {
  mp: {
    mpInternalId: string
    name: string
    fraktion: string
    photoUrl: string | null
    constituency: string | null
    occupation: string | null
    matchCount: number
    reasons: readonly Reason[]
  }
  locale: Parameters<typeof formatDate>[1]
}) {
  const { t } = useLocale()
  const href = `/mps/${encodeURIComponent(mp.mpInternalId)}`
  const occupation = occupationOf({ occupation: mp.occupation })
  const hidden = mp.matchCount - mp.reasons.length

  return (
    <Card className="group relative gap-3 p-4 transition-colors hover:border-border hover:bg-accent/30">
      <div className="flex items-start gap-3">
        <MPPhoto name={mp.name} photoUrl={mp.photoUrl} className="size-11 shrink-0" />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Stretched over the card, so the whole card is the hit target
                while the name stays a real anchor — middle-click, "open in new
                tab" and the status-bar preview all keep working. The same
                pattern components/mp-card.tsx uses, and for the reason
                components/mp-table.tsx sets out at length. */}
            <Link
              href={href}
              className="font-medium outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {mp.name}
            </Link>
            <PartyBadge fraktion={mp.fraktion} />
          </div>

          <p className="text-muted-foreground text-xs">
            {[occupation, mp.constituency].filter(Boolean).join(" · ")}
          </p>
        </div>

        <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-medium text-xs tabular-nums">
          {mp.matchCount === 1
            ? t("search.matchCountOne")
            : t("search.matchCount", { count: mp.matchCount })}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("search.matchedBecause")}
        </p>
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {mp.reasons.map((reason) => (
            <li
              key={`${reason.eventType}-${reason.referenceId ?? reason.title}-${reason.date}`}
              className="flex items-start gap-2"
            >
              <EventTypeIcon type={reason.eventType} size="sm" className="mt-0.5" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="break-words">{reason.title}</span>
                {/* A committee seat has no date — it is held across the period
                    rather than taken on a day — so the empty string it carries
                    renders as nothing rather than as an invalid date. */}
                {reason.date ? (
                  <span className="ml-2 whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                    {formatDate(reason.date, locale)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          // The count of what is *not* shown, so a truncated list never reads
          // as the whole of someone's work on a subject.
          <p className="text-muted-foreground text-xs">
            {t("search.moreMatches", { count: hidden })}
          </p>
        )}
      </div>
    </Card>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
      {children}
    </p>
  )
}
