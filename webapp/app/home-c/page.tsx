"use client"

import { useQuery } from "convex/react"
import { ArrowDownIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { HeroAnimationFallback, HeroAnimationSlot } from "@/components/hero-animation"
import { Chapter, ChapterCaveat } from "@/components/home-zahlen/chapter"
import { ClaimSentence } from "@/components/home-zahlen/claim-sentence"
import { NarrativeSummaryStats } from "@/components/home-zahlen/narrative-stats"
import { RuleSplash } from "@/components/home-zahlen/rule-splash"
import {
  ActivityFeedPreview,
  BottomMPs,
  LatestVotes,
  PartyComparisonPreview,
  TopMPs,
} from "@/components/home-sections"
import { useLocale } from "@/components/providers/locale-provider"
import { SeatingPreview } from "@/components/seating-preview"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"

/**
 * `/home-c` — the home page as a narrative: **Zahlen, die belegt sind.**
 *
 * Concept C of the homepage redesign research (`/tmp/homepage-design-research.md`
 * §4), built beside the live home page rather than over it. `/` is untouched;
 * this route is where the concept can be looked at on real data before anything
 * is decided.
 *
 * ## What is actually different from `/`
 *
 * Not the data. Every section below is the *same component* app/page.tsx renders
 * — `TopMPs`, `BottomMPs`, `PartyComparisonPreview`, `LatestVotes`,
 * `ActivityFeedPreview`, `SeatingPreview` — reading the same Convex queries.
 * §7's fourth defence is the rule this page is held to: no section may lose
 * information to the story. The narrative adds sentences around the data; it
 * does not replace it with prose.
 *
 * What changes is the *frame*. Each chapter is a claim, then the data, then the
 * caveat — and the caveats are the site's existing ones, promoted from footnotes
 * into the argument. That is the concept in one line: the story is epistemic.
 * Here is a number; here is the document behind it; here is what it does not
 * say.
 *
 * ## The one component this page does not share with `/`
 *
 * `NarrativeSummaryStats` replaces `SummaryStats`. It is a near-copy and the
 * copy is deliberate — see the note at the top of that file, which states what
 * it changes (four cards become four typographic figures that count up) and why
 * that could not be a prop on the original.
 *
 * ## No pinning, anywhere
 *
 * §4's Concept C says so and §9 gives the reason: a pinned section cannot be
 * scrolled into view by the browser when focus lands inside it, which breaks
 * keyboard navigation outright. Every effect here is reveal-on-scroll, and the
 * page works with every one of them removed.
 *
 * ## Why it is `"use client"`, and why that is not a regression
 *
 * The same reasons app/page.tsx gives at length: the language toggle is client
 * state, so every translated string is client-rendered regardless, and
 * `preloadQuery` would block the request on an uncached round-trip to Convex.
 * Next still server-renders this, so the HTML a crawler reads is complete — and
 * complete in the reader's language, since `LocaleProvider` is seeded from
 * `Accept-Language` in app/layout.tsx.
 *
 * That SSR is also what makes the motion safe. Every reveal here starts from an
 * *absent* `data-reveal` attribute, so server HTML and a browser whose
 * JavaScript failed both render the finished page (see `useRevealOnScroll`).
 * There is no state of this page in which the story hides the data.
 */
export default function HomeC() {
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)

  return (
    <>
      <RuleSplash />
      {/* Wider gutters and a much taller rhythm than app/page.tsx's `gap-12`.
          The vertical space *is* the design here — §2 of the research found
          that the government sites which look beautiful are the ones with a
          strong typographic scale and generous, consistent rhythm, not the ones
          with the most motion. */}
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <Hero wahlperiode={wahlperiode} />

        {/* Same signal as app/page.tsx, same decision, made once: `null` means
            the query resolved and the roster is empty. Rendering the chapters
            anyway would put five claims about evidence above no evidence. */}
        {wahlperiode === null ? (
          <NothingIngestedYet />
        ) : (
          <div id="data" className="mt-20 flex flex-col gap-24 sm:gap-28">
            <Chapter
              claimKey="homeC.claimStats"
              caveat={<ChapterCaveat textKey="home.statNamedVotesNote" />}
            >
              <NarrativeSummaryStats wahlperiode={wahlperiode} />
            </Chapter>

            {/* Both ends of the ranking under one claim, in the order
                app/page.tsx establishes and for its stated reason: the
                descending board first, because the ascending one's caveat
                qualifies it and a qualification must not precede what it
                qualifies. Here that ordering is stronger still — the chapter's
                caveat sits below *both*. */}
            <Chapter
              claimKey="homeC.claimActivity"
              caveat={<ChapterCaveat textKey="home.bottomMPsCaveat" />}
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
                <TopMPs wahlperiode={wahlperiode} />
                {/* The board's own caveat is suppressed because the chapter
                    below states the same sentence — promoting it from a
                    footnote into the argument is the concept. Without this the
                    reader gets `home.bottomMPsCaveat` twice, a few lines apart;
                    it rendered that way until the HTML was checked. */}
                <BottomMPs wahlperiode={wahlperiode} caveatShownByPage />
              </div>
            </Chapter>

            <Chapter
              claimKey="homeC.claimParties"
              caveat={<ChapterCaveat textKey="parties.smallGroupCaveat" />}
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
                {/* Same suppression as the board above, and the same reason:
                    `parties.smallGroupCaveat` is this chapter's closing
                    statement. */}
                <PartyComparisonPreview wahlperiode={wahlperiode} caveatShownByPage />
                <LatestVotes wahlperiode={wahlperiode} />
              </div>
            </Chapter>

            {/* The one chapter with no caveat. It reports what was published
                rather than measuring anything, and its claim sentence says so —
                a caveat here would be ceremony, and a page that attaches one to
                every section teaches the reader to stop reading them. */}
            <Chapter claimKey="homeC.claimFeed">
              <ActivityFeedPreview wahlperiode={wahlperiode} />
            </Chapter>
          </div>
        )}
      </main>
    </>
  )
}

/**
 * The hero: the claim, the pledge, the calls to action, the chamber.
 *
 * The headline is `app.name` and the tagline `app.tagline`, as on `/` — this
 * page is a redesign of the home page, not a different site. What is added is
 * the opening claim sentence, which is the first thing the word-brightening
 * touches and sets the register for the four below it.
 *
 * ## The skip link is §7's first defence and is not optional
 *
 * "Direkt zu den Daten" jumps past the narrative to `#data`. §7 opens by naming
 * the failure mode of every scrollytelling redesign — the returning reader who
 * wants today's votes has to scroll through a story they have read — and this
 * is the cheapest possible answer: a quiet anchor beside the primary call to
 * action. Not a modal, not a stored preference, just a link.
 *
 * It is a real `<a href="#data">`, so it works with JavaScript off, appears in
 * the tab order in its visual position, and the browser handles the scroll
 * (respecting `prefers-reduced-motion` natively, which a scripted
 * `scrollIntoView({behavior:"smooth"})` would not).
 */
function Hero({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { t } = useLocale()

  return (
    <section className="relative isolate">
      {/* The same radial wash the live hero carries, and sized the same way for
          the same reason — `max-w-full` rather than a `vw` width, because a
          decoration wider than the viewport scrolls the whole document
          sideways. See the note in app/page.tsx. */}
      <div
        aria-hidden
        className="-z-10 -translate-x-1/2 pointer-events-none absolute top-[-8rem] left-1/2 h-[24rem] w-[48rem] max-w-full rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklch, var(--chart-3) 28%, transparent), transparent)",
        }}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="grid max-w-2xl gap-6">
          {/* `Suspense` is required rather than decorative: `HeroAnimationSlot`
              reads `useSearchParams`, which opts its subtree out of static
              prerendering, and Next fails the *build* for a component that
              reads it without a boundary. app/page.tsx and app/search/page.tsx
              carry the same note. */}
          <Suspense fallback={<HeroAnimationFallback />}>
            <HeroAnimationSlot />
          </Suspense>

          <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">{t("app.name")}</h1>
          <p className="text-balance text-lg text-muted-foreground sm:text-xl">
            {t("app.tagline")}
          </p>

          {/* The opening claim, at the same size as the four chapter claims
              below — this is the first movement of the same sentence, not a
              standfirst. It carries no `id`: it opens the hero rather than
              naming a labelled region, and the `<h1>` above is already this
              section's accessible name. */}
          <ClaimSentence sentenceKey="homeC.claimIntro" className="mt-2" />

          <p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
            {t("homeC.heroPledge")}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button asChild size="lg">
              <Link href="/mps">
                {t("home.browseAllMPs")}
                <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/rankings">{t("home.viewRankings")}</Link>
            </Button>
            {/* Ghost rather than outline: three buttons of equal weight is no
                hierarchy at all, and this one is an escape hatch rather than a
                destination. A plain `<a>` — not `next/link` — because a
                same-page fragment is not a navigation, and routing one through
                the router pushes a history entry that makes the back button
                undo a scroll. */}
            <Button asChild variant="ghost" size="lg">
              <a href="#data">
                {t("homeC.skipToData")}
                <ArrowDownIcon />
              </a>
            </Button>
          </div>
        </div>

        {/* Second in source order, so a phone and a screen reader both reach
            the headline and the calls to action before the picture. */}
        <SeatingPreview wahlperiode={wahlperiode} />
      </div>
    </section>
  )
}

/**
 * Shown when the roster is empty — the state of a deployment whose pipeline has
 * not run.
 *
 * The same message as app/page.tsx rather than a narrative variant of it: this
 * page's argument is that every figure is backed by a record, and the honest
 * thing to say when there are no records is that there are none.
 */
function NothingIngestedYet() {
  const { t } = useLocale()

  return (
    <section className="mt-16 rounded-xl border border-border/60 border-dashed px-6 py-16 text-center">
      <p className="font-medium">{t("common.noData")}</p>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
        {t("common.noDataHint")}
      </p>
    </section>
  )
}
