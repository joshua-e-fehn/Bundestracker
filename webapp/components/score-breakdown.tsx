"use client"

import { Progress } from "@/components/ui/progress"
import { formatNumber, formatPercent } from "@/lib/bundestag"
import type { Locale, TranslationKey } from "@/lib/i18n"
import { t } from "@/lib/i18n"
// Aliased because this module exports a *component* named `ScoreBreakdown`.
// The type and the thing that renders it want the same name; the component
// keeps it, since that is what every call site writes.
import type { ScoreBreakdown as Breakdown, ScoreComponent, ScoreWeights } from "@/lib/scoring"
import { rescore, SCORE_COMPONENTS } from "@/lib/scoring"
import { cn } from "@/lib/utils"

/**
 * An activity score, taken apart.
 *
 * The premise of lib/scoring.ts is that a total can be explained: weighting is
 * unavoidably editorial, so the components are shown beside it rather than the
 * total being presented as a verdict. This component is that promise rendered —
 * every row states what was measured, what it was multiplied by, and what it
 * contributed.
 *
 * Re-weighting happens here, from the stored `scoreBreakdown`'s raw counts via
 * `rescore`, so a slider move is arithmetic in the browser rather than a query.
 * That is the reason `scoreBreakdown` is stored at all (convex/schema.ts).
 *
 * The bars are proportional to the largest *weighted* contribution, not to the
 * total. The seven components measure incomparable things — a word count and a
 * 0…1 rate — so a bar cannot mean "share of the score" without implying the
 * units are commensurable; it means "how this component compares to the biggest
 * one", which is the only honest reading of a linear sum.
 */

/** The component labels, shared with `WeightControls` so a slider and its bar
 * cannot end up named differently. `Record<ScoreComponent, …>` makes a
 * component added to `SCORE_COMPONENTS` a type error until it is named. */
export const SCORE_COMPONENT_LABELS: Record<ScoreComponent, TranslationKey> = {
  motions: "score.component.motions",
  speeches: "score.component.speeches",
  questions: "score.component.questions",
  reports: "score.component.reports",
  voteParticipation: "score.component.voteParticipation",
  committees: "score.component.committees",
  billSponsorships: "score.component.billSponsorships",
}

/**
 * Which components carry a caveat, and which.
 *
 * The three structural limits from lib/scoring.ts — named ballots only,
 * committees for the current period only, words rather than speech count. That
 * file says they "belong in the UI rather than only here", and this is where
 * they land: each is a case where a low number means "not published" rather
 * than "did not happen", so it is attached to the row that would otherwise be
 * misread rather than printed once at the bottom.
 */
const SCORE_COMPONENT_CAVEATS: Partial<Record<ScoreComponent, TranslationKey>> = {
  voteParticipation: "score.caveat.namedVotes",
  committees: "score.caveat.committees",
  speeches: "score.caveat.speechWords",
}

/** `voteParticipation` is a 0…1 rate; the other six are counts. Formatting it
 * as "0.87" would read as a number of things. */
function formatRaw(component: ScoreComponent, raw: number, locale: Locale): string {
  if (component === "voteParticipation") return formatPercent(raw, locale)
  return formatNumber(raw, locale)
}

export function ScoreBreakdown({
  breakdown,
  weights,
  locale,
  className,
}: {
  breakdown: Breakdown
  /** Custom weights to re-score under. Omitted means the stored breakdown is
   * shown as computed — which is not the same as passing the defaults, since a
   * stored row may predate a change to them. */
  weights?: ScoreWeights
  locale: Locale
  className?: string
}) {
  const scored = weights ? rescore(breakdown, weights) : null
  const rows = SCORE_COMPONENTS.map((component) => ({
    component,
    ...(scored?.breakdown[component] ?? breakdown[component]),
  }))

  // Negative weights are permitted — a user may decide a component should count
  // against a score — so the scale is over magnitudes, and `|| 1` keeps an
  // all-zero breakdown (a real state for a new MP) from dividing by zero.
  const largest = Math.max(...rows.map((row) => Math.abs(row.weighted)), 0) || 1

  return (
    <ul className={cn("flex flex-col gap-4", className)}>
      {rows.map((row) => {
        const caveat = SCORE_COMPONENT_CAVEATS[row.component]
        return (
          <li key={row.component} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium text-sm">
                {t(SCORE_COMPONENT_LABELS[row.component], locale)}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatRaw(row.component, row.raw, locale)} × {formatNumber(row.weight, locale, 2)}{" "}
                ={" "}
                <span className="font-medium text-foreground">
                  {formatNumber(row.weighted, locale, 1)}
                </span>
              </span>
            </div>
            <Progress
              value={(Math.abs(row.weighted) / largest) * 100}
              aria-label={t(SCORE_COMPONENT_LABELS[row.component], locale)}
            />
            {caveat ? <p className="text-muted-foreground text-xs">{t(caveat, locale)}</p> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** The total this breakdown produces under `weights`, or the stored total when
 * none are given. Exported so a caller can show one big number without
 * duplicating the `rescore` call the bars already make. */
export function totalFor(breakdown: Breakdown, weights?: ScoreWeights): number {
  if (!weights) {
    return (
      Math.round(
        SCORE_COMPONENTS.reduce((sum, component) => sum + breakdown[component].weighted, 0) * 100,
      ) / 100
    )
  }
  return rescore(breakdown, weights).totalScore
}
