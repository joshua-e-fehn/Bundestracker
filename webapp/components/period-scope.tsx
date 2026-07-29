"use client"

import { useQuery } from "convex/react"
import { useSearchParams } from "next/navigation"
import { HistoricalPeriodNotice, PeriodSelector } from "@/components/period-selector"
import { useLocale } from "@/components/providers/locale-provider"
import { PeriodProvider } from "@/components/providers/period-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { PERIOD_PARAM, parsePeriodParam, periodIngested, resolvePeriod } from "@/lib/period"

/**
 * Scopes a page to a Wahlperiode: reads it from the URL, offers the others, and
 * hands the resolved number to the component that renders the page.
 *
 * This replaces `CurrentPeriod`, which did the first half of the job — resolve
 * the newest period from the roster and pass it down — and made the second
 * impossible: the period was derived, so no URL could name a different one and
 * no control could switch to one. WP19 and WP20 were fully ingested and
 * unreachable from every page but `/search` (`docs/historical-coverage.md`).
 *
 * Everything `CurrentPeriod` explained about *how* it passes the period is
 * unchanged and still load-bearing, so it is restated here rather than left in
 * a deleted file:
 *
 * ## Why a component prop rather than a render prop
 *
 * The obvious shape — `children: (wahlperiode) => ReactNode` — fails at runtime
 * rather than at the typecheck. The pages above are **server** components, so
 * everything they pass crosses the server/client boundary and must be
 * serialisable; a function is not, and React reports *"Functions are not valid
 * as a child of Client Components"* when the page renders.
 *
 * So the boundary carries a component *reference*, which the bundler
 * serialises as a client-module pointer, and this component calls it.
 *
 * ## Why `props` exists
 *
 * Most consumers need nothing but the period. `/parties/[party]` needs the
 * period *and* the group its route names, and the two other ways to give it one
 * are worse: resolve the period a second time inside that page — a second
 * answer to "which Bundestag is this" — or wrap this in a closure, which is the
 * exact thing the paragraph above cannot cross the boundary. So the extra props
 * ride along, serialised like any other prop, and must themselves be
 * serialisable for the same reason.
 *
 * ## The three states below are three different facts
 *
 *  - **Loading** — the period list has not resolved. A skeleton.
 *  - **Nothing ingested** — the roster is empty and the URL named no period.
 *    A fresh deployment before its first pipeline run; not an error, and not
 *    period zero.
 *  - **Period not ingested** — the URL names a real Wahlperiode that this
 *    deployment has not backfilled. Distinct from both of the above and from a
 *    404: the URL is well-formed, the Bundestag existed, and the fix is running
 *    a backfill rather than correcting a link. This is the state the acceptance
 *    criteria call "not-yet-backfilled", and it renders the list of periods
 *    that *are* available rather than an empty page.
 */
export function PeriodScope<Extra extends Record<string, unknown> = Record<string, never>>({
  component: Component,
  props,
  /** Hides the dropdown where the page renders its own — `/search` puts the
   * period beside its other filters rather than above the results, and two
   * controls for one thing is the failure `NAV_SHEET_ONLY` already was. */
  hideSelector = false,
}: {
  component: React.ComponentType<Extra & { wahlperiode: number }>
  /** Extra props for `component`, merged with the resolved period. Must be
   * serialisable — see the note above. */
  props?: Extra
  hideSelector?: boolean
}) {
  const { t } = useLocale()
  const params = useSearchParams()
  const options = useQuery(api.mps.listPeriods, {})

  const requested = parsePeriodParam(params.get(PERIOD_PARAM))
  const wahlperiode = resolvePeriod(requested, options?.current)

  if (wahlperiode === undefined) {
    return (
      <output className="flex flex-col gap-2" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </output>
    )
  }

  if (wahlperiode === null) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("common.empty")}
      </p>
    )
  }

  // `undefined` while the list is in flight *and* the URL named a period — the
  // page can already render at that period, so this only gates the "not
  // backfilled" message, which must not appear before there is a list to check
  // against. `false` is the real answer.
  if (periodIngested(wahlperiode, options) === false) {
    return <PeriodNotIngested wahlperiode={wahlperiode} options={options} />
  }

  return (
    // Every link *inside* the page inherits its period — see
    // components/providers/period-provider.tsx. This is what stops a name on
    // the WP19 rankings from opening a WP21 profile, and it does so for links
    // that do not exist yet as well as the ones that do.
    <PeriodProvider wahlperiode={wahlperiode} current={options?.current}>
      <div className="flex flex-col gap-6">
        {hideSelector ? null : <PeriodSelector wahlperiode={wahlperiode} />}
        <HistoricalPeriodNotice wahlperiode={wahlperiode} options={options} />
        {/* The cast is the price of being generic over `Extra`: the spread
            produces exactly `Extra & { wahlperiode: number }`, which is the
            signature, but TypeScript cannot prove that for an unresolved type
            parameter. */}
        <Component {...({ ...props, wahlperiode } as Extra & { wahlperiode: number })} />
      </div>
    </PeriodProvider>
  )
}

/**
 * A well-formed URL naming a period this deployment has not loaded.
 *
 * ## Why this is not a 404
 *
 * `/mps?wp=18` is a correct address for a Bundestag that sat. Answering it with
 * "not found" tells the reader their link is wrong, which is a claim about
 * *them*; the truth is a claim about this deployment — the backfill for that
 * period has not run. `docs/historical-coverage.md` records WP18–WP14 as
 * pending precisely because they are, so this state is the normal condition of
 * half the tracked range rather than an edge case.
 *
 * ## Why it offers the periods that do exist
 *
 * An honest dead end still has to be a way forward. A reader who typed a period
 * by hand, or followed a link from a period-scoped page that has since been
 * partly reloaded, needs to know what they *can* look at — and the alternative
 * is a paragraph and a back button.
 *
 * Nothing here fabricates a count or a date for the missing period. It says the
 * period is not loaded and lists the ones that are, which is the whole of what
 * is known.
 */
function PeriodNotIngested({
  wahlperiode,
  options,
}: {
  wahlperiode: number
  options: { periods: readonly { wahlperiode: number }[]; current: number | null } | undefined
}) {
  const { t } = useLocale()

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border border-dashed px-6 py-12 text-center">
      <div className="flex flex-col gap-2">
        <p className="font-medium">{t("period.notLoaded", { wahlperiode })}</p>
        <p className="mx-auto max-w-md text-muted-foreground text-sm leading-relaxed">
          {t("period.notLoadedHint")}
        </p>
      </div>
      {/* The selector, as the way out. It is the same control the page would
          have carried, so a reader recovers with the gesture they would have
          used anyway rather than learning a second one for the error state. */}
      {options === undefined ? null : <PeriodSelector wahlperiode={wahlperiode} className="mt-1" />}
    </div>
  )
}
