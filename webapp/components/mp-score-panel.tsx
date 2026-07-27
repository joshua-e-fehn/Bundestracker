"use client"

import { useMutation, useQuery } from "convex/react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { ScoreBreakdown, totalFor } from "@/components/score-breakdown"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { WeightControls } from "@/components/weight-controls"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { formatNumber } from "@/lib/bundestag"
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
}: {
  mpInternalId: string
  wahlperiode: number
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
          <CardTitle>{t("mp.activityScore")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Not a zero. No row means the cron has not scored this MP for this
              period; a big "0" would be a claim about their work. */}
          <p className="text-muted-foreground text-sm">{t("score.none")}</p>
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
        <CardTitle>{t("mp.activityScore")}</CardTitle>
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

        <section className="flex flex-col gap-4">
          <h3 className="font-medium text-sm">{t("score.breakdown")}</h3>
          <ScoreBreakdown
            breakdown={period.scoreBreakdown}
            weights={customised ? effectiveWeights : undefined}
            locale={locale}
          />
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

          {session ? (
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
