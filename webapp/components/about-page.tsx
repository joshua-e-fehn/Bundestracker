"use client"

import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { SCORE_COMPONENT_LABELS } from "@/components/score-breakdown"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNumber } from "@/lib/bundestag"
import type { TranslationKey } from "@/lib/i18n"
import { ABGEORDNETENWATCH_URL, BUNDESTAG_OPEN_DATA_URL, DIP_URL, REPO_URL } from "@/lib/links"
import { DEFAULT_WEIGHTS, SCORE_COMPONENTS, type ScoreComponent } from "@/lib/scoring"
import { cn } from "@/lib/utils"

/**
 * The methodology page's body — see the header of app/about/page.tsx for why
 * this page exists at all when the caveats are already beside every figure.
 *
 * A client component because it is entirely translated and the language toggle
 * is client state (lib/i18n.ts). It subscribes to nothing: the score list is
 * built from `SCORE_COMPONENTS` and `DEFAULT_WEIGHTS`, so the page cannot
 * disagree with the scoring it describes — adding an eighth component to
 * lib/scoring.ts adds a row here, and a weight changed there changes the number
 * printed here in the same commit.
 *
 * ## Reused strings, not restated ones
 *
 * The sections below pull `home.bottomMPsCaveat`, `votes.namedOnlyNotice`,
 * `parties.disciplineCaveat`, `seating.syntheticNotice` and the `score.caveat.*`
 * trio straight from the dictionary rather than paraphrasing them. That is the
 * point of the page: a reader who met one of those beside a chart should meet
 * the *same sentence* here, not a near-miss that raises the question of which
 * version is current.
 */

// --- shared section furniture ---------------------------------------------

/**
 * One numbered section, with the id its contents-list entry links to.
 *
 * Deliberately not `components/section-heading.tsx`. That one is an `h2` with an
 * optional "show all" button, sized for a home-page card and spaced by its
 * caller's grid; this is a landmark with an anchor and a rule above it, and the
 * two would fight over margins. The heading levels match — both are `h2` under
 * the page's single `h1` — so the document outline is the same either way.
 *
 * `scroll-mt` because the header is sticky: without it an in-page jump lands
 * with the heading underneath the bar.
 */
function Section({
  id,
  titleKey,
  children,
}: {
  id: string
  titleKey: TranslationKey
  children: React.ReactNode
}) {
  const { t } = useLocale()
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <h2
        id={`${id}-heading`}
        className="border-border/60 border-b pb-2 font-semibold text-2xl tracking-tight"
      >
        {t(titleKey)}
      </h2>
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  )
}

/** Body copy. `max-w-prose` caps the measure independently of the container, so
 * a paragraph stays readable even where the definition list beside it runs the
 * full width of the page. */
function Prose({ children }: { children: React.ReactNode }) {
  return <p className="max-w-prose text-sm leading-relaxed">{children}</p>
}

/**
 * A titled point inside a section — one of the four blind spots, one principle,
 * one privacy commitment.
 *
 * A `Card` rather than a bare heading and paragraph: these lists are the parts
 * of the page a reader skims for the one item they came for, and a card gives
 * each a boundary to skim by. `size="sm"` keeps a run of five from becoming a
 * page of its own.
 */
function Point({ titleKey, bodyKey }: { titleKey: TranslationKey; bodyKey: TranslationKey }) {
  const { t } = useLocale()
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground leading-relaxed">{t(bodyKey)}</CardContent>
    </Card>
  )
}

/**
 * A term and its explanation — the page's three reference lists.
 *
 * ## Why this is not a `<table>`
 *
 * It was, and the tables did not survive a phone. Measured at 375 px: the score
 * table's content floor was 508 px against a 343 px container, so it scrolled
 * sideways with the weight column off-screen — on the one page whose argument
 * *is* that the weights are visible. The cause is not fixable by wrapping
 * headers or trimming padding, which were both tried: a table column is at
 * least as wide as its longest unbreakable word, and the explanations here are
 * German prose full of compounds like "Ausschussmitgliedschaften". Three text
 * columns each carrying a min-content floor cannot fit 343 px, whatever the
 * cells are told to do.
 *
 * A description list has no such coupling. The term sits above its explanation
 * below `sm` and beside it above, so nothing overflows at any width and the
 * numeric column is never the one pushed off the edge.
 *
 * It is also the more accurate markup. A `<table>` claims its rows and columns
 * are a grid a reader may cross-reference — which is true of the ballot and
 * ranking tables elsewhere on this site, where you compare one MP's figure with
 * another's. Nothing here is comparable in that way: these are seven
 * definitions, five sources and five coverage boundaries, each read on its own.
 * `<dl>` says exactly that, and a screen reader announces the pairing rather
 * than a column position.
 *
 * `aside` is the optional third value — the score table's weight, the coverage
 * table's date. It renders as a right-aligned chip above `sm` and under the term
 * below it, so it is always adjacent to what it qualifies.
 */
function DefinitionList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <dl
      className={cn("flex flex-col divide-y divide-border/60 border-border/60 border-y", className)}
    >
      {children}
    </dl>
  )
}

function Definition({
  term,
  aside,
  children,
}: {
  term: React.ReactNode
  /** A short qualifier — a weight, a date. Kept out of the description so it
   * stays legible as a figure rather than becoming the first words of a
   * sentence. */
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    // `sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]` rather than two equal
    // tracks: the terms are two or three words and the descriptions are
    // sentences, so an even split would leave the left column half empty at
    // every width. `minmax(0,…)` on both because a grid item's `min-width` is
    // `auto` — the same trap app/page.tsx documents, and the one that would let
    // a long compound push this grid past its container.
    <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <dt className="flex flex-wrap items-baseline justify-between gap-x-3 font-medium text-sm">
        <span>{term}</span>
        {aside !== undefined ? (
          <span className="text-muted-foreground text-xs tabular-nums">{aside}</span>
        ) : null}
      </dt>
      <dd className="text-muted-foreground text-sm leading-relaxed">{children}</dd>
    </div>
  )
}

/** An outbound link, marked as one. The icon is `aria-hidden` — "opens in a new
 * tab" is carried by `target`, and an announced "external link" per item would
 * be read four times in the sources list. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 rounded-md font-medium underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  )
}

// --- the contents list ----------------------------------------------------

/**
 * The sections, in order — the single list the jump links and the page itself
 * are both built from.
 *
 * One array rather than a hand-written table of contents beside hand-written
 * sections: that pairing is how a contents entry comes to point at an anchor
 * that was renamed, which is a broken link that no typecheck and no test would
 * catch. Here a section cannot exist without its entry, because `Section` is
 * called with the same `id` this list holds.
 */
const SECTIONS: ReadonlyArray<{ id: string; titleKey: TranslationKey }> = [
  { id: "tracks", titleKey: "about.tracks.title" },
  { id: "limits", titleKey: "about.limits.title" },
  { id: "sources", titleKey: "about.sources.title" },
  { id: "coverage", titleKey: "about.coverage.title" },
  { id: "dissent", titleKey: "about.dissent.title" },
  { id: "principles", titleKey: "about.principles.title" },
  { id: "privacy", titleKey: "about.privacy.title" },
]

function Contents() {
  const { t } = useLocale()
  return (
    <nav
      aria-labelledby="about-contents-heading"
      className="rounded-lg border border-border/60 p-4"
    >
      <h2
        id="about-contents-heading"
        className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
      >
        {t("about.contents")}
      </h2>
      {/* A wrapping row rather than a stacked list: seven short labels are a
          strip on a laptop and three lines on a phone, where a `<ul>` of seven
          rows would push the page's first real sentence below the fold. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {SECTIONS.map(({ id, titleKey }, index) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="rounded-md text-sm underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* Numbered so the strip reads as an ordered list of sections
                  even when it wraps mid-row and the visual order is ambiguous.
                  `tabular-nums` keeps the numerals from shifting the labels. */}
              <span className="mr-1.5 text-muted-foreground tabular-nums">{index + 1}</span>
              {t(titleKey)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// --- 1. what is counted ---------------------------------------------------

/** What each component measures, in the reader's words rather than the
 * schema's. `Record<ScoreComponent, …>` for the reason `SCORE_COMPONENT_LABELS`
 * uses one: a component added to `SCORE_COMPONENTS` is a type error here until
 * this page explains it, which is the only mechanism that keeps a methodology
 * page from silently going out of date. */
const COMPONENT_DESCRIPTIONS: Record<ScoreComponent, TranslationKey> = {
  motions: "about.tracks.measures.motions",
  speeches: "about.tracks.measures.speeches",
  questions: "about.tracks.measures.questions",
  reports: "about.tracks.measures.reports",
  voteParticipation: "about.tracks.measures.voteParticipation",
  committees: "about.tracks.measures.committees",
  billSponsorships: "about.tracks.measures.billSponsorships",
}

function WhatIsCounted() {
  const { t, locale } = useLocale()

  return (
    <Section id="tracks" titleKey="about.tracks.title">
      <Prose>{t("about.tracks.body")}</Prose>

      {/* The column headings, carried above the list rather than as a `<thead>`
          — see `DefinitionList` for why this is not a table. They are hidden
          below `sm`, where the list is stacked and a two-column heading would
          label nothing; there the terms and the weight chip are self-describing
          and `about.tracks.column.weight` reaches a screen reader through the
          weight's own label below. */}
      <div className="hidden gap-x-6 border-border/60 border-b pb-2 font-medium text-muted-foreground text-xs sm:grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <span className="flex items-baseline justify-between gap-x-3">
          {t("about.tracks.column.component")}
          <span>{t("about.tracks.column.weight")}</span>
        </span>
        <span>{t("about.tracks.column.measures")}</span>
      </div>

      <DefinitionList className="border-t-0">
        {SCORE_COMPONENTS.map((component) => (
          <Definition
            key={component}
            term={t(SCORE_COMPONENT_LABELS[component])}
            // Two decimals, matching components/score-breakdown.tsx — the speech
            // weight is 0.01, and a whole-number column would print it as "0"
            // beside a participation weight of 100, which reads as "speeches do
            // not count". The `sr-only` label is what makes the figure
            // intelligible below `sm`, where the heading row is hidden: without
            // it a screen reader announces "Redebeiträge (Wörter). 0,01."
            aside={
              <>
                <span className="sr-only">{t("about.tracks.column.weight")}: </span>
                {formatNumber(DEFAULT_WEIGHTS[component], locale, 2)}
              </>
            }
          >
            {t(COMPONENT_DESCRIPTIONS[component])}
          </Definition>
        ))}
      </DefinitionList>

      <Prose>{t("about.tracks.weightsNote")}</Prose>

      {/* The three structural limits of the score, verbatim from the strings
          that render beside its bars on every profile. Repeated here rather
          than rewritten: a reader who has seen them next to a chart should
          recognise the sentence, not wonder whether this page's version is a
          different claim. */}
      <div className="flex flex-col gap-2">
        <CaveatNote>{t("score.caveat.namedVotes")}</CaveatNote>
        <CaveatNote>{t("score.caveat.committees")}</CaveatNote>
        <CaveatNote>{t("score.caveat.speechWords")}</CaveatNote>
      </div>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/rankings">
            {t("about.tracks.viewRankings")}
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </Section>
  )
}

// --- 2. what it does not capture ------------------------------------------

/** The four blind spots, in descending order of how often they are raised
 * against a tracker like this one. Committee deliberation is first because it
 * is the objection sitting members actually make. */
const BLIND_SPOTS: ReadonlyArray<{ titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  { titleKey: "about.limits.committees.title", bodyKey: "about.limits.committees.body" },
  { titleKey: "about.limits.constituency.title", bodyKey: "about.limits.constituency.body" },
  { titleKey: "about.limits.office.title", bodyKey: "about.limits.office.body" },
  { titleKey: "about.limits.party.title", bodyKey: "about.limits.party.body" },
]

function WhatItMisses() {
  const { t } = useLocale()

  return (
    <Section id="limits" titleKey="about.limits.title">
      {/* Full contrast and larger than body copy — the same treatment
          components/seating-notice.tsx gives its §9 disclaimer, and for the
          same reason: this is the sentence the page exists to say, and muted
          small print would be a disclaimer rather than a statement. */}
      <p className="max-w-prose text-base leading-relaxed">{t("about.limits.lead")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {BLIND_SPOTS.map(({ titleKey, bodyKey }) => (
          <Point key={titleKey} titleKey={titleKey} bodyKey={bodyKey} />
        ))}
      </div>

      {/* The home page's own caveat on the ascending leaderboard, reused. It is
          the shortest statement of this section's conclusion that already ships,
          and the board it qualifies is the place a reader is most likely to have
          come from. */}
      <CaveatNote>{t("home.bottomMPsCaveat")}</CaveatNote>

      <Prose>{t("about.limits.conclusion")}</Prose>
    </Section>
  )
}

// --- 3. data sources ------------------------------------------------------

/**
 * The five sources, each with what it actually supplies.
 *
 * `href` is optional and three of the five have none, which is deliberate
 * rather than unfinished: the protocol XML, the ballot sheets and the
 * Stammdaten dump have no landing page a reader can usefully open — the first
 * two are per-sitting files and the third downloads a 15 MB ZIP. They are named
 * and described; the open-data portal linked under the list is the door to all
 * three. See lib/links.ts.
 */
const SOURCES: ReadonlyArray<{
  nameKey: TranslationKey
  providesKey: TranslationKey
  href?: string
}> = [
  { nameKey: "about.sources.dip.name", providesKey: "about.sources.dip.provides", href: DIP_URL },
  { nameKey: "about.sources.protocols.name", providesKey: "about.sources.protocols.provides" },
  { nameKey: "about.sources.votes.name", providesKey: "about.sources.votes.provides" },
  { nameKey: "about.sources.stammdaten.name", providesKey: "about.sources.stammdaten.provides" },
  {
    nameKey: "about.sources.aw.name",
    providesKey: "about.sources.aw.provides",
    href: ABGEORDNETENWATCH_URL,
  },
]

function DataSources() {
  const { t } = useLocale()

  return (
    <Section id="sources" titleKey="about.sources.title">
      <Prose>{t("about.sources.body")}</Prose>

      <div className="hidden gap-x-6 border-border/60 border-b pb-2 font-medium text-muted-foreground text-xs sm:grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <span>{t("about.sources.column.source")}</span>
        <span>{t("about.sources.column.provides")}</span>
      </div>

      <DefinitionList className="border-t-0">
        {SOURCES.map(({ nameKey, providesKey, href }) => (
          <Definition
            key={nameKey}
            term={href ? <ExternalLink href={href}>{t(nameKey)}</ExternalLink> : t(nameKey)}
          >
            {t(providesKey)}
          </Definition>
        ))}
      </DefinitionList>

      <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <ExternalLink href={BUNDESTAG_OPEN_DATA_URL}>
          {t("about.sources.openDataLink")}
        </ExternalLink>
        <ExternalLink href={ABGEORDNETENWATCH_URL}>{t("about.sources.awLink")}</ExternalLink>
      </p>

      {/* §10 of docs/api-research.md requires both halves: name the source, and
          do not imply endorsement. `footer.disclaimer` says the second on every
          page; this says both in the section where the sources are listed. */}
      <CaveatNote>{t("about.sources.attribution")}</CaveatNote>
    </Section>
  )
}

// --- 4. coverage over time ------------------------------------------------

/** The coverage boundaries from docs/historical-coverage.md, in the order a
 * reader meets them: the source that reaches furthest back first, so the row
 * that stops at the current period reads as the exception it is. */
const COVERAGE: ReadonlyArray<{
  nameKey: TranslationKey
  sinceKey: TranslationKey
  whyKey: TranslationKey
}> = [
  {
    nameKey: "about.coverage.roster.name",
    sinceKey: "about.coverage.roster.since",
    whyKey: "about.coverage.roster.why",
  },
  {
    nameKey: "about.coverage.records.name",
    sinceKey: "about.coverage.records.since",
    whyKey: "about.coverage.records.why",
  },
  {
    nameKey: "about.coverage.speeches.name",
    sinceKey: "about.coverage.speeches.since",
    whyKey: "about.coverage.speeches.why",
  },
  {
    nameKey: "about.coverage.votes.name",
    sinceKey: "about.coverage.votes.since",
    whyKey: "about.coverage.votes.why",
  },
  {
    nameKey: "about.coverage.committees.name",
    sinceKey: "about.coverage.committees.since",
    whyKey: "about.coverage.committees.why",
  },
]

function Coverage() {
  const { t } = useLocale()

  return (
    <Section id="coverage" titleKey="about.coverage.title">
      <Prose>{t("about.coverage.body")}</Prose>

      <div className="hidden gap-x-6 border-border/60 border-b pb-2 font-medium text-muted-foreground text-xs sm:grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <span className="flex items-baseline justify-between gap-x-3">
          {t("about.coverage.column.data")}
          <span>{t("about.coverage.column.since")}</span>
        </span>
        <span>{t("about.coverage.column.why")}</span>
      </div>

      <DefinitionList className="border-t-0">
        {COVERAGE.map(({ nameKey, sinceKey, whyKey }) => (
          <Definition
            key={nameKey}
            term={t(nameKey)}
            // The `sr-only` label for the same reason as the weight above: below
            // `sm` the heading row is hidden, and "September 2019" on its own
            // does not say what it is the date of.
            aside={
              <>
                <span className="sr-only">{t("about.coverage.column.since")}: </span>
                {t(sinceKey)}
              </>
            }
          >
            {t(whyKey)}
          </Definition>
        ))}
      </DefinitionList>

      <Prose>{t("about.coverage.conclusion")}</Prose>
    </Section>
  )
}

// --- 5. dissent ------------------------------------------------------------

/** The four things a dissent count must not be read as. Each is a case
 * convex/votes.ts `isRebel` explicitly excludes — this list is that function's
 * three exclusions plus the one no code can fix, whipping, which no source
 * records at all. */
const DISSENT_EXCLUSIONS: readonly TranslationKey[] = [
  "about.dissent.not.whip",
  "about.dissent.not.absence",
  "about.dissent.not.tie",
  "about.dissent.not.unaffiliated",
]

function Dissent() {
  const { t } = useLocale()

  return (
    <Section id="dissent" titleKey="about.dissent.title">
      <Prose>{t("about.dissent.body")}</Prose>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Recorded and not-recorded side by side, each marked by a shape as
            well as by position: a tick and a cross, so the distinction survives
            greyscale and does not rest on the reader inferring it from the
            column order. The icons are `aria-hidden` because the label above
            each column already names which is which. */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckIcon className="size-4 shrink-0 text-gold" aria-hidden="true" />
              {t("about.dissent.measuresLabel")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground leading-relaxed">
            {t("about.dissent.measures")}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t("about.dissent.notLabel")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 pl-4 text-muted-foreground leading-relaxed marker:text-border">
              {DISSENT_EXCLUSIONS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Both reused verbatim. The first is the ceiling on everything in this
          section — most Bundestag votes leave no per-MP record at all — and the
          second is why the *level* of a discipline figure says nothing while the
          gap between two of them does. */}
      <CaveatNote>{t("votes.namedOnlyNotice")}</CaveatNote>
      <CaveatNote>{t("parties.disciplineCaveat")}</CaveatNote>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/votes">
            {t("about.dissent.viewVotes")}
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </Section>
  )
}

// --- 6. principles ---------------------------------------------------------

const PRINCIPLES: ReadonlyArray<{ titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  { titleKey: "about.principles.record.title", bodyKey: "about.principles.record.body" },
  { titleKey: "about.principles.approximate.title", bodyKey: "about.principles.approximate.body" },
  { titleKey: "about.principles.noRank.title", bodyKey: "about.principles.noRank.body" },
  { titleKey: "about.principles.gaps.title", bodyKey: "about.principles.gaps.body" },
  { titleKey: "about.principles.open.title", bodyKey: "about.principles.open.body" },
]

function Principles() {
  const { t } = useLocale()

  return (
    <Section id="principles" titleKey="about.principles.title">
      <div className="grid gap-3 sm:grid-cols-2">
        {PRINCIPLES.map(({ titleKey, bodyKey }) => (
          <Point key={titleKey} titleKey={titleKey} bodyKey={bodyKey} />
        ))}
      </div>

      {/* The example the "gaps are surfaced" principle is drawn from, in the
          words the seating page itself uses. Concrete beats abstract here: a
          reader who has seen the hemicycle now knows which claim about it was
          the invented one. */}
      <CaveatNote>{t("seating.syntheticNotice")}</CaveatNote>
    </Section>
  )
}

// --- 7. privacy ------------------------------------------------------------

const PRIVACY: ReadonlyArray<{ titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  { titleKey: "about.privacy.noTracking.title", bodyKey: "about.privacy.noTracking.body" },
  { titleKey: "about.privacy.cookies.title", bodyKey: "about.privacy.cookies.body" },
  { titleKey: "about.privacy.account.title", bodyKey: "about.privacy.account.body" },
  { titleKey: "about.privacy.mpData.title", bodyKey: "about.privacy.mpData.body" },
]

function Privacy() {
  const { t } = useLocale()

  return (
    <Section id="privacy" titleKey="about.privacy.title">
      <div className="grid gap-3 sm:grid-cols-2">
        {PRIVACY.map(({ titleKey, bodyKey }) => (
          <Point key={titleKey} titleKey={titleKey} bodyKey={bodyKey} />
        ))}
      </div>
      {/* What an account is *for*, from the sign-in page's own string — so the
          two cannot end up promising different things. */}
      <CaveatNote>{t("auth.optionalNotice")}</CaveatNote>
    </Section>
  )
}

// --- the page --------------------------------------------------------------

export function AboutPage() {
  const { t } = useLocale()

  return (
    <div className="flex flex-col gap-12">
      {/* The standfirst, above the contents rather than below it: the two
          sentences that answer "what is this" should not be reachable only by
          scrolling past a list of section names. */}
      <p className="max-w-prose text-base text-muted-foreground leading-relaxed sm:text-lg">
        {t("about.lead")}
      </p>

      <Contents />

      <WhatIsCounted />
      <WhatItMisses />
      <DataSources />
      <Coverage />
      <Dissent />
      <Principles />
      <Privacy />

      {/* Closing, and the one thing the page asks of the reader. Framed as an
          invitation to check rather than as a contact form: the premise of the
          site is that the figures are inspectable, which is only true if being
          told they are wrong is part of it. */}
      <section
        aria-labelledby="about-questions-heading"
        className="rounded-lg border border-border/60 bg-muted/30 p-5"
      >
        <h2 id="about-questions-heading" className="font-semibold text-lg tracking-tight">
          {t("about.questions.title")}
        </h2>
        <p className="mt-2 max-w-prose text-muted-foreground text-sm leading-relaxed">
          {t("about.questions.body")}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            {t("about.questions.cta")}
            <ExternalLinkIcon />
          </a>
        </Button>
      </section>
    </div>
  )
}
