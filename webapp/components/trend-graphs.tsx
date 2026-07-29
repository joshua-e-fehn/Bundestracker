"use client"

import { useQuery } from "convex/react"
import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import { formatMonth, formatNumber, formatPercent } from "@/lib/bundestag"
import type { Locale } from "@/lib/i18n"
import type { TrendChart, TrendPoint, TrendSeries } from "@/lib/trends"
import {
  buildTrendSeries,
  DEFAULT_TREND_CHART_ID,
  hasTrendData,
  TREND_CHARTS,
  trendChartById,
} from "@/lib/trends"

/**
 * One MP's activity over time — the tabs and shapes lib/trends.ts declares.
 *
 * The contribution heatmap beside this answers "which *days* were busy"; these
 * answer "is this rising or falling", which a 365-cell grid cannot show. Monthly
 * rather than daily because `activityScores` has no finer grain than a month
 * (its header says so), and because a trend over daily counts in a chamber that
 * sits in sitting weeks is mostly a picture of the parliamentary calendar.
 *
 * ## What lives here and what does not
 *
 * The month arithmetic and the chart definitions live in lib/trends.ts —
 * `TREND_CHARTS` there is the single list this file iterates for both the
 * tab strip and the drawn figure, so the count is one place and grows there
 * (GAP-019 added the sixth). Gap-filling and cumulative sums can be wrong
 * without looking wrong, and the tests beside those definitions catch that
 * where an eye does not. This file draws what that module computes and holds
 * the one piece of state — which tab is open.
 *
 * ## Why recharts here when the seating map is hand-rolled SVG
 *
 * components/seating-map.tsx makes the opposite call, and both are right for
 * their case. That is 630 circles with one `fill` each and no axes at all — a
 * chart library would bring a scale model it has no use for. These have two
 * axes, a categorical x, stacked series, hover tooltips and a legend, which is
 * exactly the model recharts already is.
 *
 * ## Colours are CSS variables, not literals
 *
 * Every series names a custom property from app/globals.css (`--chart-*` for
 * magnitude, `--vote-*` for ballot positions), the same way lib/parties.ts and
 * lib/seating.ts reach the palette. So dark mode needs no second table here and
 * no `useTheme` — the browser resolves `var(--chart-4)` against whichever theme
 * is on, including a switch made while the chart is open.
 */

export function TrendGraphs({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const [chartId, setChartId] = useState(DEFAULT_TREND_CHART_ID)

  const rows = useQuery(api.activityScores.getMonthlyScoresByMP, { mpInternalId, wahlperiode })
  const points = useMemo(() => buildTrendSeries(rows ?? []), [rows])

  const chart = trendChartById(chartId) ?? TREND_CHARTS[0]

  /**
   * Months the nightly sweep has not scored.
   *
   * `startNightlySweep` recomputes only the current calendar month
   * (convex/scoreSweep.ts), so a deployment whose backfill never called the
   * recompute endpoint per month has ballots going back years and scores going
   * back one. `getMonthlyScoresByMP` returns those months anyway — dropping them
   * would hide the voting record — and marks them, so the zero in the score line
   * can be named as "not computed" rather than read as "did nothing".
   */
  const unscored = useMemo(() => (rows ?? []).filter((row) => !row.scored).length, [rows])

  // `undefined` is Convex's "still loading"; an empty array is a real answer.
  // The skeleton keeps the chart's height so the page does not jump when the
  // rows land.
  if (rows === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("trends.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-8 w-full max-w-md rounded-md" />
          <Skeleton className="h-[280px] w-full rounded-md" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("trends.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {points.length === 0 ? (
          // No months at all — the pipeline has loaded nothing for this MP.
          // Stated rather than drawn as an empty axis, which is the call
          // mp-profile.tsx made when this panel said "planned": an axis with a
          // flat line along zero reads as a measured result.
          <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
            {t("trends.empty")}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t("trends.subtitle")}</p>

            <Tabs value={chart.id} onValueChange={setChartId}>
              {/* Scrolls rather than wraps, matching components/rankings.tsx:
                  the six tabs (`TREND_CHARTS` in lib/trends.ts, count kept
                  there) wrapped onto two rows on a narrow screen push the
                  chart below the fold. */}
              <TabsList className="w-full justify-start overflow-x-auto">
                {TREND_CHARTS.map((entry) => (
                  <TabsTrigger key={entry.id} value={entry.id} className="whitespace-nowrap">
                    {t(entry.labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <p className="text-muted-foreground text-sm">{t(chart.descriptionKey)}</p>

            {hasTrendData(points, chart) ? (
              <TrendChartFigure chart={chart} points={points} locale={locale} />
            ) : (
              // Every point in this chart's series is zero. Distinct from the
              // whole-panel empty above: the MP has months, this chart has
              // nothing to draw in them, and a flat line along the axis would
              // assert a measurement rather than report an absence.
              <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
                {t("trends.emptyChart")}
              </p>
            )}

            {chart.caveatKey !== undefined && <CaveatNote>{t(chart.caveatKey)}</CaveatNote>}

            {/* Only where the gap could be misread — a chart drawn entirely
                from ballots is complete whether or not the sweep has scored the
                month. */}
            {unscored > 0 && chart.id !== "votes" && (
              <CaveatNote>{t("trends.unscoredNotice", { count: unscored })}</CaveatNote>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// --- the charts -----------------------------------------------------------

/** Chart height, in pixels. Fixed rather than an aspect ratio: `ResponsiveContainer`
 * needs a definite height from its parent, and a percentage of a flex column that
 * is itself sized by its content resolves to zero — the chart renders nothing and
 * nothing errors. */
const CHART_HEIGHT = 280

/** Room for the y-axis labels. Word counts reach five digits for a busy month,
 * and the default 60px clips them to "12 34…". */
const Y_AXIS_WIDTH = 56

function TrendChartFigure({
  chart,
  points,
  locale,
}: {
  chart: TrendChart
  points: TrendPoint[]
  locale: Locale
}) {
  const { t } = useLocale()

  /**
   * The x-axis label for a month.
   *
   * `formatMonth` from lib/bundestag.ts gives the short form ("Jun") the heatmap's
   * month axis already uses, so the two graphs on one profile name a month the
   * same way. The year is appended at each January, because a four-year period's
   * axis otherwise reads "Jan … Dez … Jan" with nothing to say which is which.
   */
  const tickFormatter = (month: string) =>
    month.endsWith("-01")
      ? `${formatMonth(month, locale)} ${month.slice(0, 4)}`
      : formatMonth(month, locale)

  const axisProps = {
    stroke: "var(--muted-foreground)",
    fontSize: 11,
    tickLine: false,
    axisLine: false,
  } as const

  /** Shared by all four chart shapes. Extracted so the axes, grid and tooltip
   * cannot drift between them — five copies is how one chart ends up without a
   * grid and nobody notices. */
  const frame = (
    <>
      {/* Horizontal rules only. Vertical ones on a categorical axis of up to 48
          months are a hatch pattern rather than a reading aid. */}
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey="month"
        tickFormatter={tickFormatter}
        // Recharts drops ticks that would collide, so a four-year axis thins
        // itself rather than overprinting; `minTickGap` sets how hard.
        minTickGap={24}
        {...axisProps}
      />
      <YAxis
        width={Y_AXIS_WIDTH}
        tickFormatter={(value: number) =>
          chart.percentAxis ? formatPercent(value, locale) : formatNumber(value, locale)
        }
        {...axisProps}
      />
      <Tooltip
        content={<TrendTooltip chart={chart} locale={locale} />}
        // The default cursor is a white-ish translucent block that reads as a
        // hole punched in the dark theme.
        cursor={{ fill: "var(--muted)", fillOpacity: 0.4, stroke: "var(--border)" }}
      />
      {/* Only where there is something to tell apart. A one-series chart's
          legend is a restatement of the tab that is already selected. */}
      {chart.series.length > 1 && (
        <Legend
          formatter={(value: string) => (
            <span className="text-muted-foreground text-xs">{value}</span>
          )}
        />
      )}
    </>
  )

  /** `Legend` and the tooltip both read `name`, so each series is named once
   * here in the reader's language rather than by its `dataKey`. */
  const seriesName = (series: TrendSeries) => t(series.labelKey)

  return (
    /**
     * A labelled `<figure>`, deliberately *not* `role="img"`.
     *
     * `role="img"` makes an element a leaf: assistive technology stops
     * describing it and exposes only its label. That is right in
     * activity-heatmap.tsx, where each cell really is one static square, and
     * wrong here — recharts' `accessibilityLayer` (on by default) makes the
     * chart keyboard-traversable point by point, and marking the wrapper as an
     * image would hide exactly that. So the figure is *named* rather than
     * flattened: `aria-labelledby` points at the caption, which carries the same
     * sentence a sighted reader gets, and the chart underneath stays reachable.
     */
    <figure
      aria-labelledby={`${chart.id}-chart-caption`}
      style={{ height: CHART_HEIGHT }}
      // `m-0` because a bare `<figure>` carries a user-agent margin (40px each
      // side in every major browser) that would inset the chart from the card
      // and make it narrower than the text above it. The caption is `sr-only`,
      // which is absolutely positioned, so it takes no height from the chart.
      className="m-0 w-full"
    >
      {/* The chart's meaning in words, for a reader who cannot see it. Visually
          hidden rather than absent: the same text is already on screen above as
          the tab's description, so repeating it would be visual noise — but a
          screen reader arriving at the figure needs it here to know what it has
          reached. */}
      <figcaption id={`${chart.id}-chart-caption`} className="sr-only">
        {`${t(chart.labelKey)} — ${t(chart.descriptionKey)}`}
      </figcaption>
      <ResponsiveContainer width="100%" height="100%">
        {chart.kind === "line" ? (
          <LineChart data={points} margin={CHART_MARGIN}>
            {frame}
            {chart.series.map((series) => (
              <Line
                key={series.field}
                type="monotone"
                dataKey={series.field}
                name={seriesName(series)}
                stroke={`var(${series.colorVar})`}
                strokeWidth={2}
                // A dot per month is legible over a few months and a bead
                // curtain over four years; the active dot still marks what the
                // tooltip is reading.
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        ) : chart.kind === "area" ? (
          <AreaChart data={points} margin={CHART_MARGIN}>
            {frame}
            {chart.series.map((series) => (
              <Area
                key={series.field}
                type="monotone"
                dataKey={series.field}
                name={seriesName(series)}
                stroke={`var(${series.colorVar})`}
                fill={`var(${series.colorVar})`}
                fillOpacity={0.25}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={points} margin={CHART_MARGIN}>
            {frame}
            {chart.series.map((series) => (
              <Bar
                key={series.field}
                dataKey={series.field}
                name={seriesName(series)}
                fill={`var(${series.colorVar})`}
                // One `stackId` puts every series in one bar; omitting it puts
                // them side by side. That is the whole difference between the
                // vote chart and the other two bar charts — a ballot's five
                // positions are parts of one month's total, where speeches and
                // words are two different measures of it and stacking them
                // would sum a word count onto a segment count.
                stackId={chart.kind === "stackedBar" ? "stack" : undefined}
                radius={chart.kind === "stackedBar" ? undefined : [2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  )
}

/** Left margin is zero because `YAxis` carries its own width; the top leaves
 * room for the tallest bar's rounded cap. */
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }

/**
 * The hover card.
 *
 * Custom rather than recharts' default for two reasons that are not styling: the
 * default renders the raw `YYYY-MM` as its heading, and it formats numbers with
 * `toLocaleString` in the *browser's* locale — so a German reader with an
 * en-US browser would read `1,234` where every other number on the page says
 * `1.234`. Both go through lib/bundestag.ts here, like the rest of the site.
 *
 * A stacked bar's total is shown beneath its parts. That is the number a reader
 * actually wants from the vote chart — how many named ballots fell in this month
 * — and it is not any one segment.
 */
function TrendTooltip({
  chart,
  locale,
  active,
  label,
  payload,
}: {
  chart: TrendChart
  locale: Locale
  // Recharts injects these when it clones the element; they are absent on the
  // props this file writes, hence optional.
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ dataKey?: unknown; name?: unknown; value?: unknown }>
}) {
  const { t } = useLocale()
  if (!active || !payload || payload.length === 0) return null

  const format = (value: number) =>
    chart.percentAxis ? formatPercent(value, locale) : formatNumber(value, locale)

  const entries = payload.filter((entry) => typeof entry.value === "number")
  const total = entries.reduce((sum, entry) => sum + (entry.value as number), 0)

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="font-medium text-xs">
        {typeof label === "string" ? formatMonth(label, locale) : label}
        {typeof label === "string" ? ` ${label.slice(0, 4)}` : null}
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {entries.map((entry, index) => (
          <li
            // `dataKey` is the series field and unique within a chart; the index
            // is the fallback for a payload entry that arrives without one.
            key={typeof entry.dataKey === "string" ? entry.dataKey : index}
            className="flex items-baseline gap-3 text-xs"
          >
            <span className="text-muted-foreground">{String(entry.name ?? "")}</span>
            <span className="ml-auto font-medium tabular-nums">
              {format(entry.value as number)}
            </span>
          </li>
        ))}
      </ul>
      {chart.kind === "stackedBar" && entries.length > 1 && (
        <p className="mt-1.5 flex items-baseline gap-3 border-border border-t pt-1.5 text-xs">
          <span className="text-muted-foreground">{t("score.total")}</span>
          <span className="ml-auto font-medium tabular-nums">{format(total)}</span>
        </p>
      )}
    </div>
  )
}
