"use client"

import { useMemo, useState } from "react"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { useLocale } from "@/components/providers/locale-provider"
import { formatBy, formatPercent } from "@/lib/format"
import type { Locale } from "@/lib/i18n"
import { partyByKey, type PartyKey, partyKeyColor } from "@/lib/parties"
import {
  buildRadarSeries,
  type PartyAggregate,
  RADAR_MAX,
  RADAR_METRICS,
  type RadarPoint,
} from "@/lib/party-comparison"
import { cn } from "@/lib/utils"

/**
 * Every Fraktion on six axes at once.
 *
 * ## Why recharts here, like the trend graphs and unlike the seating map
 *
 * The same call components/trend-graphs.tsx documents. The hemicycle is 630
 * circles with one `fill` each and no axes, so a chart library would bring a
 * scale model it has no use for; this has a polar grid, a categorical angular
 * axis, six overlaid series and hover tooltips, which is exactly the model
 * recharts already is.
 *
 * ## The normalisation is the chart's meaning, not a detail of it
 *
 * Each axis is scaled to the leading group on it — see `buildRadarSeries` in
 * lib/party-comparison.ts for why six metrics in six units cannot share a
 * radius. Two consequences show up here rather than there:
 *
 *  - The radius axis is drawn with **no tick labels**. A "50" on it would name
 *    a quantity that exists for no metric; the number a reader wants is the
 *    measured mean, and that is in the tooltip.
 *  - The caveat renders beside the chart unconditionally, like every other
 *    structural limit on this site.
 *
 * ## Colours are the parties' own
 *
 * Through `partyColor`, so a group is the same colour here, on its badge, in
 * the seating arc and in the bar charts below. That is the one thing keeping
 * six overlapping translucent polygons legible — and it is why the legend
 * doubles as a filter: six at once is a thicket, and isolating two is how the
 * chart is actually read.
 */

/** Chart height. Fixed rather than an aspect ratio, for the reason
 * components/trend-graphs.tsx gives: `ResponsiveContainer` needs a definite
 * height from its parent, and a percentage of a content-sized flex column
 * resolves to zero — the chart renders nothing and nothing errors. */
const CHART_HEIGHT = 380

export function PartyComparisonRadar({ parties }: { parties: readonly PartyAggregate[] }) {
  const { t, locale } = useLocale()

  /**
   * Which groups are drawn. Empty means all of them — the state a reader
   * arrives in, and distinct from "none selected", which the toggle below never
   * produces: clicking the last visible group turns everything back on rather
   * than emptying the chart.
   */
  const [hidden, setHidden] = useState<ReadonlySet<PartyKey>>(new Set())

  // Only groups with a scored member: a mean over nobody is undefined, and a
  // polygon collapsed onto the origin asserts it is zero.
  const drawable = useMemo(() => parties.filter((row) => row.scored > 0), [parties])

  const points = useMemo(
    () => buildRadarSeries(drawable, RADAR_METRICS, (metric) => t(metric.shortLabelKey)),
    [drawable, t],
  )

  const visible = drawable.filter((row) => !hidden.has(row.partyKey))

  function toggle(key: PartyKey) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // Never leave an empty chart. Hiding the last visible group is far more
      // likely to be a reader working their way down the legend than a request
      // for a blank hexagon, so it resets instead.
      return next.size >= drawable.length ? new Set() : next
    })
  }

  if (drawable.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {/* The legend is the filter. Buttons rather than recharts' own `Legend`,
          which is not focusable and cannot carry `aria-pressed` — and this
          control does something, so it has to be reachable by keyboard. */}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">{t("parties.radarLegend")}</legend>
        {drawable.map((row) => {
          const party = partyByKey(row.partyKey)
          const color = partyKeyColor(party.key)
          const isHidden = hidden.has(row.partyKey)
          return (
            <button
              key={row.partyKey}
              type="button"
              onClick={() => toggle(row.partyKey)}
              aria-pressed={!isHidden}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isHidden
                  ? "border-border text-muted-foreground/70"
                  : "border-transparent text-foreground",
              )}
              style={
                isHidden
                  ? undefined
                  : { backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }
              }
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: isHidden ? "var(--muted-foreground)" : color }}
              />
              {party.label}
            </button>
          )
        })}
      </fieldset>

      {/**
       * A labelled `<figure>`, deliberately not `role="img"` — the same
       * reasoning components/trend-graphs.tsx sets out. `role="img"` makes an
       * element a leaf, and recharts' `accessibilityLayer` makes this chart
       * keyboard-traversable point by point; marking the wrapper as an image
       * would hide exactly that.
       */}
      <figure
        aria-labelledby="party-radar-caption"
        style={{ height: CHART_HEIGHT }}
        // `m-0` because a bare `<figure>` carries a 40px user-agent margin in
        // every major browser, which would inset the chart from its card.
        className="m-0 w-full"
      >
        <figcaption id="party-radar-caption" className="sr-only">
          {`${t("parties.radar.title")} — ${t("parties.radar.subtitle")}`}
        </figcaption>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={points} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis
              dataKey="label"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            {/* No tick labels: the radius is a share of the leading group on
                each axis, so a number on it would name a quantity that exists
                for no metric. The domain is fixed rather than inferred so a
                chart with one group visible keeps the same geometry as one with
                six — otherwise isolating a group would silently rescale it to
                fill the hexagon. */}
            <PolarRadiusAxis domain={[0, RADAR_MAX]} tick={false} axisLine={false} />
            {visible.map((row) => {
              const color = partyKeyColor(row.partyKey)
              return (
                <Radar
                  key={row.partyKey}
                  name={partyByKey(row.partyKey).label}
                  dataKey={`values.${row.partyKey}`}
                  stroke={color}
                  fill={color}
                  // Low enough that six overlapping polygons stay separable,
                  // high enough that one alone still reads as a filled shape.
                  fillOpacity={0.12}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              )
            })}
            <Tooltip content={<RadarTooltip points={points} locale={locale} />} />
          </RadarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  )
}

/**
 * The hover card: the measured mean, and what share of the leader it is.
 *
 * Custom rather than recharts' default for the reason trend-graphs.tsx gives —
 * the default formats numbers with `toLocaleString` in the *browser's* locale,
 * so a German reader on an en-US browser would read `1,234` where the rest of
 * the page says `1.234` — and for one specific to this chart: the default would
 * report the *normalised* value, which is the one number on screen that means
 * nothing on its own. The raw mean is what a reader is asking for, so it leads,
 * and the share is the qualification beneath it.
 */
function RadarTooltip({
  points,
  locale,
  active,
  label,
}: {
  points: readonly RadarPoint[]
  locale: Locale
  // Injected by recharts when it clones the element; absent on the props this
  // file writes, hence optional.
  active?: boolean
  label?: string | number
}) {
  const { t } = useLocale()
  if (!active) return null

  const point = points.find((entry) => entry.label === label)
  if (!point) return null

  const metric = RADAR_METRICS.find((entry) => entry.id === point.metric)
  if (!metric) return null

  // Ordered by the measured value rather than by the series order, so the
  // group the pointer is nearest to is easiest to find.
  const rows = Object.entries(point.raw).sort((a, b) => b[1] - a[1])

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="font-medium text-xs">{t(metric.labelKey)}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {rows.map(([key, value]) => (
          <li key={key} className="flex items-baseline gap-3 text-xs">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: partyKeyColor(key as PartyKey) }}
            />
            <span className="text-muted-foreground">{partyByKey(key as PartyKey).label}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatBy(metric.format, value, locale)}
            </span>
          </li>
        ))}
      </ul>
      {/* What the axis's full radius represents, so the polygon's shape can be
          read back to a quantity. Omitted when nothing was measured on this
          axis — "0 % of 0" is not a fact worth printing. */}
      {point.max > 0 && (
        <p className="mt-1.5 border-border border-t pt-1.5 text-[0.7rem] text-muted-foreground">
          {t("parties.radarTooltipShare", {
            share: formatPercent(1, locale),
          })}
          {` = ${formatBy(metric.format, point.max, locale)}`}
        </p>
      )}
    </div>
  )
}
