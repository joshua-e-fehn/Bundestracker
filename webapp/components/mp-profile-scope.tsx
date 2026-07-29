"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { MPProfile } from "@/components/mp-profile"
import { HistoricalPeriodNotice, PeriodSelector } from "@/components/period-selector"
import { useLocale } from "@/components/providers/locale-provider"
import { PeriodProvider } from "@/components/providers/period-provider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import {
  PERIOD_PARAM,
  parsePeriodParam,
  periodHref,
  periodIngested,
  periodLink,
  resolvePeriod,
} from "@/lib/period"

/**
 * The profile's period half: which mandate this page is about, and what to say
 * when the URL names one that does not exist.
 *
 * ## The three absences, which used to be one 404
 *
 * `app/mps/[id]/page.tsx` decided the whole question with a single server-side
 * `getMP` for `CURRENT_WAHLPERIODE`: null meant `notFound()`. That collapsed
 * three unrelated facts into one page, and the collapse was load-bearing rather
 * than cosmetic — an MP who sat only in WP19 got "not found" on a site holding
 * their complete WP19 record (`.logs/historical-backfill-final.md` §7).
 *
 *  - **The id names nobody.** A bad link. Still a real 404, still decided on
 *    the server, because it does not depend on the period — see that page.
 *  - **The period is not backfilled here.** `?wp=18` on a deployment holding
 *    WP19–21. The address is valid and the Bundestag sat; what is missing is a
 *    pipeline run. Says so, and offers the periods that exist.
 *  - **This person did not sit in this period.** The most interesting of the
 *    three, and the one with a genuinely useful answer: it can name the periods
 *    they *did* sit in and link straight to them. A reader who followed a WP21
 *    link to someone who left in WP20 is one click from the page they wanted.
 *
 * ## The selector offers this MP's mandates, not the site's periods
 *
 * `mps.getMPMandates` — documented in convex/mps.ts as "the profile page's
 * period switcher" and, until now, called by nothing. Offering the
 * deployment-wide list here would offer pages that do not exist for this
 * person; offering their mandates makes every option a real destination.
 *
 * ## Everything below stays in the chosen period
 *
 * `MPProfile` takes one `wahlperiode` and threads it to the committee card, the
 * score panel, the trend graphs and the recent-records panels, so a WP19
 * profile's subqueries are WP19 subqueries. That was already true — the profile
 * was never period-*mixing* — but it was only ever exercised at 21.
 */
export function MPProfileScope({
  internalId,
  today,
}: {
  internalId: string
  /** Stamped on the server so SSR and hydration cannot straddle midnight — see
   * the call site. */
  today: string
}) {
  const { t } = useLocale()
  const params = useSearchParams()
  const options = useQuery(api.mps.listPeriods, {})
  const mandates = useQuery(api.mps.getMPMandates, { internalId })

  const requested = parsePeriodParam(params.get(PERIOD_PARAM))
  const wahlperiode = resolvePeriod(requested, options?.current)

  const skip = typeof wahlperiode !== "number"
  const mp = useQuery(api.mps.getMP, skip ? "skip" : { internalId, wahlperiode })

  if (wahlperiode === undefined || mandates === undefined) return <ProfileSkeleton />

  if (wahlperiode === null) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("common.empty")}
      </p>
    )
  }

  // The periods this person actually sat in, in the shape `PeriodSelector`
  // wants. `mandates` is one row per mandate and already newest-first
  // (`getMPMandates` orders descending), so this is a projection rather than a
  // second sort.
  const servedPeriods = mandates.map((row) => ({ wahlperiode: row.wahlperiode, mandates: 1 }))

  if (mp === undefined) return <ProfileSkeleton />

  if (mp === null) {
    // Not backfilled beats did-not-sit when both are true: if the period holds
    // no roster at all, "this member did not sit in WP18" would be a claim
    // about the member drawn from the absence of everyone.
    if (periodIngested(wahlperiode, options) === false) {
      return (
        <PeriodAbsent
          wahlperiode={wahlperiode}
          titleKey="period.notLoaded"
          bodyKey="period.notLoadedHint"
          mandates={mandates}
          internalId={internalId}
          current={options?.current ?? null}
        />
      )
    }
    return (
      <PeriodAbsent
        wahlperiode={wahlperiode}
        titleKey="mp.notInPeriod"
        bodyKey="mp.notInPeriodHint"
        mandates={mandates}
        internalId={internalId}
        current={options?.current ?? null}
      />
    )
  }

  return (
    // The profile links onward too — to its Fraktion's page, and to whatever a
    // future panel adds — and those must stay in the period the profile is
    // showing.
    <PeriodProvider wahlperiode={wahlperiode} current={options?.current}>
      <div className="flex flex-col gap-6">
        <PeriodSelector
          wahlperiode={wahlperiode}
          periods={servedPeriods}
          // The period travels *with* the person: switching to WP19 on this
          // profile goes to this MP's WP19 profile. The default builder would
          // rewrite `wp` on the current path, which is the same URL here — but
          // spelling it out keeps the profile's links going through `periodLink`
          // like every other link out of a period-scoped page, so a future
          // parameter on this route cannot ride along into a switch.
          hrefFor={(next) =>
            periodHref(`/mps/${encodeURIComponent(internalId)}`, next, {
              current: options?.current ?? null,
            })
          }
        />
        <HistoricalPeriodNotice wahlperiode={wahlperiode} options={options} />
        <MPProfile mp={mp} wahlperiode={wahlperiode} today={today} current={options?.current} />
      </div>
    </PeriodProvider>
  )
}

/**
 * This person has no mandate in the period the URL names — either because the
 * period is not loaded, or because they did not sit in it.
 *
 * One component for both because the *shape* of the honest answer is identical:
 * say which it is, then offer the periods this person does have. Only the two
 * sentences differ, so they are the parameters.
 *
 * The links are the substance. A reader who arrived here followed a link, and
 * the useful thing is not an apology — it is the WP19 profile of the person
 * whose WP21 profile they asked for.
 */
function PeriodAbsent({
  wahlperiode,
  titleKey,
  bodyKey,
  mandates,
  internalId,
  current,
}: {
  wahlperiode: number
  titleKey: "period.notLoaded" | "mp.notInPeriod"
  bodyKey: "period.notLoadedHint" | "mp.notInPeriodHint"
  mandates: readonly { wahlperiode: number; name: string }[]
  internalId: string
  current: number | null
}) {
  const { t } = useLocale()
  const pathname = usePathname()
  const name = mandates[0]?.name

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-lg border border-border border-dashed px-6 py-14 text-center">
      <div className="flex flex-col gap-2">
        <p className="font-medium">
          {/* The person's name, where the mandate list knows it. "Martin
              Hohmann sat in no WP21 Bundestag" is an answer; "this member did
              not sit" on a page with no name on it is a shrug. */}
          {name ? t("mp.notInPeriodNamed", { name, wahlperiode }) : t(titleKey, { wahlperiode })}
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">{t(bodyKey)}</p>
      </div>

      {mandates.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-muted-foreground text-xs">{t("mp.availablePeriods")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {mandates.map((row) => (
              <Button key={row.wahlperiode} asChild variant="outline" size="sm">
                <Link
                  href={periodLink(
                    `/mps/${encodeURIComponent(internalId)}`,
                    row.wahlperiode,
                    current,
                  )}
                >
                  {t("period.option", { wahlperiode: row.wahlperiode })}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Back to the roster *of the period being looked at*, not of the current
          one — a reader who asked for WP19 and landed here should return to
          WP19's roster. `pathname` is this profile's path, so the roster link is
          built rather than rewritten. */}
      <Link
        href={periodLink("/mps", wahlperiode, current)}
        className="text-muted-foreground text-sm hover:text-foreground hover:underline"
        // `pathname` is read so a future nested route under /mps/[id] cannot
        // silently make this link point at its own parent instead of the list.
        data-from={pathname}
      >
        ← {t("mp.backToList")}
      </Link>
    </div>
  )
}

/** The profile's loading state — the sidebar-and-column shape the page settles
 * into, so nothing jumps when the mandate arrives. */
function ProfileSkeleton() {
  const { t } = useLocale()
  return (
    <output className="flex flex-col gap-6" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </output>
  )
}
