"use client"

import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatBy, formatCount } from "@/lib/format"
import type { Locale } from "@/lib/i18n"
import { partyByKey, type PartyKey, partyKeyColor } from "@/lib/parties"
import {
  DEFAULT_PARTY_METRIC_ID,
  PARTY_METRICS,
  type PartyAggregate,
  type PartyMetric,
  partyMetricById,
  rankPartiesBy,
} from "@/lib/party-comparison"
import { useOverflowEdges } from "@/lib/use-overflow-edges"

/**
 * One metric at a time, with the Fraktionen ranked along it.
 *
 * The radar above answers "what shape is this group"; this answers "who leads on
 * this one number", which a normalised hexagon deliberately cannot — see
 * `buildRadarSeries`. So this chart is drawn in the metric's own units, and the
 * axis carries real figures.
 *
 * ## Horizontal bars, unlike every other chart on the site
 *
 * A `layout="vertical"` `BarChart` puts the category on the y-axis. That is the
 * right way round for six party names of very different lengths — `CDU/CSU` and
 * `Fraktionslos` — which as x-axis ticks either rotate to 45° or collide. The
 * trend graphs are vertical because their category is a month and there are up
 * to 48 of them; six named groups is the opposite case.
 *
 * ## Nine tabs in a scroll strip, like the rankings' nine boards
 *
 * Same `scroll-strip` utility, and for the same reason its note in
 * app/globals.css gives: nine labels wrapped to two rows push the chart below
 * the fold, and a native scrollbar under a tab row reads as a broken layout.
 * `min-w-0` on the `Tabs` is what makes the strip able to shrink at all —
 * components/rankings.tsx documents that at length.
 */

/** Roughly 44 px per bar plus room for the axis. Fixed rather than an aspect
 * ratio, for the reason components/trend-graphs.tsx gives — a percentage height
 * inside a content-sized flex column resolves to zero and the chart silently
 * renders nothing. Scaled by bar count so six groups do not sit in a chart sized
 * for two. */
function chartHeight(bars: number): number {
  return Math.max(180, bars * 44 + 40)
}

export function PartyMetricChart({ parties }: { parties: readonly PartyAggregate[] }) {
  const { t, locale } = useLocale()
  const [metricId, setMetricId] = useState(DEFAULT_PARTY_METRIC_ID)
  const tabStrip = useOverflowEdges<HTMLDivElement>()

  const metric = partyMetricById(metricId) ?? PARTY_METRICS[0]

  /**
   * Ranked rows, in the shape recharts reads.
   *
   * Reversed, because a vertical `BarChart` draws its first datum at the
   * *bottom* of the y-axis. Without this the leading group would sit at the
   * foot of the chart, which reads as the ranking running the wrong way.
   */
  const rows = useMemo(() => {
    const ranked = rankPartiesBy(parties, metric.field)
    return ranked
      .map((row) => ({
        partyKey: row.partyKey,
        label: partyByKey(row.partyKey).label,
        value: row.means[metric.field],
        scored: row.scored,
        mandates: row.mandates,
      }))
      .reverse()
  }, [parties, metric.field])

  const tabs = useMemo(
    () => PARTY_METRICS.map((entry) => ({ id: entry.id, label: t(entry.shortLabelKey) })),
    [t],
  )

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={metric.id} onValueChange={setMetricId} className="min-w-0">
        <TabsList
          ref={tabStrip.ref}
          data-overflow={tabStrip.dataOverflow}
          className="scroll-strip w-full max-w-full justify-start"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="scroll-strip-item shrink-0 whitespace-nowrap"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-muted-foreground text-sm">{t(metric.descriptionKey)}</p>

      {rows.length === 0 ? (
        // No group has a scored member. Stated rather than drawn as an empty
        // axis, which is the call every chart on this site makes: a bar chart
        // with no bars reads as a measured result of zero.
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("parties.empty")}
        </p>
      ) : (
        <figure
          aria-labelledby={`party-metric-${metric.id}-caption`}
          style={{ height: chartHeight(rows.length) }}
          className="m-0 w-full"
        >
          <figcaption id={`party-metric-${metric.id}-caption`} className="sr-only">
            {`${t(metric.labelKey)} — ${t(metric.descriptionKey)}`}
          </figcaption>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            >
              {/* Vertical rules only — the mirror image of the trend graphs'
                  choice, because the measured axis is the horizontal one here. */}
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(value: number) => formatBy(metric.format, value, locale)}
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                // Room for `Fraktionslos`, the longest label — the default 60px
                // clips it to "Fraktionsl…".
                width={92}
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={<MetricTooltip metric={metric} locale={locale} />}
                // The default cursor is a translucent white block that reads as
                // a hole punched in the dark theme.
                cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {/* One `Cell` per bar so each group keeps its own colour, which
                    is what ties this chart to the radar, the badges and the
                    seating arc. A single `fill` on the `Bar` would paint all six
                    the same and make the chart's rows anonymous. */}
                {rows.map((row) => (
                  <Cell key={row.partyKey} fill={partyKeyColor(row.partyKey)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </figure>
      )}

      {metric.caveatKey !== undefined && <CaveatNote>{t(metric.caveatKey)}</CaveatNote>}
    </div>
  )
}

/**
 * The hover card.
 *
 * Carries the scored-member count beside the figure, which is the qualification
 * this chart most needs: §9 puts fraktionslos at 3 seats, so its bar is a mean
 * over three people and a reader comparing it to CDU/CSU's 209 should be able to
 * see that without leaving the chart.
 */
function MetricTooltip({
  metric,
  locale,
  active,
  payload,
}: {
  metric: PartyMetric
  locale: Locale
  active?: boolean
  payload?: ReadonlyArray<{
    payload?: { partyKey?: PartyKey; label?: string; value?: number; scored?: number }
  }>
}) {
  const { t } = useLocale()
  if (!active || !payload || payload.length === 0) return null

  const row = payload[0]?.payload
  // `partyKey` joins the guard because the swatch below colours by it: the
  // payload type is optional throughout (recharts injects it), and a row without
  // one has nothing to be a tooltip *for*.
  if (!row || row.partyKey === undefined || row.label === undefined || row.value === undefined) {
    return null
  }

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="flex items-center gap-1.5 font-medium text-xs">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: partyKeyColor(row.partyKey) }}
        />
        {row.label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-3 text-xs">
        <span className="text-muted-foreground">{t(metric.labelKey)}</span>
        <span className="ml-auto font-medium tabular-nums">
          {formatBy(metric.format, row.value, locale)}
        </span>
      </p>
      {row.scored !== undefined && (
        <p className="mt-0.5 flex items-baseline gap-3 text-[0.7rem] text-muted-foreground">
          <span>{t("parties.column.scored")}</span>
          <span className="ml-auto tabular-nums">{formatCount(row.scored, locale)}</span>
        </p>
      )}
    </div>
  )
}
