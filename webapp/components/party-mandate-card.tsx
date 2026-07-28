"use client"

import { useLocale } from "@/components/providers/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCount, formatPercent } from "@/lib/format"
import { partyByKey } from "@/lib/parties"
import { byDirectShare, chamberMandateSplit, type PartyAggregate } from "@/lib/party-comparison"

/**
 * How each Fraktion got into the chamber: constituencies or state lists.
 *
 * ## Why this section is allowed to print a total
 *
 * `parties.meansNotice` sits above every other figure on this page and says
 * that each one is a **mean per scored member**, never a party total. That
 * notice is load-bearing — convex/stats.ts explains that DIP emits one record
 * per MP per document, so a summed activity count would multiply a Fraktion's
 * questions by its own size.
 *
 * None of that applies here, and the section says so rather than letting the
 * notice above appear to qualify it. `electionMethod` is a field on the
 * **roster**: every mandate carries one whether or not the nightly sweep has
 * scored it, and a member holds exactly one mandate, so there is no per-document
 * inflation to avoid. The denominator is therefore `mandates`, not `scored`,
 * and this is the one complete figure on a page of partial ones. Saying that
 * out loud is the point of `parties.mandates.countNotice`; a reader who has
 * just been told "these are all means" needs to be told where that stops.
 *
 * ## A stacked bar, not a pair
 *
 * components/party-coalition-card.tsx draws two bars scaled against the larger,
 * because government and opposition are two populations being compared. These
 * two segments are **parts of one whole** — they sum to the group's seat count —
 * so they share a track. That also makes the rows comparable to each other at a
 * glance, which is the question the section is for: every bar is the same
 * length, and only the split moves.
 *
 * CSS rather than recharts, following that card's argument at length: two or
 * three values per group is a table with a bar in it, not a chart, and recharts
 * inside a content-sized flex column needs a fixed pixel height or it silently
 * renders nothing.
 *
 * ## Three segments
 *
 * `unknown` gets its own segment rather than being folded into the list side.
 * An MP whose `MANDATSART` was not ingested is not a list MP, and a two-segment
 * bar would report a partial ingest as an all-list Fraktion — the collapse
 * `mandateType` (lib/taxonomy.ts) returns null to prevent. On a complete roster
 * it is zero-width and invisible, which is the correct amount of space for it.
 *
 * Colour is `--chart-4`/`--chart-2`, the pair the coalition card already uses
 * for its two non-party series. Not a party palette: a mandate type is not a
 * party attribute, and lib/parties.ts' colours mean "which group". The count
 * beside each bar is what carries the figure, so the hue is never the only
 * signal.
 */
export function PartyMandateCard({ parties }: { parties: readonly PartyAggregate[] }) {
  const { t, locale } = useLocale()

  const chamber = chamberMandateSplit(parties)
  // The share of *known* mandates, so an un-ingested row cannot quietly deflate
  // the headline percentage. `known === 0` is a roster with no mandate types at
  // all — unreachable today, and a division that would render NaN rather than
  // an error if it were not guarded.
  const known = chamber.direct + chamber.list
  const directShare = known === 0 ? 0 : chamber.direct / known

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("parties.mandates.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">{t("parties.mandates.subtitle")}</p>

        {/* The chamber-wide figure, above the per-group bars it is the sum of.
            Deliberately "of {total} mandates" and not "of 630": the roster
            carries 635 mandate rows for 630 concurrent seats (§6.2 — five
            departures, five replacements), so the statutory number would
            contradict the seat counts in the table above. See
            `chamberMandateSplit`. */}
        <p className="text-pretty text-base leading-relaxed">
          <span className="font-semibold tabular-nums">
            {t("parties.mandates.headline", {
              direct: formatCount(chamber.direct, locale),
              total: formatCount(chamber.total, locale),
            })}
          </span>{" "}
          <span className="text-muted-foreground tabular-nums">
            {t("parties.mandates.headlineShare", { share: formatPercent(directShare, locale) })}
          </span>
        </p>

        {/* The key to the two colours, above the bars rather than below them:
            the segments are unlabelled by design (a label per segment across
            six rows is twelve repetitions of two words), so the reader needs
            the mapping before the first bar rather than after the last. The
            unknown segment is deliberately absent from the legend — it is
            zero-width on a complete roster, and naming a swatch nobody can see
            explains nothing. Its meaning arrives with the segment, via the row
            counts that will no longer sum to the seat count. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <LegendSwatch color="var(--chart-4)" label={t("mps.electionDirect")} />
          <LegendSwatch color="var(--chart-2)" label={t("mps.electionList")} />
        </div>

        <dl className="flex flex-col gap-4">
          {byDirectShare(parties).map((party) => (
            <MandateRow key={party.partyKey} party={party} locale={locale} />
          ))}
        </dl>

        {/* Not a `CaveatNote`: this is not a limit of the sources, it is the
            scope of *this* section against the notice at the top of the page.
            The box is reserved for "a low number means not published rather
            than did not happen", and using it here would dilute the shape a
            reader has learned to recognise. */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("parties.mandates.countNotice")}
        </p>
      </CardContent>
    </Card>
  )
}

/** One group's mandates as a single stacked track. */
function MandateRow({
  party,
  locale,
}: {
  party: PartyAggregate
  locale: Parameters<typeof formatCount>[1]
}) {
  const { t } = useLocale()
  const { direct, list, unknown } = party.mandateSplit
  const total = direct + list + unknown

  // A group with no mandates cannot occur on a roster that produced this row,
  // but the guard is the house pattern and the reason is concrete: a NaN width
  // renders as a collapsed or overflowing element rather than as an error.
  const percent = (value: number) => (total <= 0 ? 0 : (value / total) * 100)

  return (
    <div className="grid gap-1.5">
      <dt className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium text-sm">{partyByKey(party.partyKey).label}</span>
        {/* The two counts, in the segments' own order, so the numbers read left
            to right the way the bar does. `tabular-nums` keeps them in a column
            down the rows. */}
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {t("parties.mandates.rowCounts", {
            direct: formatCount(direct, locale),
            list: formatCount(list, locale),
          })}
        </span>
      </dt>
      <dd>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <Segment percent={percent(direct)} color="var(--chart-4)" />
          <Segment percent={percent(list)} color="var(--chart-2)" />
          {/* Rendered unconditionally rather than behind `unknown > 0`: at zero
              it is a zero-width element, and the branch would be a second way
              to express the same nothing. */}
          <Segment percent={percent(unknown)} color="var(--muted-foreground)" />
        </div>
      </dd>
    </div>
  )
}

/** One legend entry. The same shape as `Swatch` in
 * components/seating-legend.tsx — a 3 px square and a muted word — kept local
 * because that one is bound to the seating modes' `size` axis and their count
 * column, neither of which applies here. */
function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-[3px] ring-1 ring-foreground/10"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

function Segment({ percent, color }: { percent: number; color: string }) {
  return (
    <div
      // `Math.max(0, …)` for the same reason `Bar` in
      // components/party-coalition-card.tsx does it: a negative or NaN width
      // overflows the track instead of failing visibly.
      style={{ width: `${Math.max(0, percent)}%`, backgroundColor: color }}
    />
  )
}
