"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon, Info } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { MPCard } from "@/components/mp-card"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { api } from "@/convex/_generated/api"
import { groupFeedEvents } from "@/lib/feed-grouping"
import { formatApproximateCount, formatDateShort, formatScore } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"
import { partyByKey, partyKeyColor } from "@/lib/parties"
import { rankPartiesBy } from "@/lib/party-comparison"

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
              <p className="mt-2 text-[0.7rem] text-muted-foreground leading-snug">
                {t(noteKey)}
              </p>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  )
}

// --- top and bottom MPs ---------------------------------------------------

/** How many MPs each leaderboard preview shows. */
const TOP_MP_COUNT = 5

/**
 * One end of the activity leaderboard.
 *
 * Both ends are the same component with `direction` flipped, because they are
 * the same list read from opposite ends of one ordered index (see
 * `getRankings`). Two components would be this one copied, and the copy is how
 * the two columns of the home page come to render at different heights or drop
 * the heatmap from one of them.
 *
 * `caveatKey` is the asymmetry between them, and the only one. The top of a
 * leaderboard needs no defence; the bottom is read as an accusation, and the
 * score measures *recorded* activity — so the bottom passes a caveat and the
 * top does not. Optional rather than defaulted to empty, so the section that
 * needs one and lacks it is visibly missing something.
 */
function ActivityBoard({
  wahlperiode,
  direction,
  headingId,
  titleKey,
  subtitleKey,
  caveatKey,
}: {
  wahlperiode: number | null | undefined
  direction: "asc" | "desc"
  headingId: string
  titleKey: TranslationKey
  subtitleKey: TranslationKey
  caveatKey?: TranslationKey
}) {
  const { t } = useLocale()
  const skip = wahlperiode === null || wahlperiode === undefined
  const rankings = useQuery(
    api.activityScores.getRankings,
    // `month: null` is the whole-period total, not a missing argument — the
    // monthly rows are the contribution-graph cells. See convex/schema.ts.
    skip ? "skip" : { wahlperiode, month: null, limit: TOP_MP_COUNT, direction },
  )

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <SectionHeading
        id={headingId}
        titleKey={titleKey}
        subtitleKey={subtitleKey}
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
              // No rank number on the ascending board. `getRankings` numbers
              // its slice from 1 in both directions, so a "1" here would read
              // as "the least active member in the Bundestag" — a claim about
              // the whole chamber that a five-row take cannot support, and one
              // this section's caveat exists to avoid making.
              rank={direction === "desc" ? entry.rank : undefined}
              // Ten cards, ten calendar queries — bounded, and this is the
              // section where the product's premise is on display. The strip
              // is also what makes a low score legible: a nearly empty band
              // shows *when* the quiet was, which the number alone does not.
              showHeatmap
            />
          ))}
        </div>
      )}
      {caveatKey !== undefined && (
        // Beside the number rather than behind a link, matching how every
        // leaderboard on /rankings carries its own. `mt-auto` so the caveat
        // sits at the bottom of the column, keeping the two boards' card rows
        // aligned with each other rather than pushing this one's up.
        <p className="mt-auto flex gap-2 pt-3 text-muted-foreground text-xs leading-relaxed">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {t(caveatKey)}
        </p>
      )}
    </section>
  )
}

/** The five highest activity scores of the period. */
export function TopMPs({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  return (
    <ActivityBoard
      wahlperiode={wahlperiode}
      direction="desc"
      headingId="top-mps-heading"
      titleKey="home.topMPsTitle"
      subtitleKey="home.topMPsSubtitle"
    />
  )
}

/**
 * The five lowest — the other half of the same claim.
 *
 * Shown because a tracker that only publishes the top of its own ranking is
 * publishing a highlight reel: the premise here is that the measure is
 * objective and inspectable (AGENTS.md), and a measure whose unflattering end
 * is hidden cannot be inspected. It comes with the caveat that end requires.
 */
export function BottomMPs({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  return (
    <ActivityBoard
      wahlperiode={wahlperiode}
      direction="asc"
      headingId="bottom-mps-heading"
      titleKey="home.bottomMPsTitle"
      subtitleKey="home.bottomMPsSubtitle"
      caveatKey="home.bottomMPsCaveat"
    />
  )
}

// --- party comparison -----------------------------------------------------

/**
 * The Fraktionen, ranked by mean activity — the home page's link to `/parties`.
 *
 * A compact ranked list rather than a chart. The dashboard's radar needs its
 * normalisation caveat to be readable at all (see `buildRadarSeries`), and a
 * caveat that long does not belong in a home-page card; a bar chart would need
 * an axis, a legend and the same explanation of what a mean is. Six rows with a
 * proportional rule need none of it — the number is printed, and the rule is
 * read as "more" without claiming a unit.
 *
 * `parties.meansNotice` is not repeated here, but the subtitle says "je
 * Mandat" / "per mandate", which is the part a reader must not miss: these are
 * averages, and a party total would be several times larger. The full reasoning
 * is one click away on the page these rows link to.
 */
export function PartyComparisonPreview({
  wahlperiode,
}: {
  wahlperiode: number | null | undefined
}) {
  const { t, locale } = useLocale()
  const skip = wahlperiode === null || wahlperiode === undefined
  const comparison = useQuery(api.parties.getPartyComparison, skip ? "skip" : { wahlperiode })

  // Only groups the sweep has scored: a mean over nobody is undefined, and a
  // bar at the origin would put an unscored Fraktion at the bottom of a ranking
  // it is not in. `rankPartiesBy` is the shared rule — the dashboard's table and
  // this card must not disagree about who leads.
  const ranked = rankPartiesBy(comparison?.parties ?? [], "totalScore")
  // The scale's top, so the rules are proportional to the leader rather than to
  // an invented ceiling. Guarded because a chamber where every scored member
  // scored zero is a real state on a fresh deployment.
  const leader = ranked[0]?.means.totalScore ?? 0

  return (
    <section aria-labelledby="parties-heading">
      <SectionHeading
        id="parties-heading"
        titleKey="home.partiesTitle"
        subtitleKey="home.partiesSubtitle"
        href="/parties"
      />
      {comparison === undefined ? (
        <RowSkeletons count={5} height="h-9" />
      ) : ranked.length === 0 ? (
        <EmptyState />
      ) : (
        <Card size="sm" className="gap-0 divide-y divide-border/60 p-0">
          {ranked.map((row) => {
            const party = partyByKey(row.partyKey)
            const color = partyKeyColor(party.key)
            return (
              <Link
                key={row.partyKey}
                href={`/parties/${row.partyKey}`}
                className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors first:rounded-t-[inherit] last:rounded-b-[inherit] hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="w-20 shrink-0 truncate font-medium text-sm">{party.label}</span>
                <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${leader > 0 ? (row.means.totalScore / leader) * 100 : 0}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
                <span className="shrink-0 text-right font-medium text-sm tabular-nums">
                  {formatScore(row.means.totalScore, locale)}
                </span>
              </Link>
            )
          })}
        </Card>
      )}
      {/* The one thing this card cannot be read without: every figure is an
          average over a group's scored members, not the group's output. */}
      <p className="mt-3 flex gap-2 text-muted-foreground text-xs leading-relaxed">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {t("parties.smallGroupCaveat")}
      </p>
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
    // Over-fetched: `FEED_COUNT` is how many *rows* this card shows, and
    // grouping turns many events into one row. A Kleine Anfrage signed by forty
    // members would otherwise be the entire preview — ten rows of one document.
    // Four times is enough for the common case without turning a ten-row card
    // into a scan; a group larger than that simply consumes the whole fetch and
    // the card shows fewer rows, which is honest rather than padded.
    skip ? "skip" : { wahlperiode, limit: FEED_COUNT * 4 },
  )

  // Same collapse as the feed page, and the same module — a second grouping
  // rule here is how the preview and the page it links to come to disagree
  // about what one entry is. See lib/feed-grouping.ts.
  const groups = useMemo(
    () =>
      groupFeedEvents(
        (feed ?? []).map(({ event, name, fraktion }) => ({
          ...event,
          name,
          fraktion,
          // `getChamberFeed` joins the name and group but not the portrait.
          // Null rather than fetching it: this card renders no avatars, so the
          // extra field would be read and discarded.
          photoUrl: null,
        })),
      ).slice(0, FEED_COUNT),
    [feed],
  )

  return (
    <section aria-labelledby="feed-heading">
      <SectionHeading id="feed-heading" titleKey="home.feedTitle" href="/feed" />
      {feed === undefined ? (
        <RowSkeletons count={FEED_COUNT} height="h-12" />
      ) : groups.length === 0 ? (
        <EmptyState />
      ) : (
        <Card size="sm" className="gap-0 divide-y divide-border/60 p-0">
          {groups.map((group) => (
            <div key={group.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {/* The first name and a count, not every name: this is a
                      ten-row preview, and the feed page is where a joint act's
                      full list belongs. "+ 39 weitere" rather than a rank —
                      DIP publishes no signing order, so the first name here is
                      the first the query returned and nothing more. */}
                  <Link
                    href={`/mps/${encodeURIComponent(group.actors[0].mpInternalId)}`}
                    className="rounded-md font-medium text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {group.actors[0].name}
                  </Link>
                  {group.actors.length > 1 ? (
                    <span className="text-muted-foreground text-xs">
                      {t("feed.andOthers", { count: group.actors.length - 1 })}
                    </span>
                  ) : (
                    <PartyBadge fraktion={group.actors[0].fraktion} />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">{group.title}</p>
              </div>
              <div className="shrink-0 text-right">
                <Badge variant="secondary">
                  {t(EVENT_LABEL_KEYS[group.eventType] ?? "event.activity")}
                </Badge>
                <div className="mt-1 text-muted-foreground text-xs tabular-nums">
                  {formatDateShort(group.date, locale)}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}
