"use client"

import { useQuery } from "convex/react"
import { AlertTriangle, ExternalLink } from "lucide-react"
import Link from "next/link"
import { CaveatNote } from "@/components/caveat-note"
import { type FraktionBreakdown, FraktionVoteSummary } from "@/components/fraktion-vote-summary"
import { LameDuckBadge } from "@/components/lame-duck-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { PeriodProvider } from "@/components/providers/period-provider"
import { Card } from "@/components/ui/card"
import { VoteBar, type VoteCounts } from "@/components/vote-bar"
import { VoteExplanationsDisclosure } from "@/components/vote-explanations-disclosure"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { VoteTable, type VoteTableRow } from "@/components/vote-table"
import { api } from "@/convex/_generated/api"
import { formatDate, formatPercent } from "@/lib/format"
import { isLameDuckVote, LAME_DUCK_MAINTAINED_AS_OF } from "@/lib/lame-duck"
import { periodLink } from "@/lib/period"

/**
 * One ballot in full: the outcome, the chamber's split, each group's line, and
 * every member's vote.
 *
 * A client component because the language toggle is client-side and the table
 * below it filters interactively. The data is fetched by the server page above
 * and passed in — that read decides whether the route is a 404, so it cannot
 * happen here.
 *
 * ## The two tallies, and why both are shown
 *
 * `sheet.*Count` is what the Bundestag published. `tallied` is what the loaded
 * records actually add up to. convex/schema.ts stores them un-derived from each
 * other precisely so a half-finished ingest shows up as a *disagreement*
 * rather than as a different result, and this is where that reaches the reader:
 * when they differ, the page says the data is incomplete instead of presenting a
 * confidently wrong total. The bar is drawn from the published figures, because
 * those are the official result; the warning says the rows below may not match.
 */

type Sheet = {
  id: string
  wahlperiode: number
  sitzungnr: number
  abstimmnr: number
  title: string
  date: string
  result: string
  yesCount: number
  noCount: number
  abstainCount: number
  invalidCount: number
  absentCount: number
  totalEligible: number
  sourceUrl: string | null
  /** The DIP procedure this ballot decided, when the pipeline has resolved
   * it — the only route from a ballot to the §31 declarations filed on it.
   * The XLSX sheet carries no procedure id (§4.1), so this arrives via a
   * separate resolver and stays nullable. See the schema note on
   * `voteSheets.dipVorgangId` for the three distinct states this represents. */
  dipVorgangId: string | null
}

/** One labelled figure in the header strip. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export function VoteDetail({
  sheet,
  records,
  tallied,
  breakdown,
  rebelCount,
}: {
  sheet: Sheet
  records: VoteTableRow[]
  tallied: VoteCounts
  breakdown: FraktionBreakdown[]
  rebelCount: number
}) {
  const { t, locale } = useLocale()
  // The sitting period, so a link back to a *current* page can stay bare. One
  // subscription for the whole ballot page, passed to `PeriodProvider` below.
  const periods = useQuery(api.mps.listPeriods, {})
  // Coverage for the ballot's Wahlperiode — read once at page level and
  // threaded into the disclosure. The UI needs only a boolean ("does this
  // deployment hold any §31 declaration for this period"), so this reads
  // the cheap `hasAnyExplanationsForPeriod` — one document at most — rather
  // than the count-form `getExplanationCoverage`, which `.collect()`s the
  // whole period to build a total no reader sees. That distinction is what
  // stops the read cost of the page growing with a period's size. See the
  // header on `convex/voteExplanations.ts:hasAnyExplanationsForPeriod`.
  const hasAnyExplanations = useQuery(api.voteExplanations.hasAnyExplanationsForPeriod, {
    wahlperiode: sheet.wahlperiode,
  })

  // Through the locale formatter rather than printed raw: every other date on
  // this page is, and an ISO string beside "18. März 2025" reads as a machine
  // artefact rather than as a maintenance date.
  const maintainedAsOf = formatDate(LAME_DUCK_MAINTAINED_AS_OF, locale)

  const published: VoteCounts = {
    yes: sheet.yesCount,
    no: sheet.noCount,
    abstain: sheet.abstainCount,
    invalid: sheet.invalidCount,
    absent: sheet.absentCount,
  }

  const publishedTotal =
    published.yes + published.no + published.abstain + published.invalid + published.absent
  const talliedTotal = tallied.yes + tallied.no + tallied.abstain + tallied.invalid + tallied.absent

  // Compared position by position rather than on the totals alone: two errors
  // that cancel out would leave the totals equal while every column was wrong.
  const mismatch =
    records.length > 0 &&
    (published.yes !== tallied.yes ||
      published.no !== tallied.no ||
      published.abstain !== tallied.abstain ||
      published.invalid !== tallied.invalid ||
      published.absent !== tallied.absent)

  // Turnout over the *published* eligible count, which is the sheet's own
  // denominator. Guarded because a sheet reconstructed from the protocol XML
  // can carry zero (§4.2), and a division by it would render "Infinity%".
  const cast = published.yes + published.no + published.abstain + published.invalid
  const turnoutBase = sheet.totalEligible > 0 ? sheet.totalEligible : publishedTotal

  return (
    // The ballot's own Wahlperiode scopes every link out of this page.
    //
    // `sheet.wahlperiode` rather than a `?wp=` on this URL, and that is the
    // stronger source: a ballot *belongs* to one period as a fact about the
    // ballot, where a query parameter is a statement about what the reader
    // asked for. `/votes/[id]` is keyed by a sheet id that already determines
    // the period, so a parameter has nothing to add and something to
    // contradict.
    //
    // So a WP19 ballot's member rows link to WP19 profiles even for a reader
    // who arrived from a bare `/votes/<id>`. That is right: the member voted in
    // *that* chamber, and their current mandate — if they still hold one — is a
    // different row about a different four years.
    <PeriodProvider wahlperiode={sheet.wahlperiode} current={periods?.current}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <Link
            href={periodLink("/votes", sheet.wahlperiode, periods?.current ?? null)}
            className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
          >
            ← {t("votes.backToList")}
          </Link>

          <div className="flex flex-col gap-3">
            <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">{sheet.title}</h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
              <span className="tabular-nums">{formatDate(sheet.date, locale)}</span>
              {/* The sitting label — unchanged in wording — becomes a link to
                  the sitting page. `(wahlperiode, sitzungnr)` names a real
                  page for every ballot (both fields are required on
                  `voteSheets`), so this is unconditional; the sitting page
                  itself decides how to render an unbackfilled or empty
                  sitting. Link kept on the ballot label only, not on the
                  vote-number half — a reader who clicked "Abstimmung 3"
                  would not expect the whole sitting, only that ballot.
                  `periodLink` scopes the URL to the ballot's own
                  Wahlperiode, matching the "back to /votes" link two rows
                  up. */}
              <Link
                href={periodLink(
                  `/sittings/${sheet.wahlperiode}/${sheet.sitzungnr}`,
                  sheet.wahlperiode,
                  periods?.current ?? null,
                )}
                className="tabular-nums underline underline-offset-4 hover:text-foreground"
              >
                {t("votes.sitting", {
                  sitzungnr: sheet.sitzungnr,
                  abstimmnr: sheet.abstimmnr,
                })}
              </Link>
              <VoteOutcomeBadge result={sheet.result} locale={locale} />
              {/* Full label here, unlike the list's compact mark: this is the page
                about this one ballot, so there is room for the word and a
                reader arriving from a search has no column header to read it
                from. */}
              <LameDuckBadge date={sheet.date} wahlperiode={sheet.wahlperiode} locale={locale} />
            </div>
          </div>
        </div>

        {/* The caveat that governs every figure on this page. */}
        <CaveatNote>{t("votes.namedOnlyNotice")}</CaveatNote>

        {/* The badge is a two-word label; this is what it means. Rendered on the
          same condition, through the same function, so the note and the mark
          cannot appear without each other — a badge reading "Geschäftsführend"
          with no explanation is a label a reader has no way to check.

          It is a `CaveatNote` rather than body text because it does the same job
          every other one on this site does: it says the figures below are true
          and are not the whole story. Here the qualification is about *who*
          voted rather than about what was counted. */}
        {isLameDuckVote(sheet.date, sheet.wahlperiode) ? (
          <CaveatNote>
            {t("votes.lameDuckNotice")} {t("votes.lameDuckMaintained", { date: maintainedAsOf })}
          </CaveatNote>
        ) : null}

        {mismatch ? (
          <p className="flex gap-2 rounded-md border border-vote-abstain/40 bg-vote-abstain/10 p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>
              {t("votes.tallyMismatch")}{" "}
              <span className="tabular-nums">
                {t("votes.tallyPublished")}: {publishedTotal} · {t("votes.tallyCounted")}:{" "}
                {talliedTotal}
              </span>
            </span>
          </p>
        ) : null}

        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <VoteBar counts={published} locale={locale} showLegend />

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Stat
              label={t("votes.turnout")}
              value={turnoutBase > 0 ? formatPercent(cast / turnoutBase, locale) : "—"}
            />
            <Stat label={t("votes.eligible")} value={String(sheet.totalEligible)} />
            {rebelCount > 0 ? <Stat label={t("votes.rebels")} value={String(rebelCount)} /> : null}
          </div>

          {/* The XLSX this ballot was parsed from. Null when it was reconstructed
            from the protocol XML instead, which is also the case where
            `absentCount` cannot be trusted (schema note on `sourceUrl`). */}
          {sheet.sourceUrl !== null ? (
            <a
              href={sheet.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-fit items-center gap-1.5 text-sm underline underline-offset-4 hover:text-foreground"
            >
              {t("votes.sourceSheet")}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </Card>

        <section aria-labelledby="vote-breakdown-heading" className="flex flex-col gap-3">
          <h2 id="vote-breakdown-heading" className="font-semibold text-lg">
            {t("votes.breakdownTitle")}
          </h2>
          <Card className="p-4 sm:p-5">
            <FraktionVoteSummary breakdown={breakdown} locale={locale} />
          </Card>
          <p className="text-muted-foreground text-xs leading-relaxed">{t("votes.rebelsNote")}</p>
        </section>

        {/* The reader-side of the §31 feature — filed declarations against
            this ballot, if any, disclosed on request. Positioned between the
            group-line breakdown and the per-member table so it sits with the
            other per-ballot context rather than beside the records table it
            has nothing to do with. `useQuery` inside the disclosure is
            `"skip"`ped while collapsed, so this section adds one coverage read
            to the page (above) and no explanation reads until the reader
            opens it. */}
        <VoteExplanationsDisclosure
          ballotId={sheet.id}
          wahlperiode={sheet.wahlperiode}
          dipVorgangId={sheet.dipVorgangId}
          variant="section"
          hasAnyForPeriod={hasAnyExplanations}
        />

        <section aria-labelledby="vote-records-heading" className="flex flex-col gap-3">
          <h2 id="vote-records-heading" className="font-semibold text-lg">
            {t("votes.recordsTitle")}
          </h2>
          {records.length === 0 ? (
            <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
              {t("votes.recordsEmpty")}
            </p>
          ) : (
            <VoteTable rows={records} />
          )}
        </section>
      </div>
    </PeriodProvider>
  )
}
