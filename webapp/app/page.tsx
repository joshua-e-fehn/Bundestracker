"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { HeroAnimationFallback, HeroAnimationSlot } from "@/components/hero-animation"
import {
  ActivityFeedPreview,
  BottomMPs,
  LatestVotes,
  PartyComparisonPreview,
  SummaryStats,
  TopMPs,
} from "@/components/home-sections"
import { useLocale } from "@/components/providers/locale-provider"
import { SeatingPreview } from "@/components/seating-preview"
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
      <Hero wahlperiode={wahlperiode} />

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
          {/* The two ends of the same ranking, side by side from `lg` and
              stacked below it — the same two-column shape the votes/feed row
              below already uses, so the page has one answer to "two sections
              of equal weight" rather than two.

              Most active is first in source order, which is both the left
              column and what a screen reader and a phone reach first. That
              ordering is deliberate: the ascending board carries a caveat
              (see `BottomMPs`) that reads as a qualification of the board
              above it, and a qualification should not arrive before the thing
              it qualifies. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
            <TopMPs wahlperiode={wahlperiode} />
            <BottomMPs wahlperiode={wahlperiode} />
          </div>
          {/* The Fraktionen beside the latest ballots — the same two-column
              shape as the rows above, and the pairing is deliberate: both are
              chamber-level views, where the two boards above are about
              individuals. The party card is first in source order, so a phone
              and a screen reader reach the summary before the ballot list. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
            <PartyComparisonPreview wahlperiode={wahlperiode} />
            <LatestVotes wahlperiode={wahlperiode} />
          </div>
          <ActivityFeedPreview wahlperiode={wahlperiode} />
        </div>
      )}
    </main>
  )
}

/**
 * The hero: the pitch on the left, the chamber on the right.
 *
 * Two columns from `lg` up and stacked below it, with the arc *second* in source
 * order so a narrow screen and a screen reader both get the headline and the
 * calls to action before the picture. The text column is capped at `max-w-2xl`
 * rather than left to fill its track: a 1 100 px line of body copy is hard to
 * read, and that cap is what created the empty top-right corner this card now
 * occupies.
 *
 * `minmax(0,1fr)` on the text track for the reason app/page.tsx's own grid uses
 * it — a grid item's `min-width` is `auto`, so an intrinsically wide child
 * (here the button row) otherwise pushes the track past the viewport.
 */
function Hero({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t } = useLocale()

  return (
    <section className="relative isolate">
      {/* A soft radial wash behind the title — the one decorative element on
          the page. `aria-hidden` and pointer-events-none so it is invisible to
          assistive tech and cannot swallow a click.

          `max-w-full` rather than `max-w-[110vw]`: the wash is centred on the
          section and 110 vw is by definition wider than the viewport, so its
          right edge sat 16–21 px past it and the *whole document* scrolled
          sideways — decoration cannot be allowed to do that. `overflow-hidden`
          on the section would clip it instead, but it would also clip the
          Select popovers the filters open. Sizing it to fit is the fix that
          costs nothing: at 320 px the gradient is a touch narrower and, being
          a `closest-side` radial behind a blur, indistinguishable. */}
      <div
        aria-hidden
        className="gold-wash -z-10 -translate-x-1/2 pointer-events-none absolute top-[-8rem] left-1/2 h-[24rem] w-[48rem] max-w-full rounded-full opacity-60 blur-3xl"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
        <div className="grid max-w-2xl gap-5">
          {/* The crest, above the headline rather than beside it: the text
              column is capped at `max-w-2xl` and already shares its row with
              the seating card, so a second column inside it would squeeze the
              headline at exactly the widths where the card is widest.

              `Suspense` is required, not decorative — `HeroAnimationSlot` reads
              `useSearchParams`, which opts its subtree out of static
              prerendering, and Next.js fails the *build* for a component that
              reads it without a boundary. app/search/page.tsx carries the same
              note. The fallback is the same fixed-height box the crest renders
              into, so nothing below it moves when the parameter resolves. */}
          <Suspense fallback={<HeroAnimationFallback />}>
            <HeroAnimationSlot />
          </Suspense>

          <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">{t("app.name")}</h1>
          <p className="text-balance text-lg text-muted-foreground sm:text-xl">
            {t("app.tagline")}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">{t("home.heroLead")}</p>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/mps">
                {t("home.browseAllMPs")}
                <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/rankings">{t("home.viewRankings")}</Link>
            </Button>
          </div>
        </div>

        <SeatingPreview wahlperiode={wahlperiode} />
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
