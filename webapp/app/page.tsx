"use client"

import { useQuery } from "convex/react"
import { ArrowDownIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useRef } from "react"
import { BrandMark } from "@/components/brand-mark"
import { Chapter } from "@/components/home-protokoll/chapter"
import { ChapterBoards, ChapterToday } from "@/components/home-protokoll/chapter-boards"
import { ChapterChamber } from "@/components/home-protokoll/chapter-chamber"
import { ChapterMeasure } from "@/components/home-protokoll/chapter-measure"
import { ChapterPublic } from "@/components/home-protokoll/chapter-public"
import { ProtokollBackdrop } from "@/components/home-protokoll/protokoll-backdrop"
import { ProtokollSplash } from "@/components/home-protokoll/protokoll-splash"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
<<<<<<< HEAD
import { formatCount } from "@/lib/format"
=======
import { CHAPTERS, DATA_ANCHOR } from "@/lib/protokoll"
>>>>>>> refine-homepage

/**
 * `/` — the home page: what Bundestracker is for, told in five chapters.
 *
 * Concept A of the homepage redesign, promoted from `/home-a` after being
 * compared against the two alternatives on real data. The dashboard this route
 * used to hold now lives at `/dashboard`, unchanged and linked from the header
 * and footer of every page; concepts B and C are deleted. Everything shared
 * between the two pages is *shared* rather than copied — the same Convex
 * queries, the same section components (components/home-sections.tsx), the same
 * arc geometry (lib/seating.ts), the same `home.*` strings and the same
 * caveats.
 *
 * ## What the page argues
 *
 * Five chapters, each a question a first-time reader has: what is this (the
 * chamber assembles), why does this site exist (published is not the same as
 * accessible), what does it measure (the seven score components, and their
 * three limits), who is active (both ends of the leaderboard), and where things
 * stand today (ballots and the feed). One gold accent, a hairline rule per
 * chapter, and generous whitespace. Serenity from restraint and rhythm rather
 * than from decoration.
 *
 * The subject is *Bundestracker*, not the Bundestag's Protokoll — the strings
 * opened as an essay about a parliament that publishes its own work, which left
 * the home page of this site never saying what this site is for. lib/i18n.ts
 * carries the full note at the `protokoll.*` block, whose keys keep that prefix
 * because `home.*` is the dashboard's namespace and both pages now exist.
 *
 * ## It is still a dashboard
 *
 * §7 of the research names this the requirement most likely to be quietly lost,
 * and promoting this page to `/` is exactly the moment it would be — the
 * returning reader who wants today's ballots now lands here by default. So it
 * is stated as the page's contract rather than left to the components:
 *
 *  1. **A skip affordance above the fold** — "Direkt zu den Daten" beside the
 *     primary call to action, jumping to Chapter 2. Not a modal, not a stored
 *     preference, just a link. The header's "Dashboard" entry is the other half
 *     of that answer, and the one that works from every other page.
 *  2. **No section loses information to the story.** Every stat, both boards,
 *     the party card, the ballots and the feed render the same data with the
 *     same caveats they carry on `/dashboard`.
 *  3. **Data is never gated on animation.** Each section renders its real
 *     content at its final position with every animation removed — which is
 *     literally what a reduced-motion reader gets, since `useReveal` returns
 *     the revealed state immediately for them.
 *
 *     ⚠ That is a promise about *content*, not only about motion, and it is the
 *     one this page has already broken once. `useReveal` drives `opacity: 0`
 *     targets, so a section that never reveals is not a missing flourish but
 *     invisible data — and its first implementation could not reveal anything
 *     the reader had scrolled *past*, which meant reloading mid-page left the
 *     four headline figures reading "0". See that hook for the measurement.
 *  4. **The caveats are in the narrative, not below it.** Chapter 1 states what
 *     the seating picture is not; Chapter 3's conclusion *is* the score's three
 *     structural limits.
 *
 * ## Why this is a client component
 *
 * app/dashboard/page.tsx's reasons, unchanged: the language toggle is client
 * state, so every translated string is client-rendered regardless, and
 * `useQuery` degrades to a skeleton where `preloadQuery` would turn an
 * unreachable Convex deployment into a 500 for the whole page. Everything
 * scroll-driven here needs the browser anyway.
 *
 * ⚠ **No section is pinned to a scroll offset computed at mount.** Every
 * section resolves a Convex query and changes height when it lands, so the
 * choreography uses `position: sticky` and `IntersectionObserver`, both of
 * which re-measure. This is §8's stated "most likely source of subtle bugs in
 * this whole project" and the one invariant to keep when editing this page.
 */
export default function Home() {
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)
  // The article, not the document: the gutter rail should fill as the *record*
  // ends rather than as the footer's legal notice does.
  const record = useRef<HTMLDivElement>(null)

  return (
    <>
      <ProtokollSplash />
      <ProtokollBackdrop target={record} />

      <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <Opening />

        {wahlperiode === null ? (
          <NothingIngestedYet />
        ) : (
          // `gap-28` rather than the dashboard's `gap-12`: the chapters are
          // chapters, and the whitespace between them is what makes each one
          // arrive on its own rather than as the next row of a grid. Every
          // chapter also carries its own rule at the top, so the gap is the
          // page's rhythm and not merely a separator.
          <div ref={record} className="mt-28 grid grid-cols-[minmax(0,1fr)] gap-28">
            <Chapter chapter={CHAPTERS[0]}>
              <ChapterChamber wahlperiode={wahlperiode} />
            </Chapter>
            <Chapter chapter={CHAPTERS[1]}>
              <ChapterPublic wahlperiode={wahlperiode} />
            </Chapter>
            <Chapter chapter={CHAPTERS[2]}>
              <ChapterMeasure />
            </Chapter>
            <Chapter chapter={CHAPTERS[3]}>
              <ChapterBoards wahlperiode={wahlperiode} />
            </Chapter>
            <Chapter chapter={CHAPTERS[4]}>
              <ChapterToday wahlperiode={wahlperiode} />
            </Chapter>

            <Outro />
          </div>
<<<<<<< HEAD
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
          <InquiryQuorumTeaser wahlperiode={wahlperiode} />
        </div>
      )}
    </main>
=======
        )}
      </main>
    </>
>>>>>>> refine-homepage
  )
}

/**
 * The title page: the mark, the site's name, what the page is about to do, and
 * the two ways out of it.
 *
 * Deliberately not the current home page's hero. There is no seating card
 * beside it — Chapter 1 *is* the seating card, at full width, and showing a
 * thumbnail of it two hundred pixels above would spend the reveal before it
 * happened. What is left is a title page, which is what a document opens with.
 *
 * Both calls to action are above the fold and the second is §7's requirement
 * #1. It is a plain anchor rather than a button styled as one, because it is a
 * jump within this page and not a navigation — and because `href="#…"` is what
 * makes it work before hydration and survive a middle-click.
 */
function Opening() {
  const { t } = useLocale()

  return (
    <header className="grid max-w-3xl gap-6">
      <BrandMark className="size-16 text-gold-brand" />

      <div className="grid gap-3">
        {/* The document's own title above the site's name, in the gold ink
            tier at small caps. This page is a *piece* published by
            Bundestracker, and the hierarchy says so. */}
        <p className="font-medium text-gold text-xs uppercase tracking-[0.25em]">
          {t("protokoll.title")}
        </p>
        <h1 className="font-semibold text-5xl tracking-tight sm:text-6xl">{t("app.name")}</h1>
      </div>

      <p className="text-balance text-muted-foreground text-xl leading-relaxed">
        {t("protokoll.lead")}
      </p>
      <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">{t("app.tagline")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button asChild size="lg">
          <Link href="/mps">
            {t("home.browseAllMPs")}
            <ArrowRightIcon />
          </Link>
        </Button>

        {/* The skip. Quiet — it is an escape hatch, not a competing call to
            action — but present on the first screen, which is the whole point:
            a returning reader who wants today's ballots must not have to
            scroll through a story they have read. */}
        <a
          href={`#${DATA_ANCHOR}`}
          className="flex items-center gap-1.5 rounded-md font-medium text-muted-foreground text-sm underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("protokoll.skipToData")}
          <ArrowDownIcon className="size-3.5" />
        </a>
      </div>
    </header>
  )
}

/**
 * The closing page: where the record continues.
 *
 * Ends on what the reader can do rather than on a summary of what they read.
 * Three destinations, which are the three shapes the data takes — the roster,
 * the ranking, the chamber.
 */
function Outro() {
  const { t } = useLocale()

  return (
    <section className="grid gap-6">
      <div aria-hidden className="h-px w-full bg-gold/25" />
      <div className="grid max-w-2xl gap-3">
        <h2 className="font-semibold text-2xl tracking-tight">{t("protokoll.outroTitle")}</h2>
        <p className="text-muted-foreground leading-relaxed">{t("protokoll.outroLead")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg">
          <Link href="/mps">
            {t("home.browseAllMPs")}
            <ArrowRightIcon />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/rankings">{t("home.viewRankings")}</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/seating">{t("home.seatingPreviewCta")}</Link>
        </Button>
      </div>
    </section>
  )
}

/**
<<<<<<< HEAD
 * The one card on this page that asks a question rather than ranking something.
 *
 * Every other section here is a view of the score — who is most active, which
 * Fraktion averages what. This is the same data answering a constitutional
 * question instead: whether a quarter of this Bundestag can compel a committee
 * of inquiry. It sits last because it is the page's one editorial destination
 * (the exclusion table on `/inquiry-quorum` is maintained, not sourced), and a
 * dashboard should lead with what it counted.
 *
 * Reads the quorum query rather than restating the numbers, so the headline here
 * and the page it links to cannot disagree about the threshold — the failure
 * `foldFractionSizes` and `coalitionRole` both exist to prevent. Renders nothing
 * until the figures resolve: a teaser with a blank number in mid-sentence is
 * worse than one that arrives a moment later.
 */
function InquiryQuorumTeaser({ wahlperiode }: { wahlperiode: number | undefined }) {
  const { t, locale } = useLocale()
  // `"skip"` until the period resolves, the convention every section in
  // components/home-sections.tsx follows: the page renders this branch while
  // `wahlperiode` is still in flight, and a query fired with `undefined` would
  // be a request for a Bundestag with no number.
  const quorum = useQuery(
    api.inquiry.getQuorum,
    wahlperiode === undefined ? "skip" : { wahlperiode },
  )

  if (quorum === undefined || quorum.totalSeats === 0) return null

  return (
    <section
      aria-labelledby="inquiry-teaser-heading"
      className="rounded-xl border border-gold/30 bg-gold/5 p-5 sm:p-6"
    >
      <h2 id="inquiry-teaser-heading" className="font-semibold text-lg tracking-tight sm:text-xl">
        {t("inquiry.home.title")}
      </h2>
      <p className="mt-2 max-w-prose text-muted-foreground text-sm leading-relaxed">
        {t("inquiry.home.body", {
          threshold: formatCount(quorum.threshold, locale),
          total: formatCount(quorum.totalSeats, locale),
        })}
      </p>
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href="/inquiry-quorum">
          {t("inquiry.home.cta")}
          <ArrowRightIcon />
        </Link>
      </Button>
    </section>
  )
}

/**
 * Shown when the roster is empty — currently every deployment, since the Python
 * pipeline's load stage is not implemented yet (`pipeline/.../cli.py`).
=======
 * Shown when the roster is empty — the current state of a fresh deployment,
 * before the pipeline's first run.
>>>>>>> refine-homepage
 *
 * The same decision app/page.tsx makes, and for the same reason: `null` (as
 * opposed to `undefined`) means the query resolved and there is nothing there,
 * and rendering five chapters over an empty database would put a narrative
 * around four zeros. That reads as "this Bundestag did nothing" rather than as
 * "no data loaded".
 */
function NothingIngestedYet() {
  const { t } = useLocale()

  return (
    <section className="mt-16 rounded-xl border border-border/60 border-dashed px-6 py-20 text-center">
      <p className="font-medium">{t("common.noData")}</p>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
        {t("common.noDataHint")}
      </p>
    </section>
  )
}
