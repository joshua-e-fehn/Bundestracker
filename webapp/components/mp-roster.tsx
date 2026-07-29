"use client"

import { useQuery } from "convex/react"
import { useSearchParams } from "next/navigation"
import { MPTable } from "@/components/mp-table"
import { HistoricalPeriodNotice, PeriodSelector } from "@/components/period-selector"
import { useLocale } from "@/components/providers/locale-provider"
import { PeriodProvider } from "@/components/providers/period-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { PERIOD_PARAM, parsePeriodParam, periodIngested, resolvePeriod } from "@/lib/period"

/**
 * `/mps`' client half: resolve the period, fetch that period's roster, render
 * the table.
 *
 * ## Why this is not `PeriodScope`
 *
 * `PeriodScope` hands a period to a component that then fetches for itself, and
 * seven routes use it exactly that way. This one cannot, for a reason specific
 * to `/mps`: the table's own loading and empty states are about *the roster*,
 * and it has neither — it took a `Preloaded<...>` that was, by construction,
 * already resolved. So somebody has to hold the query between the period and
 * the table, and doing it here keeps `MPTable` a renderer of rows rather than
 * making it the only `PeriodScope` consumer that also has to know how to be
 * empty.
 *
 * It is deliberately the same *shape* as `PeriodScope` — same URL parameter,
 * same three states, same selector and banner above the content — so the two
 * cannot drift into behaving differently on the one page that has its own.
 * `lib/period.ts` is what makes that true: both read the period through
 * `parsePeriodParam`/`resolvePeriod` rather than each parsing `?wp=` for
 * itself.
 *
 * ## `"skip"` until the period is known
 *
 * `useQuery` fires nothing while the period is `undefined`, which is the
 * convention every section in components/home-sections.tsx follows: a query
 * issued with `undefined` would be a request for a Bundestag with no number,
 * and Convex's argument validator would reject it as an error rather than as a
 * loading state.
 */
export function MPRoster() {
  const { t } = useLocale()
  const params = useSearchParams()
  const options = useQuery(api.mps.listPeriods, {})

  const requested = parsePeriodParam(params.get(PERIOD_PARAM))
  const wahlperiode = resolvePeriod(requested, options?.current)

  // Not skipped merely because the period is unresolved — also skipped when the
  // period is one this deployment has not ingested, so the "not backfilled"
  // branch below does not sit above an empty-array query that is perfectly
  // correct and says nothing.
  const skip = typeof wahlperiode !== "number" || periodIngested(wahlperiode, options) === false
  const rows = useQuery(api.mps.getMPsWithScores, skip ? "skip" : { wahlperiode })

  if (wahlperiode === undefined) return <RosterSkeleton label={t("common.loading")} />

  if (wahlperiode === null) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("common.empty")}
      </p>
    )
  }

  // A well-formed URL naming a period nobody has backfilled. Distinct from an
  // empty roster and from a 404 — see the long note in components/period-scope.tsx.
  if (periodIngested(wahlperiode, options) === false) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border border-dashed px-6 py-12 text-center">
        <div className="flex flex-col gap-2">
          <p className="font-medium">{t("period.notLoaded", { wahlperiode })}</p>
          <p className="mx-auto max-w-md text-muted-foreground text-sm leading-relaxed">
            {t("period.notLoadedHint")}
          </p>
        </div>
        <PeriodSelector wahlperiode={wahlperiode} className="mt-1" />
      </div>
    )
  }

  return (
    // So every row's profile link carries this period — the roster is the
    // single biggest source of MP links on the site, and a WP19 roster whose
    // names opened WP21 profiles would be the period loss at its most visible.
    <PeriodProvider wahlperiode={wahlperiode} current={options?.current}>
      <div className="flex flex-col gap-6">
        <PeriodSelector wahlperiode={wahlperiode} />
        <HistoricalPeriodNotice wahlperiode={wahlperiode} options={options} />
        {rows === undefined ? (
          <RosterSkeleton label={t("common.loading")} />
        ) : (
          <MPTable rows={rows} wahlperiode={wahlperiode} />
        )}
      </div>
    </PeriodProvider>
  )
}

/**
 * The roster's loading state.
 *
 * Roughly the table's own proportions — a filter row and a run of rows — so the
 * page does not jump when 630 members arrive. `output` with `aria-live` and an
 * `sr-only` label, matching every other loading state on the site: the shimmer
 * is invisible to a screen reader, so the word "loading" is what stands in for
 * it.
 */
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"] as const

function RosterSkeleton({ label }: { label: string }) {
  return (
    <output className="flex flex-col gap-4" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-24 w-full rounded-lg" />
      {/* Six, not thirty: enough to read as a list without drawing a page of
          grey that then has to be replaced.

          Keyed by a literal rather than the index, because these rows are
          interchangeable placeholders with no identity — an index key is the
          thing `noArrayIndexKey` exists to catch on a *reordering* list, and a
          fixed array of six is neither reordered nor reconciled against
          anything. Naming them makes that explicit instead of suppressing the
          rule. */}
      {SKELETON_ROWS.map((row) => (
        <Skeleton key={row} className="h-12 w-full rounded-md" />
      ))}
    </output>
  )
}
