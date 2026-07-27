"use client"

import { motion } from "framer-motion"
import { useLocale } from "@/components/providers/locale-provider"
import { formatRawComponent, SCORE_COMPONENT_LABELS } from "@/components/score-breakdown"
import { formatNumber } from "@/lib/bundestag"
import { formatScore } from "@/lib/format"
import { CHAPTERS } from "@/lib/protokoll"
import { computeScore, DEFAULT_WEIGHTS, SCORE_COMPONENTS } from "@/lib/scoring"
import { REVEAL_OFFSET, REVEAL_TRANSITION, useReveal } from "./use-reveal"

/**
 * Chapter 3 — the seven score components, arriving one at a time, collapsing
 * into one number.
 *
 * This is the page's editorial moment and the reason Concept A was the
 * recommendation: the scoring methodology *is* Bundestracker's claim to
 * legitimacy — "no subjective scoring, every metric backed by Bundestag
 * records" (AGENTS.md) — and it is currently invisible on the home page. A
 * reader can reach it only by opening an MP's profile and scrolling to the
 * breakdown panel.
 *
 * ## The numbers are computed, not written
 *
 * The weights come from `DEFAULT_WEIGHTS` and the total from `computeScore`,
 * both in lib/scoring.ts — the same functions the nightly sweep runs and the
 * same ones a signed-in reader's slider re-runs in the browser. A worked
 * example with hand-typed arithmetic would be a fourth implementation of the
 * formula, and it would go stale the first time a default weight moved, which
 * is precisely the drift that file's header exists to prevent.
 *
 * The *inputs* are illustrative and say so (`protokoll.chapter3Example`): they
 * are a plausible member's period, not anyone's. That is the one honest way to
 * show a worked example on a page where every other figure is a record — a real
 * MP's numbers here would make the methodology section a leaderboard entry, and
 * a made-up MP would be the synthetic data this codebase already removed once.
 *
 * ## The stagger
 *
 * Seven rows, 0.09 s apart, arriving as the reader reaches the block. Not
 * driven by scroll position: §1's constraint is that heights change when data
 * lands, and this section is the one on the page with no query at all — binding
 * it to a scroll offset would make it the only section whose choreography could
 * be desynchronised by a *sibling's* data arriving. A reveal plus a stagger is
 * the same reading experience and is immune to that.
 */

/**
 * The illustrative period.
 *
 * Chosen to be unremarkable: roughly the middle of each distribution for a
 * back-bench member over a full Wahlperiode, so no row dominates the bars and
 * the reader's attention lands on the weights rather than on one big number.
 * `voteParticipation` is a 0…1 rate, which is why it is 0.94 and not 94.
 */
const EXAMPLE_INPUTS = {
  motions: 12,
  speeches: 24_000,
  questions: 31,
  reports: 3,
  voteParticipation: 0.94,
  committees: 2,
  billSponsorships: 7,
} as const

export function ChapterMeasure() {
  const { t, locale } = useLocale()
  const { ref, revealed } = useReveal<HTMLDivElement>()

  const { totalScore, breakdown } = computeScore(EXAMPLE_INPUTS, DEFAULT_WEIGHTS)
  // Proportional to the largest *weighted* contribution rather than to the
  // total, for `ScoreBreakdown`'s reason: the seven components measure
  // incomparable things — a word count and a 0…1 rate — so a bar cannot mean
  // "share of the score" without implying the units are commensurable.
  const largest = Math.max(...SCORE_COMPONENTS.map((c) => Math.abs(breakdown[c].weighted)), 1)

  return (
    <div ref={ref} className="grid gap-8">
      <p className="text-muted-foreground text-sm">{t("protokoll.chapter3Example")}</p>

      <ol className="grid gap-4">
        {SCORE_COMPONENTS.map((component, index) => {
          const row = breakdown[component]
          return (
            <motion.li
              key={component}
              className="grid gap-1.5"
              initial={{ opacity: 0, y: REVEAL_OFFSET }}
              animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: REVEAL_OFFSET }}
              // The stagger. `revealed` flips once for the whole list and each
              // row delays off its own index, so the seven arrive in order
              // without seven observers.
              transition={{ ...REVEAL_TRANSITION, delay: revealed ? index * 0.09 : 0 }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{t(SCORE_COMPONENT_LABELS[component])}</span>
                {/* The whole arithmetic — measured × weight = points — and not
                    just the result. The chapter's claim is that the number can
                    be taken apart, so a row printing only "Gewicht 100 · 94,0"
                    would be asserting exactly what it set out to demonstrate:
                    where the 94 came from is the interesting half.

                    `formatRawComponent` rather than a local formatter, because
                    `voteParticipation` is a 0…1 rate and the other six are
                    counts — components/score-breakdown.tsx owns that rule and
                    a copy here is how one of the two comes to print "0,94". */}
                <span className="text-muted-foreground text-sm tabular-nums">
                  {formatRawComponent(component, row.raw, locale)} ×{" "}
                  {formatNumber(row.weight, locale, 2)} ={" "}
                  <span className="font-medium text-foreground">
                    {formatScore(row.weighted, locale)}
                  </span>
                </span>
              </div>
              {/* The bar. A plain div rather than `<Progress>`: this is not a
                  progress indicator, it carries no `aria-valuenow` a reader
                  would want, and the figure beside it is already printed. The
                  Radix root would add a `role="progressbar"` announcing "94 %"
                  for a bar that means "this component's contribution relative
                  to the largest one". */}
              <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-gold-brand"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: revealed ? Math.abs(row.weighted) / largest : 0 }}
                  style={{ transformOrigin: "left" }}
                  transition={{
                    ...REVEAL_TRANSITION,
                    duration: 0.7,
                    delay: revealed ? index * 0.09 + 0.1 : 0,
                  }}
                />
              </div>
            </motion.li>
          )
        })}
      </ol>

      {/* The collapse: seven rows become one number. Arrives after all seven,
          which is what makes it read as a *consequence* of them rather than as
          an eighth row. */}
      <motion.div
        className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-gold/25 border-t pt-6"
        initial={{ opacity: 0, y: REVEAL_OFFSET }}
        animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: REVEAL_OFFSET }}
        transition={{
          ...REVEAL_TRANSITION,
          delay: revealed ? SCORE_COMPONENTS.length * 0.09 + 0.15 : 0,
        }}
      >
        <div className="grid gap-1">
          <span className="font-medium text-sm">{t("score.total")}</span>
          <span className="max-w-md text-muted-foreground text-sm leading-relaxed">
            {t("protokoll.chapter3Collapse")}
          </span>
        </div>
        <span className="font-semibold text-5xl tabular-nums">
          {formatScore(totalScore, locale)}
        </span>
      </motion.div>

      {/* The three structural limits, as part of the argument. §7's requirement
          #5 — a story that omits the limitations of its own measure would be a
          worse dashboard *and* a worse story. Set as prose at body size rather
          than in the site's standard `CaveatNote` box, because here it is the
          chapter's conclusion rather than a footnote to it. */}
      <motion.p
        className="max-w-2xl border-border border-l-2 pl-4 text-muted-foreground text-sm leading-relaxed"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={{
          ...REVEAL_TRANSITION,
          delay: revealed ? SCORE_COMPONENTS.length * 0.09 + 0.3 : 0,
        }}
      >
        {t("protokoll.chapter3Limits")}
      </motion.p>
    </div>
  )
}

export const MEASURE_CHAPTER = CHAPTERS[2]
