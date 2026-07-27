"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
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

/**
 * The mini heatmap's shape.
 *
 * Wide and short, like GitHub's contribution graph read at a glance: rows of
 * consecutive days rather than the calendar-accurate 7×12. A card strip is not
 * a calendar — it has no weekday axis, no month labels and no tooltips (the
 * profile page's `ActivityHeatmap` is the one that is all three), so the 7-row
 * grid was paying a calendar's aspect ratio for none of a calendar's meaning.
 * At 7 rows the strip came out 94 px wide and 54 px tall, a near-square block
 * that read as a texture; at 3 it is a band, which is the shape the eye already
 * knows how to scan left-to-right as time.
 *
 * ## Why it shrank again
 *
 * 4 rows of 21 at `size-2` with 3 px gaps measured 94 × 41 px. That fitted a
 * full-width card and stopped fitting when the home page put two boards in one
 * row (app/page.tsx): the strip, the name, the group badge and a fixed-width
 * score column together overflowed a half-width card, and the strip is the
 * piece that loses — it is the only one whose job survives being smaller.
 *
 * 3 rows of 28 at `size-1.5` with 2 px gaps is 55 × 14 px: 40 % narrower and a
 * third the height, still legible as a band. `HEATMAP_DAYS` stays 84 — twelve
 * weeks is still the window, and 84 divides evenly by 3 as it did by 4 — so
 * the same indexed range is read and only the wrapping changes. Nothing about
 * the query moves.
 */
const HEATMAP_DAYS = 84

const HEATMAP_ROWS = 3

const HEATMAP_COLUMNS = HEATMAP_DAYS / HEATMAP_ROWS

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
      // `grid-flow-row`, not `-col`: with three rows the columns are no longer
      // weeks, so filling downward would scatter consecutive days across the
      // strip. Filling across makes each row a run of 28 consecutive days and
      // time read left to right, which is the only ordering a stripped-down
      // band can claim.
      className="grid grid-flow-row gap-[2px]"
      style={{
        gridTemplateRows: `repeat(${HEATMAP_ROWS}, minmax(0, 1fr))`,
        gridTemplateColumns: `repeat(${HEATMAP_COLUMNS}, minmax(0, 1fr))`,
      }}
      // One label for the strip rather than 84 individually announced cells:
      // the detail belongs on the profile page's full graph, not in a card.
      aria-hidden={days === undefined ? true : undefined}
    >
      {cells.map((cell) => (
        <span
          key={cell.iso}
          title={`${cell.iso}: ${cell.count}`}
          className={cn(
            "size-1.5 rounded-[1px] transition-colors",
            // Undefined means the query has not resolved. Rendering every cell
            // at zero would claim a quiet quarter before knowing.
            days === undefined ? "bg-muted/50" : intensityClass(cell.count),
          )}
        />
      ))}
    </div>
  )
}

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
      {/* One row, four aligned slots: rank, identity, activity, score.
          The heatmap used to sit on a second line, centred — which left the
          name hard left, the score hard right and the strip floating between
          them under both, so nothing lined up with anything. Inline and
          right-aligned next to the score, the three read as columns down a
          list of cards. Below `sm` it is hidden rather than wrapped: a 21-cell
          row does not survive a phone's width, and the name and score are what
          a narrow card is for. */}
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
            href={`/mps/${encodeURIComponent(mpInternalId)}`}
            className="truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {name}
          </Link>
          <PartyBadge fraktion={fraktion} className="w-fit" />
        </div>

        {showHeatmap ? (
          // `@container`-free and deliberately so: the breakpoint that matters
          // is the *card's* width, not the viewport's, and these cards now
          // appear at two widths on one page — full-width in a list, half-width
          // in the home page's two-column board row (app/page.tsx). `md` is
          // where the half-width column clears the strip's 55 px plus a name
          // worth reading; below it the name and the score are what a narrow
          // card is for.
          <div className="hidden shrink-0 md:block">
            <ActivityHeatmap mpInternalId={mpInternalId} />
          </div>
        ) : null}

        {totalScore === undefined ? null : (
          // A fixed width, so the scores form a column down the list instead of
          // each card's number sitting wherever its own digit count puts it.
          // `w-14` rather than `w-20`: `formatScore` gives at most five
          // characters ("441,5"), so that is all the column needs once the
          // label below it is gone — see the next comment.
          //
          // The label *was* here and is now the `title`. In a half-width card
          // "Aktivitätswert" is wider than the number it labels, so the column
          // either grew to fit a word or clipped it — it clipped, and every
          // card on the home page read "Aktivitätswer". Naming the metric is
          // the *section heading's* job ("Nach Aktivitätswert in der laufenden
          // Wahlperiode"), so repeating it under all ten numbers was buying a
          // layout problem with a word nobody needed twice. The `title` keeps
          // it reachable on hover; `aria-label` keeps it announced.
          <div
            className="w-14 shrink-0 text-right"
            title={t("mp.activityScore")}
            aria-label={t("mp.activityScore")}
          >
            <div className="font-semibold text-base tabular-nums">
              {formatScore(totalScore, locale)}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
