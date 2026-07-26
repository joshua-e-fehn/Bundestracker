<<<<<<< HEAD
import Link from "next/link"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MPPhoto } from "@/components/mp-photo"
import { Card } from "@/components/ui/card"
import { formatNumber } from "@/lib/bundestag"
import { heatmapLevel } from "@/lib/heatmap"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * One MP, at a glance — photo, name, group, score, and a sparkline of recent
 * months.
 *
 * A server component: nothing here is interactive beyond the link, and the
 * whole card is public data (AGENTS.md's default — client components only where
 * interactivity is needed). The caller passes the data in rather than the card
 * querying for it, because the places that show cards show many, and a query
 * per card is the shape `mpLabel` exists to avoid.
 *
 * The mini heatmap is *monthly*, unlike the daily grid on the profile. Twelve
 * cells fit in a card; 365 do not, and shrinking them below a pixel would draw
 * a line rather than a graph. It reads `activityScores`' monthly rows, which is
 * the grain those rows exist at.
 */

export type MPCardData = {
  internalId: string
  name: string
  fraktion: string
  constituency: string | null
  photoUrl: string | null
  /** Period total under the stored (default) weights. Null when the cron has
   * not scored this MP — distinct from a score of zero, and rendered as such. */
  totalScore: number | null
  /** Recent months, oldest first, as `{month, count}`. Empty is fine; the strip
   * simply does not render. */
  monthlyActivity?: ReadonlyArray<{ month: string; count: number }>
}

export function MPCard({
  mp,
  locale,
  className,
}: {
  mp: MPCardData
  locale: Locale
  className?: string
}) {
  return (
    <Card className={cn("p-0 transition-colors hover:bg-muted/40", className)}>
      <Link
        href={`/mps/${encodeURIComponent(mp.internalId)}`}
        className="flex items-center gap-3 p-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <MPPhoto name={mp.name} photoUrl={mp.photoUrl} className="size-12" />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* `truncate` needs the min-w-0 above: a flex child's default
              min-width is its content, so a long name would widen the card
              instead of ellipsising. */}
          <span className="truncate font-medium text-sm">{mp.name}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <FraktionBadge fraktion={mp.fraktion} />
            {mp.constituency ? (
              <span className="truncate text-muted-foreground text-xs">{mp.constituency}</span>
            ) : (
              <span className="text-muted-foreground text-xs">{t("mps.listMandate", locale)}</span>
            )}
          </div>
          {mp.monthlyActivity && mp.monthlyActivity.length > 0 ? (
            <MiniHeatmap months={mp.monthlyActivity} locale={locale} />
          ) : null}
        </div>

        <div className="flex flex-col items-end">
          <span className="font-semibold text-lg tabular-nums">
            {mp.totalScore === null ? "—" : formatNumber(mp.totalScore, locale)}
          </span>
          <span className="text-muted-foreground text-xs">{t("mp.activityScore", locale)}</span>
        </div>
      </Link>
    </Card>
  )
}

const LEVEL_CLASSES = [
  "bg-muted",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const

/** A row of month cells, shaded like the full grid. Scaled to this MP's own
 * busiest month for the reason `heatmapLevel` gives: an absolute scale renders
 * a backbencher's whole year flat. */
function MiniHeatmap({
  months,
  locale,
}: {
  months: ReadonlyArray<{ month: string; count: number }>
  locale: Locale
}) {
  const max = Math.max(0, ...months.map((entry) => entry.count))
  return (
    <div
      className="mt-0.5 flex gap-[2px]"
      // `role="img"` so the label is valid and the strip is announced as one
      // thing: on a card this is a sparkline, and the per-cell detail lives on
      // the profile page. A bare aria-label on a div labels nothing.
      role="img"
      aria-label={t("heatmap.title", locale)}
    >
      {months.map((entry) => (
        <span
          key={entry.month}
          className={cn("h-2 w-[7px] rounded-[1px]", LEVEL_CLASSES[heatmapLevel(entry.count, max)])}
=======
"use client"

import Link from "next/link"
import { useQuery } from "convex/react"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card } from "@/components/ui/card"
import { api } from "@/convex/_generated/api"
import { formatScore, initials } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * One MP, as a card: portrait, name, Fraktion, activity score, recent activity.
 *
 * The shared unit of every list on the site — the rankings, a Fraktion's roster,
 * a follow list — so it takes the fields those lists already have joined onto
 * their rows (`getRankings` and `getChamberFeed` both denormalise name, fraktion
 * and photoUrl for exactly this reason) rather than fetching the MP itself.
 *
 * The heatmap is the exception and is opt-in: it needs its own query per card,
 * which is fine for the five cards on the home page and would not be for a
 * 630-row roster. See `showHeatmap`.
 */

/** How many days of history the mini heatmap shows. Twelve weeks: enough to see
 * a rhythm, few enough that the strip stays legible inside a card and the
 * underlying query stays a small indexed range. */
const HEATMAP_DAYS = 84

const HEATMAP_COLUMNS = HEATMAP_DAYS / 7

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The heatmap window, ending today.
 *
 * Computed from the clock, so it moves with the reader rather than with the last
 * deploy. Anchored to UTC because every date in the schema is a UTC calendar day
 * (convex/schema.ts) — mixing a local "today" with UTC rows would drop or double
 * the edge day depending on the reader's timezone.
 */
function heatmapWindow(): { from: string; to: string } {
  const today = new Date()
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - (HEATMAP_DAYS - 1))
  return { from: isoDay(from), to: isoDay(to) }
}

/**
 * A day's activity count as one of five intensities.
 *
 * Thresholds rather than a linear scale over the maximum: a single MP with an
 * exceptional day would otherwise flatten everyone else's cells to the lowest
 * step, and the point of the strip is comparing an MP with themselves over time.
 * The steps map onto `--chart-1…5`, a single-hue ramp in app/globals.css, so
 * intensity reads as "more" rather than as a different kind of thing.
 */
function intensityClass(count: number): string {
  if (count <= 0) return "bg-muted"
  if (count === 1) return "bg-chart-2"
  if (count <= 3) return "bg-chart-3"
  if (count <= 6) return "bg-chart-4"
  return "bg-chart-5"
}

function ActivityHeatmap({ mpInternalId }: { mpInternalId: string }) {
  const { from, to } = heatmapWindow()
  const days = useQuery(api.activityEvents.getActivityCalendar, { mpInternalId, from, to })

  // The query returns only days that *have* events, so the strip is built from
  // the window and filled from the response — otherwise a quiet fortnight would
  // shorten the strip instead of showing as empty cells.
  const counts = new Map((days ?? []).map((day) => [day.date, day.count]))
  const start = new Date(`${from}T00:00:00Z`)

  const cells = Array.from({ length: HEATMAP_DAYS }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    const iso = isoDay(date)
    return { iso, count: counts.get(iso) ?? 0 }
  })

  return (
    <div
      className="grid grid-flow-col gap-0.5"
      style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridTemplateColumns: `repeat(${HEATMAP_COLUMNS}, minmax(0, 1fr))` }}
      // One label for the strip rather than 84 individually announced cells:
      // the detail belongs on the profile page's full graph, not in a card.
      aria-hidden={days === undefined ? true : undefined}
    >
      {cells.map((cell) => (
        <span
          key={cell.iso}
          title={`${cell.iso}: ${cell.count}`}
          className={cn(
            "size-1.5 rounded-[2px] transition-colors",
            // Undefined means the query has not resolved. Rendering every cell
            // at zero would claim a quiet quarter before knowing.
            days === undefined ? "bg-muted/50" : intensityClass(cell.count),
          )}
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
        />
      ))}
    </div>
  )
}
<<<<<<< HEAD
=======

export function MPCard({
  mpInternalId,
  name,
  fraktion,
  photoUrl,
  totalScore,
  rank,
  showHeatmap = false,
  className,
}: {
  mpInternalId: string
  name: string
  fraktion: string | null | undefined
  photoUrl: string | null | undefined
  totalScore?: number
  /** Position in a ranked list, if this card is in one. */
  rank?: number
  /** Fetches this MP's recent activity. One query per card — fine for a handful,
   * not for a roster. */
  showHeatmap?: boolean
  className?: string
}) {
  const { t, locale } = useLocale()

  return (
    <Card
      size="sm"
      className={cn(
        "group relative gap-0 p-3 transition-colors hover:border-border hover:bg-accent/40",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {rank === undefined ? null : (
          <span className="w-5 shrink-0 text-center font-medium text-muted-foreground text-sm tabular-nums">
            {rank}
          </span>
        )}

        <Avatar size="lg" className="shrink-0">
          {/* Most MPs have no portrait: §6.5 found no official bulk source and
              Commons covers 36.5 % of WP21, so the fallback is the norm. */}
          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
        </Avatar>

        <div className="grid min-w-0 flex-1 gap-1">
          {/* The whole card is the hit target — the link is stretched over it
              rather than wrapping it, so the card keeps its grid and the
              heatmap's own titles stay reachable. */}
          <Link
            href={`/abgeordnete/${encodeURIComponent(mpInternalId)}`}
            className="truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {name}
          </Link>
          <PartyBadge fraktion={fraktion} className="w-fit" />
        </div>

        {totalScore === undefined ? null : (
          <div className="shrink-0 text-right">
            <div className="font-semibold text-base tabular-nums">
              {formatScore(totalScore, locale)}
            </div>
            <div className="text-[0.7rem] text-muted-foreground">{t("mp.activityScore")}</div>
          </div>
        )}
      </div>

      {showHeatmap ? (
        <div className="mt-3 flex justify-center">
          <ActivityHeatmap mpInternalId={mpInternalId} />
        </div>
      ) : null}
    </Card>
  )
}
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
