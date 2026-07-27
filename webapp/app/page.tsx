"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { ActivityFeedPreview, LatestVotes, SummaryStats, TopMPs } from "@/components/home-sections"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"

/**
 * The home page.
 *
 * A client component, which is the exception AGENTS.md's "server components by
 * default" allows rather than an oversight. The language toggle is client state
 * (`LocaleProvider`), so every translated string is client-rendered regardless;
 * and the server-rendering that matters is not lost by saying `"use client"` —
 * Next still SSRs these on the first request, and `LocaleProvider` is seeded
 * from the `Accept-Language` header in app/layout.tsx, so the first paint is
 * already in the reader's language. What `"use client"` costs is bundle weight,
 * not indexable HTML.
 *
 * The alternative — `preloadQuery` in a server component — would block every
 * request on an uncached round-trip to Convex and turn an unreachable
 * deployment into a 500 for the whole page. `useQuery` degrades to a skeleton
 * and then to an empty state instead, and it subscribes, so the feed updates as
 * the nightly sweep lands rather than at the next deploy.
 *
 * Every public Convex query takes `wahlperiode`, so the page resolves that
 * first and the sections skip until it arrives. It is read from the data rather
 * than hardcoded — see `mps.getCurrentWahlperiode`.
 */
export default function Home() {
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Hero />

      {/* Null — as opposed to undefined — means the query resolved and the
          roster is empty: nothing has been ingested yet. That is one decision,
          made once, using the signal `getCurrentWahlperiode` already defines.
          Rendering the sections anyway would put four zeros on the page, which
          reads as "this Bundestag did nothing" rather than "no data loaded". */}
      {wahlperiode === null ? (
        <NothingIngestedYet />
      ) : (
        // `minmax(0,1fr)` rather than a bare implicit column: a grid item's
        // `min-width` is `auto`, so a single-column track sizes itself to its
        // widest content instead of to the viewport. The stats row's four cards
        // are `grid-cols-2` at this width and their intrinsic width won, which
        // pushed the whole home page to 534 px inside a 375 px viewport.
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12">
          <SummaryStats wahlperiode={wahlperiode} />
          <TopMPs wahlperiode={wahlperiode} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
            <LatestVotes wahlperiode={wahlperiode} />
            <ActivityFeedPreview wahlperiode={wahlperiode} />
          </div>
        </div>
      )}
    </main>
  )
}

function Hero() {
  const { t } = useLocale()

  return (
    <section className="relative isolate">
      {/* A soft radial wash behind the title — the one decorative element on
          the page. `aria-hidden` and pointer-events-none so it is invisible to
          assistive tech and cannot swallow a click. */}
      <div
        aria-hidden
        className="-z-10 -translate-x-1/2 pointer-events-none absolute top-[-8rem] left-1/2 h-[24rem] w-[48rem] max-w-[110vw] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklch, var(--chart-3) 28%, transparent), transparent)",
        }}
      />

      <div className="grid max-w-3xl gap-5">
        <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">{t("app.name")}</h1>
        <p className="text-balance text-lg text-muted-foreground sm:text-xl">{t("app.tagline")}</p>
        <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
          {t("home.heroLead")}
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href="/abgeordnete">
              {t("home.browseAllMPs")}
              <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/rangliste">{t("home.viewRankings")}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

/**
 * Shown when the roster is empty — currently every deployment, since the Python
 * pipeline's load stage is not implemented yet (`pipeline/.../cli.py`).
 *
 * Says what is true: the site works and is waiting for data. The failure this
 * avoids is a page of confident zeros, which is the same mistake this codebase
 * refuses everywhere else — `mpLabel` showing an id rather than a blank name,
 * `bucketFor` keeping an `other` bucket, `voteParticipationRate` distinguishing
 * "0 %" from "no votes".
 */
function NothingIngestedYet() {
  const { t } = useLocale()

  return (
    <section className="mt-12 rounded-xl border border-border/60 border-dashed px-6 py-16 text-center">
      <p className="font-medium">{t("common.noData")}</p>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
        {t("common.noDataHint")}
      </p>
    </section>
  )
}
