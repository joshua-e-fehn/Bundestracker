/**
 * Comparing Fraktionen: which figures are comparable, and what has to be said
 * about them before they are drawn.
 *
 * The page this feeds puts six parliamentary groups of wildly different sizes
 * on one chart. That is a genuinely useful view and it is also the easiest place
 * on this site to publish a plausible wrong number, so three decisions are made
 * here — once, in the open — rather than per component.
 *
 * ## 1. Every figure is a **mean per scored member**, never a party total
 *
 * `convex/stats.ts` sets out why a per-MP count may not be summed: DIP's
 * `/aktivitaet` "emits one record per MP per document" (§3.4), so a Kleine
 * Anfrage tabled by a Fraktion with forty signatories is forty rows. Summing
 * `questionCount` over a party would report forty questions where the Bundestag
 * printed one, and the error would scale with the party's size — which is
 * precisely the axis this page compares on. So nothing here sums. A mean answers
 * the question the page actually asks ("what does the average member of this
 * group do") and is immune to that double count, because the inflation applies
 * to numerator and denominator alike.
 *
 * The denominator is **scored** mandates, not all of them. An MP the nightly
 * sweep has not reached has no score row, and counting them as a zero would drag
 * a party's mean down for a computation that has not run — the same distinction
 * `seatingLevel` draws by returning null and `getMPsWithScores` draws by
 * returning null rather than 0. `PartyAggregate` carries both counts so the page
 * can state the gap instead of hiding it.
 *
 * ## 2. The radar is **normalised per axis**, and says so
 *
 * The six axes are in six different units — a speech word count reaches five
 * digits, a committee seat count reaches seven, and vote participation is a 0…1
 * share. Plotted raw on one radius, five of the six axes collapse onto the
 * origin and the chart becomes a picture of which metric has the largest units.
 * So each axis is scaled to the leading party on it (`RADAR_MAX`), which makes
 * the shape readable and makes it a statement about *relative standing only* —
 * `parties.radarCaveat` says that to the reader, and `buildRadarSeries` returns
 * the raw mean alongside so the tooltip can show what was actually measured.
 *
 * ## 3. A small group's mean is volatile, and that is not hidden either
 *
 * §9 puts fraktionslos at 3 members against CDU/CSU's 209. One busy independent
 * moves that group's mean by a third. They are still shown — an MP with no group
 * holds a seat, which is the same call `SEATING_ORDER` makes by seating them at
 * the edge rather than dropping them — and `parties.smallGroupCaveat` carries
 * the warning.
 *
 * Nothing here imports from `convex/` or from React: `convex/parties.ts` builds
 * its validators against `PartyMetricValues` and the browser draws the charts,
 * in the same spirit as lib/taxonomy.ts and lib/trends.ts.
 */

import type { TranslationKey } from "./i18n"
import { type PartyKey, partyByKey } from "./parties"
import { type CoalitionRole, coalitionRole } from "./seating"
import type { RankingMetric } from "./taxonomy"

// --- the comparable figures -----------------------------------------------

/**
 * One value per rankable metric.
 *
 * Keyed by `RankingMetric` rather than restating the nine fields, so this and
 * `convex/parties.ts`' validator cannot drift: a metric added to lib/taxonomy.ts
 * is a type error in both until it is handled. The same guard `scoreWeights`
 * puts on `SCORE_COMPONENTS` in convex/schema.ts.
 */
export type PartyMetricValues = Record<RankingMetric, number>

/**
 * One parliamentary group's row — what `getPartyComparison` returns per party.
 *
 * `partyKey` rather than a Fraktion string, and that is the load-bearing part.
 * The sources spell one group at least four ways (§6.4, and §5.2's non-breaking
 * space), and a real deployment already produced `Fraktionslos` and
 * `fraktionslos` as two rows of `getFractionSizes` — which
 * components/seating-legend.tsx had to fold back together after the fact.
 * Grouping on the folded key server-side means this page never has that bug to
 * fix, and it is why the aggregation lives in Convex rather than in the browser.
 */
export type PartyAggregate = {
  partyKey: PartyKey
  /** Mandates on the roster folded into this group — the seat count, including
   * members the sweep has not scored. */
  mandates: number
  /** Mandates with a period score row. The denominator of every mean below. */
  scored: number
  /** Mean per **scored** member. See the header on why this is never a sum. */
  means: PartyMetricValues
  /**
   * Median total score.
   *
   * Beside the mean rather than instead of it, because the two disagree exactly
   * where the reader most needs to know: one hyperactive member lifts a mean and
   * leaves a median alone, and in a three-seat group that is the difference
   * between a finding and an artefact. Only for `totalScore` — it is the figure
   * the ranked table sorts on, and nine medians would be a table nobody reads.
   */
  medianScore: number
}

/**
 * A metric as this page offers it.
 *
 * A table rather than nine near-identical chart components, in the same spirit
 * as `LEADERBOARDS` in lib/leaderboards.ts, `SEATING_MODES` in lib/seating.ts
 * and `TREND_CHARTS` in lib/trends.ts. They differ in which field they read, how
 * it is formatted, whether the radar has an axis for it, and which structural
 * limit it carries — nothing else.
 */
export type PartyMetric = {
  /** Stable id, used as the bar chart's tab value. */
  id: string
  field: RankingMetric
  labelKey: TranslationKey
  /** The short form, for a radar axis and a table head where the full label
   * would wrap. */
  shortLabelKey: TranslationKey
  descriptionKey: TranslationKey
  /**
   * Dispatch for lib/format.ts' `formatBy`.
   *
   * `mean`, not `integer`, for every count-derived metric on this page — and
   * that is a correctness point rather than a styling one. These figures are
   * averages of whole things, so they land on 0.5 and 8.5; rounded to whole
   * numbers, 0.5 and 1.0 both print as "1", the committee bar chart's axis reads
   * "0 0 1 1 1" with duplicate ticks, and a Fraktion averaging 8.5 motions is
   * reported as 8. See `formatMean`.
   */
  format: "mean" | "rate" | "score"
  /** Whether this metric is one of the radar's axes. See `RADAR_METRICS`. */
  radar: boolean
  /** The structural limit on what this figure means, if it has one.
   * `undefined` rather than an empty string, so a forgotten caveat is visibly
   * absent — the convention every other table in lib/ follows. */
  caveatKey?: TranslationKey
}

/**
 * The nine metrics, six of which are radar axes.
 *
 * The six are the ones Wave 9 names — motions, speeches, questions, votes,
 * committees, bills — and `speeches` is drawn as the **word count** rather than
 * the segment count. §5.2 is the reason and it matters more here than anywhere
 * else on the site: question time fragments a minister's turn into dozens of
 * replies, so a radar axis on segment counts would show a governing party
 * bulging outward for holding the offices that answer questions. The segment
 * count is still offered as its own bar chart, with the caveat, because hiding
 * it would not answer the question — it would just make the answer unavailable.
 *
 * `reportCount` is last and off the radar: it is the sparsest of the nine, so an
 * axis for it would mostly be a picture of which groups happen to table
 * Berichte.
 */
export const PARTY_METRICS: readonly PartyMetric[] = [
  {
    id: "score",
    field: "totalScore",
    labelKey: "parties.metric.score",
    shortLabelKey: "parties.metric.score.short",
    descriptionKey: "parties.metric.score.desc",
    format: "score",
    radar: false,
    caveatKey: "parties.caveat.score",
  },
  {
    id: "motions",
    field: "motionCount",
    labelKey: "parties.metric.motions",
    shortLabelKey: "parties.metric.motions.short",
    descriptionKey: "parties.metric.motions.desc",
    format: "mean",
    radar: true,
  },
  {
    id: "speech-words",
    field: "speechWordCount",
    labelKey: "parties.metric.speechWords",
    shortLabelKey: "parties.metric.speechWords.short",
    descriptionKey: "parties.metric.speechWords.desc",
    format: "mean",
    radar: true,
    caveatKey: "score.caveat.speechWords",
  },
  {
    id: "speeches",
    field: "speechCount",
    labelKey: "parties.metric.speeches",
    shortLabelKey: "parties.metric.speeches.short",
    descriptionKey: "parties.metric.speeches.desc",
    format: "mean",
    radar: false,
    caveatKey: "rankings.caveat.speechCount",
  },
  {
    id: "questions",
    field: "questionCount",
    labelKey: "parties.metric.questions",
    shortLabelKey: "parties.metric.questions.short",
    descriptionKey: "parties.metric.questions.desc",
    format: "mean",
    radar: true,
  },
  {
    id: "votes",
    field: "voteParticipationRate",
    labelKey: "parties.metric.votes",
    shortLabelKey: "parties.metric.votes.short",
    descriptionKey: "parties.metric.votes.desc",
    format: "rate",
    radar: true,
    caveatKey: "rankings.caveat.namedVotesOnly",
  },
  {
    id: "committees",
    field: "committeeCount",
    labelKey: "parties.metric.committees",
    shortLabelKey: "parties.metric.committees.short",
    descriptionKey: "parties.metric.committees.desc",
    format: "mean",
    radar: true,
    caveatKey: "rankings.caveat.committeesCurrentOnly",
  },
  {
    id: "bills",
    field: "billSponsorshipCount",
    labelKey: "parties.metric.bills",
    shortLabelKey: "parties.metric.bills.short",
    descriptionKey: "parties.metric.bills.desc",
    format: "mean",
    radar: true,
  },
  {
    id: "reports",
    field: "reportCount",
    labelKey: "parties.metric.reports",
    shortLabelKey: "parties.metric.reports.short",
    descriptionKey: "parties.metric.reports.desc",
    format: "mean",
    radar: false,
  },
]

/** The radar's axes, in `PARTY_METRICS` order so the polygon's vertices are the
 * same on every render and between the chart and its legend. */
export const RADAR_METRICS: readonly PartyMetric[] = PARTY_METRICS.filter((metric) => metric.radar)

/** The bar chart opens on the activity score — the one metric that summarises
 * the other eight, matching `DEFAULT_TREND_CHART_ID`'s reasoning. */
export const DEFAULT_PARTY_METRIC_ID = "score"

export function partyMetricById(id: string): PartyMetric | undefined {
  return PARTY_METRICS.find((metric) => metric.id === id)
}

// --- ranking ---------------------------------------------------------------

/**
 * Parties ordered by one metric, highest first.
 *
 * Ties break by the party's canonical label so a redraw cannot reshuffle them —
 * the same stability `ranked` provides in convex/rankings.ts. No rank *numbers*
 * are assigned: a bar chart's order is its ranking, and a group's position among
 * seven is not the kind of claim that needs competition numbering.
 *
 * Groups with no scored member are dropped rather than sorted to the bottom on a
 * zero. A mean over zero members is not zero, it is undefined, and a bar at the
 * origin asserts the first.
 */
export function rankPartiesBy(
  rows: readonly PartyAggregate[],
  field: RankingMetric,
): PartyAggregate[] {
  return rows
    .filter((row) => row.scored > 0)
    .sort(
      (a, b) =>
        b.means[field] - a.means[field] ||
        partyByKey(a.partyKey).label.localeCompare(partyByKey(b.partyKey).label, "de"),
    )
}

// --- the radar -------------------------------------------------------------

/**
 * The value the leading party on an axis is drawn at.
 *
 * 100 rather than 1, so the axis reads as a percentage of the leader and the
 * tick labels are whole numbers. The number itself is arbitrary; what is not is
 * that every axis shares it — see the header.
 */
export const RADAR_MAX = 100

/** One vertex of the radar: an axis, every party's normalised value on it, and
 * the raw means behind them. */
export type RadarPoint = {
  /** The metric's id — the row key, and what `PolarAngleAxis` is keyed on. */
  metric: string
  /** The axis label, already translated by the caller. */
  label: string
  /**
   * Normalised 0…`RADAR_MAX` per party, flattened onto the row because that is
   * the shape recharts reads: `<RadarChart data={points}>` takes one row per
   * axis and one `<Radar dataKey={partyKey}>` per series.
   *
   * Party keys are safe as flat keys here — none contains a `.` or `[`, which
   * are the characters recharts' path lookup would treat as separators.
   */
  values: Record<string, number>
  /** The unnormalised mean per party, for the tooltip. Kept off `values` so it
   * cannot be picked up as a series: a `dataKey` that resolved to a raw word
   * count would draw one party's polygon a thousand times outside the chart. */
  raw: Record<string, number>
  /** The leading party's raw mean on this axis — the value `RADAR_MAX`
   * represents, so the tooltip can say what the scale is. */
  max: number
}

/**
 * The radar's rows, one per axis.
 *
 * Normalisation is per axis and against the *observed* maximum rather than a
 * theoretical one. Vote participation has a natural ceiling of 1 and the rest do
 * not, so scaling everything to its leader is the only rule that treats the six
 * axes alike — and it is the rule that makes the chart mean "relative standing",
 * which `parties.radarCaveat` states.
 *
 * An axis on which every party measures zero is drawn at zero rather than
 * dropped: for committee work in a historical Wahlperiode that is the true
 * shape (§6.4 publishes nothing), and silently removing the axis would change
 * the polygon's geometry into one the reader would compare against another
 * period's hexagon without noticing it had five sides.
 */
export function buildRadarSeries(
  rows: readonly PartyAggregate[],
  metrics: readonly PartyMetric[],
  label: (metric: PartyMetric) => string,
): RadarPoint[] {
  const scored = rows.filter((row) => row.scored > 0)

  return metrics.map((metric) => {
    let max = 0
    for (const row of scored) {
      const value = row.means[metric.field]
      if (Number.isFinite(value) && value > max) max = value
    }

    const values: Record<string, number> = {}
    const raw: Record<string, number> = {}
    for (const row of scored) {
      const value = Number.isFinite(row.means[metric.field]) ? row.means[metric.field] : 0
      raw[row.partyKey] = value
      // `max === 0` is every party at zero, not a division to guard against
      // producing NaN — which recharts renders as a gap in the polygon rather
      // than as an error.
      values[row.partyKey] = max === 0 ? 0 : (value / max) * RADAR_MAX
    }

    return { metric: metric.id, label: label(metric), values, raw, max }
  })
}

// --- government against opposition ----------------------------------------

/**
 * One bloc's figures — the government's or the opposition's.
 *
 * `parties` is carried so the card can name which groups it added up. A bloc
 * comparison that does not say who is in it is an unfalsifiable claim, and which
 * groups govern is the one fact on this page that comes from the source code
 * rather than from the Bundestag (see `GOVERNING_PARTIES`).
 */
export type CoalitionAggregate = {
  role: CoalitionRole
  parties: PartyKey[]
  mandates: number
  scored: number
  means: PartyMetricValues
}

/** The two blocs, plus whatever fell outside them. */
export type CoalitionSplit = {
  government: CoalitionAggregate
  opposition: CoalitionAggregate
  /** Groups whose role is not recorded for this period. Non-empty only for a
   * Wahlperiode absent from `GOVERNING_PARTIES` — see the warning there — in
   * which case the whole comparison is unavailable rather than wrong. */
  unknown: CoalitionAggregate
}

const METRIC_FIELDS: readonly RankingMetric[] = [
  "totalScore",
  "motionCount",
  "speechCount",
  "speechWordCount",
  "questionCount",
  "reportCount",
  "voteParticipationRate",
  "committeeCount",
  "billSponsorshipCount",
]

function emptyValues(): PartyMetricValues {
  const values = {} as PartyMetricValues
  for (const field of METRIC_FIELDS) values[field] = 0
  return values
}

/**
 * Government against opposition, as the mean over each bloc's members.
 *
 * **Weighted by scored member count, not by party.** A plain average of the
 * parties' means would give a three-seat group the same weight as a 209-seat one
 * and answer a question nobody asked; weighting by members answers the one the
 * card poses — what does the average government backbencher do, against the
 * average opposition one. Recovering the bloc's total from each party's
 * `mean × scored` is exact, because that product is the sum the mean came from.
 *
 * Which groups govern is read from `coalitionRole` (lib/seating.ts) rather than
 * restated, so the seating map's coalition colouring and this card cannot
 * disagree about who is in government. ⚠ That table is hand-maintained: no
 * Bundestag dataset records a coalition. A period missing from it puts every
 * group in `unknown`, and the card says so instead of colouring the whole
 * chamber as opposition.
 */
export function coalitionSplit(
  rows: readonly PartyAggregate[],
  wahlperiode: number,
): CoalitionSplit {
  const blocs: Record<CoalitionRole, CoalitionAggregate> = {
    government: { role: "government", parties: [], mandates: 0, scored: 0, means: emptyValues() },
    opposition: { role: "opposition", parties: [], mandates: 0, scored: 0, means: emptyValues() },
    unknown: { role: "unknown", parties: [], mandates: 0, scored: 0, means: emptyValues() },
  }

  // Sums first, divided once at the end: accumulating means as they arrive
  // would weight each party by its position in the list rather than its size.
  const sums: Record<CoalitionRole, PartyMetricValues> = {
    government: emptyValues(),
    opposition: emptyValues(),
    unknown: emptyValues(),
  }

  for (const row of rows) {
    // Keyed by the canonical label rather than the raw Fraktion string, because
    // that string no longer exists at this point — the group has already been
    // folded to a key server-side. `coalitionRole` folds through `partyFor`
    // itself, and a label is a spelling it recognises.
    const role = coalitionRole(partyByKey(row.partyKey).label, wahlperiode)
    const bloc = blocs[role]
    bloc.parties.push(row.partyKey)
    bloc.mandates += row.mandates
    bloc.scored += row.scored
    for (const field of METRIC_FIELDS) {
      sums[role][field] += row.means[field] * row.scored
    }
  }

  for (const role of ["government", "opposition", "unknown"] as const) {
    const bloc = blocs[role]
    if (bloc.scored === 0) continue
    for (const field of METRIC_FIELDS) {
      bloc.means[field] = sums[role][field] / bloc.scored
    }
  }

  return { government: blocs.government, opposition: blocs.opposition, unknown: blocs.unknown }
}

/**
 * Whether the two blocs can be compared at all.
 *
 * False when either side has no scored member — an unrecorded coalition
 * (`GOVERNING_PARTIES` has no entry for the period), or a deployment the sweep
 * has only partly reached. The card renders its caveat instead of two bars, one
 * of which would be a confident zero.
 */
export function hasCoalitionSplit(split: CoalitionSplit): boolean {
  return split.government.scored > 0 && split.opposition.scored > 0
}
