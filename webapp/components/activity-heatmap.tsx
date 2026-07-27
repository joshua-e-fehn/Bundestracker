"use client"

import { useQuery } from "convex/react"
import { useMemo } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { formatDateShort, formatMonth, formatNumber } from "@/lib/bundestag"
import type { HeatmapDay, HeatmapWeek } from "@/lib/heatmap"
import {
  buildHeatmapWeeks,
  HEATMAP_LEVELS,
  heatmapLevel,
  monthLabels,
  twelveMonthWindow,
} from "@/lib/heatmap"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The contribution graph — the product's premise, rendered.
 *
 * Reads `getActivityCalendar`, which is the daily-grain query: `activityScores`
 * has no finer grain than a month, so the cells could not come from there. The
 * window is a fixed twelve months rather than the whole Wahlperiode, because
 * that query is bounded by an explicit date range on purpose (see its note in
 * convex/activityEvents.ts) and a four-year grid is 1 460 cells nobody reads.
 *
 * The colour ramp is relative to the busiest day in *this* MP's window, not
 * absolute across the chamber — `heatmapLevel` explains why, and the tooltip
 * carries the real count, which is the number that compares.
 */

/**
 * The ramp, indexed by level.
 *
 * The five `--chart-*` steps, which app/globals.css defines as a single-hue
 * gold ramp *for this graph* — "for the contribution heatmap and the seating
 * map's continuous modes, dim to bright at one hue, so cell intensity reads as
 * *more* rather than as a different category". Using them here is what makes
 * that comment true; the ramp was defined by the brand commit and this grid was
 * still painting itself in `--primary`, which is near-black in light mode. A
 * contribution graph in the text colour is not a heatmap, it is a page of
 * redactions, and it also collided with the trend graph directly below it on
 * the same profile, which was already gold.
 *
 * The ramp reverses between themes (light runs dim-to-*dark*, dark runs
 * dim-to-*bright*), and that is handled entirely in the custom properties — so
 * there is no `dark:` variant here and no `useTheme`. The browser resolves
 * `var(--chart-3)` against whichever theme is on.
 *
 * Index 0 is "nothing happened", and it is a visible empty cell rather than
 * transparent: the grid's shape is information — a gap in the middle of a
 * sitting period reads differently from the edge of the window — and a
 * transparent cell would make the shape depend on the page background. It is
 * `--chart-1`, the ramp's own dimmest step, rather than `bg-muted`: the two are
 * close in both themes, but taking it from the ramp keeps the legend below a
 * continuous gradient rather than a neutral square followed by four golds.
 */
const LEVEL_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const

export function ActivityHeatmap({
  mpInternalId,
  locale,
  /** The window's last day, ISO. Injected rather than read from the clock here
   * so the server and the client agree on it — `new Date()` during SSR and
   * again during hydration can straddle midnight, and React would report a
   * mismatch on the whole grid. */
  today,
  className,
}: {
  mpInternalId: string
  locale: Locale
  today: string
  className?: string
}) {
  const { from, to } = useMemo(() => twelveMonthWindow(new Date(`${today}T00:00:00Z`)), [today])
  const counts = useQuery(api.activityEvents.getActivityCalendar, { mpInternalId, from, to })

  const weeks = useMemo(() => buildHeatmapWeeks(counts ?? [], from, to), [counts, from, to])
  const labels = useMemo(() => monthLabels(weeks), [weeks])
  const max = useMemo(() => Math.max(0, ...(counts ?? []).map((day) => day.count)), [counts])
  const total = useMemo(() => (counts ?? []).reduce((sum, day) => sum + day.count, 0), [counts])

  // `undefined` is Convex's "still loading"; an empty array is a real answer.
  // The skeleton keeps the same height as the grid so the page does not jump.
  if (counts === undefined) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="h-[104px] w-full animate-pulse rounded-md bg-muted" />
      </div>
    )
  }

  if (weeks.length === 0) {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>{t("heatmap.empty", locale)}</p>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Horizontal scroll rather than a squeezed grid: 53 columns at a legible
          cell size is wider than a phone, and shrinking the cells to fit turns
          the ramp into a smear. */}
      <div className="overflow-x-auto pb-1">
        <div className="w-fit">
          <MonthAxis labels={labels} weekCount={weeks.length} locale={locale} />
          <div className="flex gap-[3px]">
            {weeks.map((week) => (
              <WeekColumn key={week.days[0].date} week={week} max={max} locale={locale} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-muted-foreground text-xs">
          {t("heatmap.total", locale, { count: formatNumber(total, locale) })}
        </p>
        <Legend locale={locale} />
      </div>
    </div>
  )
}

/** Month names above the columns they start in. Absolutely positioned over a
 * relative strip, because a label is wider than the 13px column it belongs to
 * and laying them out in flow would push the columns apart. */
function MonthAxis({
  labels,
  weekCount,
  locale,
}: {
  labels: Array<{ weekIndex: number; month: string }>
  weekCount: number
  locale: Locale
}) {
  const columnWidth = 13 // 10px cell + 3px gap, matching the grid below.
  return (
    <div className="relative mb-1 h-4" style={{ width: weekCount * columnWidth }}>
      {labels.map((label) => (
        <span
          key={label.month}
          className="absolute top-0 text-[10px] text-muted-foreground leading-4"
          style={{ left: label.weekIndex * columnWidth }}
        >
          {formatMonth(label.month, locale)}
        </span>
      ))}
    </div>
  )
}

function WeekColumn({ week, max, locale }: { week: HeatmapWeek; max: number; locale: Locale }) {
  return (
    <div className="flex flex-col gap-[3px]">
      {week.days.map((day) => (
        <DayCell key={day.date} day={day} max={max} locale={locale} />
      ))}
    </div>
  )
}

function DayCell({ day, max, locale }: { day: HeatmapDay; max: number; locale: Locale }) {
  const level = heatmapLevel(day.count, max)
  // The tooltip text is also the accessible name. A grid of 365 unlabelled
  // divs is unreadable to a screen reader, and the count is the whole content.
  const label =
    day.count === 0
      ? t("heatmap.tooltipNone", locale, { date: formatDateShort(day.date, locale) })
      : t("heatmap.tooltip", locale, {
          count: formatNumber(day.count, locale),
          date: formatDateShort(day.date, locale),
        })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          // Not a <button>: 365 focus stops between the heatmap and the next
          // link would make the page unusable by keyboard. `role="img"` with a
          // label states the cell's content without adding it to the tab order.
          role="img"
          aria-label={label}
          className={cn("size-[10px] rounded-[2px]", LEVEL_CLASSES[level])}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Legend({ locale }: { locale: Locale }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span>{t("heatmap.legendLess", locale)}</span>
      {Array.from({ length: HEATMAP_LEVELS + 1 }, (_, level) => (
        <span
          key={LEVEL_CLASSES[level]}
          aria-hidden="true"
          className={cn("size-[10px] rounded-[2px]", LEVEL_CLASSES[level])}
        />
      ))}
      <span>{t("heatmap.legendMore", locale)}</span>
    </div>
  )
}
