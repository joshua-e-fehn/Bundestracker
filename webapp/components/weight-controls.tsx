"use client"

import { SCORE_COMPONENT_LABELS } from "@/components/score-breakdown"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { formatNumber } from "@/lib/bundestag"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import type { ScoreComponent, ScoreWeights } from "@/lib/scoring"
import { DEFAULT_WEIGHTS, SCORE_COMPONENTS } from "@/lib/scoring"
import { cn } from "@/lib/utils"

/**
 * Sliders for the seven score weights.
 *
 * Controlled: the parent owns the weights, because the same values drive the
 * total and the breakdown bars beside these sliders, and two copies of that
 * state would let the number and the bars disagree mid-drag.
 *
 * The ranges are per component and deliberately not uniform. The weights are
 * conversion factors between incomparable units, not a ranking (see
 * `DEFAULT_WEIGHTS` in lib/scoring.ts): `speeches` is per *word* at 0.01 while
 * `voteParticipation` scales a 0…1 rate by 100. One 0–100 slider for both would
 * make the speech slider unusable — every position past the first pixel scores
 * a debate contribution above an entire term's voting record.
 *
 * So each runs `0 … 2 ×` its own default, which puts every thumb at mid-track
 * on first render and gives both directions the same travel. A higher ceiling
 * was tried and is worse: at ten times the default every thumb sits at 10 % of
 * its track, so the whole usable range is a sliver at the left edge and the
 * control looks broken before it is touched.
 *
 * Nothing is lost by that ceiling, because the score is a linear sum and only
 * the *ratios* between weights affect how MPs compare (`computeScore` in
 * lib/scoring.ts). Making one component dominate is a matter of lowering the
 * others — and 0 is reachable on every slider, which is how a reader says "this
 * should not count at all".
 */

type Range = { min: number; max: number; step: number }

/** Twenty steps across each track: fine enough to adjust the smallest weight
 * (`speeches`, 0.01 per word) at all, coarse enough that a drag lands on a
 * round number rather than on 0.0037. */
const STEPS = 20

function rangeFor(component: ScoreComponent): Range {
  const max = DEFAULT_WEIGHTS[component] * 2
  return { min: 0, max, step: max / STEPS }
}

const RANGES: Record<ScoreComponent, Range> = Object.fromEntries(
  SCORE_COMPONENTS.map((component) => [component, rangeFor(component)]),
) as Record<ScoreComponent, Range>

/** Enough decimals to show the step, so the readout changes when the slider
 * does. A `speeches` weight rendered at two places would sit at "0,01" across
 * several steps of its range, which reads as a slider that does nothing. */
function decimalsFor(step: number): number {
  if (step >= 1) return 0
  // One more place than the step's own magnitude, so a value landing between
  // two steps is still distinguishable from both.
  return Math.min(4, Math.ceil(-Math.log10(step)) + 1)
}

export function WeightControls({
  weights,
  onChange,
  onReset,
  locale,
  className,
}: {
  weights: ScoreWeights
  onChange: (weights: ScoreWeights) => void
  /** Back to `DEFAULT_WEIGHTS`. Optional: a caller that has no reset affordance
   * of its own gets the button, one that does keeps its own. */
  onReset?: () => void
  locale: Locale
  className?: string
}) {
  const isDefault = SCORE_COMPONENTS.every(
    (component) => weights[component] === DEFAULT_WEIGHTS[component],
  )

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {SCORE_COMPONENTS.map((component) => {
        const range = RANGES[component]
        const id = `weight-${component}`
        return (
          <div key={component} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor={id} className="text-sm">
                {t(SCORE_COMPONENT_LABELS[component], locale)}
              </Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatNumber(weights[component], locale, decimalsFor(range.step))}
              </span>
            </div>
            <Slider
              id={id}
              min={range.min}
              max={range.max}
              step={range.step}
              value={[weights[component]]}
              onValueChange={([next]) => onChange({ ...weights, [component]: next })}
            />
          </div>
        )
      })}

      {onReset ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={isDefault}
          className="self-start"
        >
          {t("weights.resetToDefault", locale)}
        </Button>
      ) : null}
    </div>
  )
}
