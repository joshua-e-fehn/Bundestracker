"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { MPCard } from "@/components/mp-card"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { api } from "@/convex/_generated/api"
import { formatApproximateCount, formatDateShort } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"

/**
 * The home page's data sections.
 *
 * ## Why these are client components
 *
 * AGENTS.md asks for server components by default, and these are the exception
 * it allows rather than an oversight. Two things force it: the language toggle
 * is client state (`LocaleProvider`), so every translated string is client-side
 * regardless; and `preloadQuery` needs a Convex URL at build time, which a
 * preview build without `NEXT_PUBLIC_CONVEX_URL` does not have — `next build`
 * would fail while collecting page data. `useQuery` also subscribes, so the
 * feed updates as the nightly sweep lands rather than at the next deploy.
 *
 * ## Three states, not two
 *
 * Every section distinguishes loading (skeleton), loaded-and-empty (a message),
 * and loaded-with-rows. The middle one is not decoration: the Python pipeline's
 * load stage is not implemented yet, so an empty database is the *current* state
 * of every deployment, and a section that renders a permanent skeleton is
 * indistinguishable from one that is broken.
 *
 * `useQuery` returns `undefined` for both "loading" and "skipped", so a section
 * whose period has not resolved shows the skeleton — correct here, since the
 * period query is itself in flight at that moment.
 */

// --- shared pieces --------------------------------------------------------

function SectionHeading({
  id,
  titleKey,
  subtitleKey,
  href,
}: {
  /** Goes on the `h2` itself, so the section's `aria-labelledby` resolves to
   * the heading text rather than to a wrapper containing the "show all" link
   * as well. */
  id: string
  titleKey: TranslationKey
  subtitleKey?: TranslationKey
  href?: string
}) {
  const { t } = useLocale()
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="grid gap-1">
        <h2 id={id} className="font-semibold text-lg tracking-tight">
          {t(titleKey)}
        </h2>
        {subtitleKey ? <p className="text-muted-foreground text-sm">{t(subtitleKey)}</p> : null}
      </div>
      {href ? (
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href={href}>
            {t("home.showAll")}
            <ArrowRightIcon />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

/**
 * What a section shows once it knows there is nothing to show.
 *
 * Deliberately not an error and not a spinner. The distinction the reader needs
 * is "this has loaded and is empty", and the hint says why — the pipeline has
 * not run — so an empty home page reads as a system waiting for data rather
 * than as a broken one.
 */
function EmptyState() {
  const { t } = useLocale()
  return (
    <div className="rounded-lg border border-border/60 border-dashed px-4 py-10 text-center">
      <p className="font-medium text-sm">{t("common.noData")}</p>
      <p className="mt-1 text-muted-foreground text-sm">{t("common.noDataHint")}</p>
    </div>
  )
}

function RowSkeletons({ count, height = "h-16" }: { count: number; height?: string }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <Skeleton key={index} className={`w-full ${height}`} />
      ))}
    </div>
  )
}

// --- summary stats --------------------------------------------------------

/**
 * The four headline figures.
 *
 * Each is rendered through `formatApproximateCount`, which appends `+` when the
 * backend reports the count as bounded — see the header of convex/stats.ts for
 * why two of these cannot be exact and why showing them as if they were would be
 * the worse failure.
 */
export function SummaryStats({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t, locale } = useLocale()
  const stats = useQuery(
    api.stats.getChamberStats,
    wahlperiode === null || wahlperiode === undefined ? "skip" : { wahlperiode },
  )

  const cards: ReadonlyArray<{
    labelKey: TranslationKey
    noteKey?: TranslationKey
    stat: { count: number; exact: boolean } | undefined
  }> = [
    { labelKey: "home.statMPs", stat: stats?.mps },
    {
      labelKey: "home.statNamedVotes",
      noteKey: "home.statNamedVotesNote",
      stat: stats?.namedVotes,
    },
    { labelKey: "home.statMotions", stat: stats?.motions },
    // Speech *contributions*: one row is one speaker's turn, not one speech.
    // The label carries that; see the note in lib/i18n.ts.
    { labelKey: "home.statSpeeches", stat: stats?.speeches },
  ]

  return (
    <section aria-labelledby="stats-heading">
      <h2 id="stats-heading" className="sr-only">
        {t("home.statsTitle")}
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ labelKey, noteKey, stat }) => (
          <Card key={labelKey} size="sm" className="gap-0 p-4">
            <div className="font-semibold text-2xl tabular-nums sm:text-3xl">
              {stat === undefined ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                formatApproximateCount(stat.count, stat.exact, locale)
              )}
            </div>
            <div className="mt-1 font-medium text-muted-foreground text-sm">{t(labelKey)}</div>
            {noteKey ? (
              <p className="mt-2 text-[0.7rem] text-muted-foreground/80 leading-snug">
                {t(noteKey)}
              </p>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  )
}

// --- top MPs --------------------------------------------------------------

/** How many MPs the leaderboard preview shows. */
const TOP_MP_COUNT = 5

export function TopMPs({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const skip = wahlperiode === null || wahlperiode === undefined
  const rankings = useQuery(
    api.activityScores.getRankings,
    // `month: null` is the whole-period total, not a missing argument — the
    // monthly rows are the contribution-graph cells. See convex/schema.ts.
    skip ? "skip" : { wahlperiode, month: null, limit: TOP_MP_COUNT },
  )

  return (
    <section aria-labelledby="top-mps-heading">
      <SectionHeading
        id="top-mps-heading"
        titleKey="home.topMPsTitle"
        subtitleKey="home.topMPsSubtitle"
        href="/rankings"
      />
      {rankings === undefined ? (
        <RowSkeletons count={TOP_MP_COUNT} height="h-[4.5rem]" />
      ) : rankings.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-2">
          {rankings.map((entry) => (
            <MPCard
              key={entry.mpInternalId}
              mpInternalId={entry.mpInternalId}
              name={entry.name}
              fraktion={entry.fraktion}
              photoUrl={entry.photoUrl}
              totalScore={entry.totalScore}
              rank={entry.rank}
              // Five cards, five calendar queries — bounded, and this is the
              // section where the product's premise is on display.
              showHeatmap
            />
          ))}
        </div>
      )}
    </section>
  )
}

// --- latest named votes ---------------------------------------------------

const LATEST_VOTE_COUNT = 5

export function LatestVotes({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { locale } = useLocale()
  const skip = wahlperiode === null || wahlperiode === undefined
  const sheets = useQuery(
    api.votes.getVoteSheets,
    skip ? "skip" : { wahlperiode, limit: LATEST_VOTE_COUNT },
  )

  return (
    <section aria-labelledby="latest-votes-heading">
      <SectionHeading id="latest-votes-heading" titleKey="home.latestVotesTitle" href="/votes" />
      {sheets === undefined ? (
        <RowSkeletons count={LATEST_VOTE_COUNT} height="h-14" />
      ) : sheets.length === 0 ? (
        <EmptyState />
      ) : (
        <Card size="sm" className="gap-0 divide-y divide-border/60 p-0">
          {sheets.map((sheet) => (
            <Link
              key={sheet.id}
              href={`/votes/${sheet.id}`}
              className="flex items-center gap-3 px-4 py-3 outline-none transition-colors first:rounded-t-[inherit] last:rounded-b-[inherit] hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">{sheet.title}</div>
                <div className="mt-0.5 text-muted-foreground text-xs tabular-nums">
                  {formatDateShort(sheet.date, locale)}
                </div>
              </div>
              <VoteOutcomeBadge result={sheet.result} locale={locale} />
            </Link>
          ))}
        </Card>
      )}
    </section>
  )
}

// --- activity feed --------------------------------------------------------

const FEED_COUNT = 10

/** Event kinds are a closed union in the schema, so unlike a vote result this
 * one *can* be a lookup — and the typecheck enforces that a new kind gets a
 * translation before it can be rendered. */
const EVENT_LABEL_KEYS: Record<string, TranslationKey> = {
  motion: "event.motion",
  speech: "event.speech",
  vote: "event.vote",
  question: "event.question",
  bill: "event.bill",
  committee: "event.committee",
  activity: "event.activity",
}

export function ActivityFeedPreview({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t, locale } = useLocale()
  const skip = wahlperiode === null || wahlperiode === undefined
  const feed = useQuery(
    api.activityEvents.getChamberFeed,
    skip ? "skip" : { wahlperiode, limit: FEED_COUNT },
  )

  return (
    <section aria-labelledby="feed-heading">
      <SectionHeading id="feed-heading" titleKey="home.feedTitle" href="/feed" />
      {feed === undefined ? (
        <RowSkeletons count={FEED_COUNT} height="h-12" />
      ) : feed.length === 0 ? (
        <EmptyState />
      ) : (
        <Card size="sm" className="gap-0 divide-y divide-border/60 p-0">
          {feed.map(({ event, name, fraktion }) => (
            <div key={event.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={`/mps/${encodeURIComponent(event.mpInternalId)}`}
                    className="rounded-md font-medium text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {name}
                  </Link>
                  <PartyBadge fraktion={fraktion} />
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">{event.title}</p>
              </div>
              <div className="shrink-0 text-right">
                <Badge variant="secondary">
                  {t(EVENT_LABEL_KEYS[event.eventType] ?? "event.activity")}
                </Badge>
                <div className="mt-1 text-muted-foreground text-xs tabular-nums">
                  {formatDateShort(event.date, locale)}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}
