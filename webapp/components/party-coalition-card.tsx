"use client"

import { useMemo } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatBy, formatCount } from "@/lib/format"
import { partyByKey, partyKeyColor } from "@/lib/parties"
import {
  type CoalitionAggregate,
  coalitionSplit,
  hasCoalitionSplit,
  PARTY_METRICS,
  type PartyAggregate,
  type PartyMetric,
} from "@/lib/party-comparison"

/**
 * Government against opposition, on the same metrics.
 *
 * ## The comparison is weighted by member, not by group
 *
 * `coalitionSplit` (lib/party-comparison.ts) recovers each bloc's total from
 * `mean × scored` and divides once. A plain average of the parties' means would
 * give a three-seat group the same weight as a 209-seat one and answer a
 * question nobody asked; this answers the one the card poses — what does the
 * average government backbencher do against the average opposition one.
 *
 * ## ⚠ Two things are declared before any bar is drawn
 *
 * **Who governs is not in any Bundestag dataset.** `GOVERNING_PARTIES`
 * (lib/seating.ts) is hand-maintained, which is why this reads `coalitionRole`
 * rather than restating it: the seating map's coalition colouring and this card
 * must not disagree about who is in government. A period missing from that table
 * renders `parties.coalition.unavailable` instead of two bars, exactly as the
 * seating map renders a neutral chamber rather than colouring everyone as
 * opposition.
 *
 * **A difference between the blocs is mostly a difference in role.** Questions
 * are an opposition instrument; bills come predominantly from the governing
 * groups; the government answers questions rather than asking them. So a bar
 * showing the opposition ahead on `questionCount` is a description of the
 * institution and not a finding about anyone's diligence — which is what
 * `parties.coalition.caveat` says, on the card rather than under a link.
 *
 * ## Why paired bars and not a chart
 *
 * Two values per metric across seven metrics is a table with a bar in it, not a
 * chart: recharts would bring axes, a legend and a tooltip to say what two
 * numbers and a proportional rule already say. The seating map makes the same
 * call for the opposite reason — the tool has to fit the shape of the data.
 */
export function PartyCoalitionCard({
  parties,
  wahlperiode,
}: {
  parties: readonly PartyAggregate[]
  wahlperiode: number
}) {
  const { t, locale } = useLocale()

  const split = useMemo(() => coalitionSplit(parties, wahlperiode), [parties, wahlperiode])
  const available = hasCoalitionSplit(split)

  // Every metric except the reports tail, which is the sparsest of the nine and
  // would be a row of two near-zero bars.
  const metrics = PARTY_METRICS.filter((metric) => metric.field !== "reportCount")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("parties.coalition.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-muted-foreground text-sm">{t("parties.coalition.subtitle")}</p>

        {!available ? (
          // An unrecorded coalition, or a sweep that has reached only one side.
          // Either way two bars would be drawn against a confident zero.
          <p className="rounded-lg border border-border border-dashed p-6 text-center text-muted-foreground text-sm">
            {t("parties.coalition.unavailable")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BlocHeading bloc={split.government} labelKey="seating.government" />
              <BlocHeading bloc={split.opposition} labelKey="seating.opposition" />
            </div>

            <dl className="flex flex-col gap-4">
              {metrics.map((metric) => (
                <MetricRow
                  key={metric.id}
                  metric={metric}
                  government={split.government.means[metric.field]}
                  opposition={split.opposition.means[metric.field]}
                  locale={locale}
                />
              ))}
            </dl>
          </>
        )}

        {/* Shown whether or not the comparison is available: when it is not, the
            reason is the coalition table, and this is what explains what that
            table is. */}
        <CaveatNote>{t("seating.coalitionCaveat")}</CaveatNote>
        {available && <CaveatNote>{t("parties.coalition.caveat")}</CaveatNote>}
      </CardContent>
    </Card>
  )
}

/** Which groups a bloc is, and how many seats they hold. A bloc comparison that
 * does not name its members is an unfalsifiable claim — and these memberships
 * come from the source code rather than from the Bundestag. */
function BlocHeading({
  bloc,
  labelKey,
}: {
  bloc: CoalitionAggregate
  labelKey: "seating.government" | "seating.opposition"
}) {
  const { t, locale } = useLocale()
  const color = bloc.role === "government" ? "var(--chart-4)" : "var(--chart-2)"

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium text-sm">{t(labelKey)}</span>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {t("parties.coalition.seats", { count: formatCount(bloc.mandates, locale) })}
        </span>
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
        {bloc.parties.map((key) => (
          <span key={key} className="text-xs" style={{ color: partyKeyColor(key) }}>
            {partyByKey(key).label}
          </span>
        ))}
      </p>
    </div>
  )
}

/**
 * One metric, as two proportional bars.
 *
 * Both scaled against the *larger of the two* rather than against a fixed
 * ceiling, so the pair fills the row and the ratio between them is what the eye
 * reads. That is the only comparison this row is making — the absolute figures
 * are printed beside the bars, so the scaling cannot hide them.
 */
function MetricRow({
  metric,
  government,
  opposition,
  locale,
}: {
  metric: PartyMetric
  government: number
  opposition: number
  locale: Parameters<typeof formatBy>[2]
}) {
  const { t } = useLocale()
  const max = Math.max(government, opposition)
  // `max === 0` is both blocs at zero — a real answer for committee work in a
  // historical period (§6.4) — and a division to avoid, since NaN widths
  // silently collapse both bars.
  const width = (value: number) => (max <= 0 ? 0 : (value / max) * 100)

  return (
    <div className="grid gap-1.5">
      <dt className="font-medium text-sm">{t(metric.labelKey)}</dt>
      <dd className="grid gap-1">
        <Bar
          label={t("seating.government")}
          value={government}
          percent={width(government)}
          color="var(--chart-4)"
          format={metric.format}
          locale={locale}
        />
        <Bar
          label={t("seating.opposition")}
          value={opposition}
          percent={width(opposition)}
          color="var(--chart-2)"
          format={metric.format}
          locale={locale}
        />
      </dd>
    </div>
  )
}

function Bar({
  label,
  value,
  percent,
  color,
  format,
  locale,
}: {
  label: string
  value: number
  percent: number
  color: string
  format: PartyMetric["format"]
  locale: Parameters<typeof formatBy>[2]
}) {
  return (
    <div className="flex items-center gap-3">
      {/* The bloc's name is on the heading above and repeated here only for a
          screen reader: sighted readers have the colour and the order, and two
          printed labels per row across seven rows is fourteen repetitions of
          two words. */}
      <span className="sr-only">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          // `Math.max(0, …)` because a NaN or negative width renders as an
          // element that overflows its track rather than as an error.
          style={{ width: `${Math.max(0, percent)}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-20 shrink-0 text-right font-medium text-xs tabular-nums">
        {formatBy(format, value, locale)}
      </span>
    </div>
  )
}
