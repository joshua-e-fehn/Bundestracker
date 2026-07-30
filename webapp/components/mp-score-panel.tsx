"use client"

import { useMutation, useQuery } from "convex/react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { DissentBadge } from "@/components/dissent-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { ScoreBreakdown, totalFor } from "@/components/score-breakdown"
import { SourceCoverageNote } from "@/components/source-coverage-note"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { WeightControls } from "@/components/weight-controls"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { formatNumber } from "@/lib/bundestag"
import { dissentRate } from "@/lib/dissent"
import { formatCount, formatRate } from "@/lib/format"
import type { ScoreWeights } from "@/lib/scoring"
import { DEFAULT_WEIGHTS, resolveWeights } from "@/lib/scoring"

/**
 * The activity score, its parts, and the sliders that re-weight it.
 *
 * The whole panel turns on one architectural point from lib/scoring.ts: the
 * formula lives outside `convex/` so the cron and the browser can both run it.
 * The stored row carries the *raw counts* inside `scoreBreakdown`, so moving a
 * slider is arithmetic here — no query, no round-trip, and no chance of the
 * displayed total disagreeing with the bars beneath it.
 *
 * Signed-out visitors get the sliders too. They are the majority (AGENTS.md:
 * signing in is optional) and the point of an adjustable weighting is lost if
 * you must have an account to see what it does. What an account adds is
 * *persistence*, which is what the CTA offers — rather than gating the control
 * and asking people to take the feature on faith.
 */

export function MPScorePanel({
  mpInternalId,
  wahlperiode,
  current,
}: {
  mpInternalId: string
  wahlperiode: number
  /**
   * The sitting period, so the score can say which of its components the
   * period's sources could not measure.
   *
   * This matters more here than anywhere else on the page. The total is a
   * weighted sum over six components, and on a closed period two or three of
   * them are structurally zero — committees always, speeches before WP18, votes
   * before WP19. A WP17 member therefore scores lower than a WP21 member of
   * identical activity, and nothing in the number says so.
   * `docs/historical-coverage.md` states the consequence plainly: *the UI must
   * not rank an MP from WP15 against one from WP21 as though the same
   * measurements stood behind both.* This is where that warning reaches a
   * reader looking at one person's figure.
   */
  current?: number | null
}) {
  const { t, locale } = useLocale()
  const { data: session } = authClient.useSession()

  // The period total — the `month: null` row. `getScores` returns the monthly
  // rows alongside it; the panel wants the one the rankings sort on.
  const scores = useQuery(api.activityScores.getScores, {
    mpInternalId,
    wahlperiode,
    month: null,
  })
  const preferences = useQuery(api.userPreferences.getPreferences, {})
  const savePreferences = useMutation(api.userPreferences.updatePreferences)

  const [weights, setWeights] = useState<ScoreWeights | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle")

  /**
   * ⚠ A hydration guard, not a loading flag.
   *
   * The `session ?` branch below returns a `<button>` in one arm and an `<a>`
   * in the other, at the same position. The server has no session, so its HTML
   * always holds the link; if the client's first render saw a resolved session
   * it would put a button there, and a differing element *type* at one position
   * makes React throw #418, regenerate the tree and — in React 19 — detach
   * `<head>`, after which the reader's next click anywhere on the site dies
   * with a null `removeChild`. The full account is in
   * components/sidebar-account.tsx.
   *
   * It has been unreachable rather than guarded: the `scores === undefined`
   * branch above returns first, and `useQuery` resolves after hydration on both
   * sides, so the session arm is never what hydrates. That is a real defence
   * and a bad one to rely on — it makes this component's safety a property of
   * an *unrelated* query's timing, which nothing states and no test holds. Two
   * lines make it a property of this file instead. Added when
   * components/sidebar-account.test.ts grew the filesystem check that reads
   * every component branching on `authClient.useSession()`, which is what
   * found it.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Adopts the saved weights once they arrive, and only while the sliders are
  // untouched. Without the null guard a slow preferences query would snap a
  // slider back mid-drag; with it, the user's own adjustment always wins.
  const savedWeights = preferences?.customWeights ?? null
  useEffect(() => {
    if (savedWeights) setWeights((current) => current ?? resolveWeights(savedWeights))
  }, [savedWeights])

  if (scores === undefined) {
    return (
      <Card>
        <CardContent className="h-48 animate-pulse rounded-md bg-muted" />
      </Card>
    )
  }

  const period = scores.find((row) => row.month === null) ?? null
  if (!period) {
    return (
      <Card>
        <CardHeader>
          {/* `as="h2"` — F-05 fix, matching the recent-records panels and
              the sidebar cards. */}
          <CardTitle as="h2">{t("mp.activityScore")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Not a zero. No row means the cron has not scored this MP for this
              period; a big "0" would be a claim about their work.
              `docs/historical-coverage.md` records that this is the *normal*
              state of a freshly backfilled period — the nightly Convex sweep
              recomputes the current calendar month, so a closed period stays
              unscored until `scores --wp N --all-months` runs. */}
          <p className="text-muted-foreground text-sm">{t("score.none")}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">{t("period.notScored")}</p>
        </CardContent>
      </Card>
    )
  }

  const customised = weights !== null
  const effectiveWeights = weights ?? DEFAULT_WEIGHTS
  const total = customised ? totalFor(period.scoreBreakdown, effectiveWeights) : period.totalScore

  async function save() {
    if (!weights) return
    setSaveState("saving")
    try {
      await savePreferences({ customWeights: weights })
      setSaveState("saved")
    } catch {
      // Surfaced rather than swallowed: the user chose these weights, and a
      // silent failure means they come back to find them gone.
      setSaveState("failed")
    }
  }

  return (
    <Card>
      <CardHeader>
        {/* `as="h2"` — see the note on the sibling `CardTitle` above. */}
        <CardTitle as="h2">{t("mp.activityScore")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-5xl tabular-nums tracking-tight">
            {formatNumber(total, locale, 1)}
          </span>
          <span className="text-muted-foreground text-sm">
            {customised ? t("score.customised") : t("score.defaultWeights")}
          </span>
        </div>

        <Separator />

        {/* Beside the score, not buried on /rankings' sixth tab. It is the one
            figure here that says something about *how* this member votes rather
            than how much they do — and unlike every other number on the panel it
            is not part of the weighted total, which is why it sits in its own
            section rather than as an eighth component bar. */}
        <MPDissentFigure mpInternalId={mpInternalId} wahlperiode={wahlperiode} />

        <Separator />

        <section className="flex flex-col gap-4">
          <h3 className="font-medium text-sm">{t("score.breakdown")}</h3>
          <ScoreBreakdown
            breakdown={period.scoreBreakdown}
            weights={customised ? effectiveWeights : undefined}
            locale={locale}
          />
          {/* Which components this period's sources could not measure, under
              the bars showing them at zero. Three separate notes rather than
              one summary, because they have three different boundaries and a
              reader on WP19 needs the committee one and not the speech one.
              All three render nothing on the current period. */}
          <SourceCoverageNote source="committees" wahlperiode={wahlperiode} current={current} />
          <SourceCoverageNote source="speeches" wahlperiode={wahlperiode} current={current} />
          <SourceCoverageNote source="votes" wahlperiode={wahlperiode} current={current} />
        </section>

        <Separator />

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-medium text-sm">{t("weights.title")}</h3>
            <p className="text-muted-foreground text-xs">{t("weights.description")}</p>
          </div>

          <WeightControls
            weights={effectiveWeights}
            locale={locale}
            onChange={(next) => {
              setWeights(next)
              setSaveState("idle")
            }}
            onReset={() => {
              setWeights(null)
              setSaveState("idle")
            }}
          />

          {/* `mounted &&` pins the first client render to the server's branch —
              see the ⚠ above. It is the same shape components/sign-in-panel.tsx
              uses, rather than an early return, because only this section
              depends on the session: the score, the breakdown and the sliders
              above it render identically either way and must not wait. */}
          {mounted && session ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={!customised || saveState === "saving"}
              >
                {saveState === "saving" ? t("weights.saving") : t("weights.save")}
              </Button>
              {saveState === "saved" ? (
                <span className="text-muted-foreground text-xs">{t("weights.saved")}</span>
              ) : null}
              {saveState === "failed" ? (
                <span className="text-destructive text-xs">{t("weights.saveFailed")}</span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1.5 rounded-md border border-dashed p-3">
              {/* The CTA is a link to the picker, not prose. It was static text
                  while `/sign-in` did not exist; now that it does, an
                  invitation to sign in that cannot be acted on is the odd one
                  out — every other affordance on this site goes somewhere. */}
              <Button asChild variant="link" size="sm" className="h-auto p-0 font-medium text-sm">
                <Link href="/sign-in">{t("weights.signInCta")}</Link>
              </Button>
              <p className="text-muted-foreground text-xs">{t("weights.signInHint")}</p>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

/**
 * How often this member voted against their own group, across the period.
 *
 * ## Why the sentence, rather than a big number
 *
 * Every other figure on this panel is a count of things done, where more is more.
 * This one is a count of occasions on which a named person broke with their
 * group, and rendered as a bare "12" beside "Abweichungen" it reads as a score —
 * something to be high or low on. It is not: it is a fact with a denominator,
 * and the denominator is doing most of the work. So the figure is a sentence
 * carrying both, and the rate is the smaller line beneath it.
 *
 * ## Four states, and none of them is a zero
 *
 * `getDissentTally` returns null where nothing has been computed, which is the
 * state of every ballot the backfill has not reached. That is *not* the same as
 * a member who never dissented, and it is not the same as a member who cast no
 * countable vote — three different sentences, because collapsing any two of them
 * would credit somebody with a record they do not have. The fourth is the
 * ordinary case. Same distinction `score.none` draws for an unscored MP, and the
 * same reason: a big "0" would be a claim about their conduct.
 *
 * `ballotsCast` is votes cast **in ballots where the group had a line**, not
 * every ballot in the period — an evenly split group has no line to break, so
 * those ballots belong in neither half of the fraction. `ballotsInPeriod` sits
 * beneath as the context that makes the denominator legible.
 */
function MPDissentFigure({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const tally = useQuery(api.votes.getDissentTally, { mpInternalId, wahlperiode })

  if (tally === undefined) {
    return <div className="h-16 animate-pulse rounded-md bg-muted" />
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-sm">{t("mp.dissent")}</h3>
        {/* The same badge the cards carry, so a reader who saw the mark in a
            list finds the number behind it here. `null` renders nothing. */}
        <DissentBadge tally={tally} locale={locale} />
      </div>

      {tally === null ? (
        // Not computed. Distinct from "never dissented" — see the header.
        <p className="text-muted-foreground text-sm">{t("mp.dissentNotComputed")}</p>
      ) : tally.ballotsCast === 0 ? (
        <p className="text-muted-foreground text-sm">{t("mp.dissentNoBallots")}</p>
      ) : (
        <>
          <p className="text-sm leading-relaxed">
            {tally.dissents === 0
              ? t("mp.dissentNone", { cast: formatCount(tally.ballotsCast, locale) })
              : t("mp.dissentCount", {
                  count: formatCount(tally.dissents, locale),
                  cast: formatCount(tally.ballotsCast, locale),
                })}
          </p>
          <p className="text-muted-foreground text-xs">
            {/* `formatRate`, not `formatPercent`: dissent rates cluster in the
                low single digits, and whole percents would collapse the entire
                interesting range onto "0 %" and "1 %". The same reason
                lib/format.ts gives for the participation column. Through
                `dissentRate` rather than the stored field so a zero denominator
                cannot render as "0.0 %" — it returns null, which this branch
                has already excluded. */}
            {t("mp.dissentRate", {
              rate: formatRate(dissentRate(tally) ?? 0, locale),
            })}{" "}
            · {t("mp.dissentOfBallots", { ballots: formatCount(tally.ballotsInPeriod, locale) })}
          </p>
        </>
      )}

      {/* The limit that makes this a bounded claim rather than a voting record:
          named ballots are the only ones with a per-MP trace at all. */}
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t("score.caveat.namedVotes")}
      </p>
    </section>
  )
}
