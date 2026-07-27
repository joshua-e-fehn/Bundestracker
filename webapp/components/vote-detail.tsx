"use client"

import { AlertTriangle, ExternalLink, Info } from "lucide-react"
import Link from "next/link"
import { type FraktionBreakdown, FraktionVoteSummary } from "@/components/fraktion-vote-summary"
import { useLocale } from "@/components/providers/locale-provider"
import { Card } from "@/components/ui/card"
import { VoteBar, type VoteCounts } from "@/components/vote-bar"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { VoteTable, type VoteTableRow } from "@/components/vote-table"
import { formatDate, formatPercent } from "@/lib/format"

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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/votes"
          className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
        >
          ← {t("votes.backToList")}
        </Link>

        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">{sheet.title}</h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
            <span className="tabular-nums">{formatDate(sheet.date, locale)}</span>
            <span className="tabular-nums">
              {t("votes.sitting", {
                sitzungnr: sheet.sitzungnr,
                abstimmnr: sheet.abstimmnr,
              })}
            </span>
            <VoteOutcomeBadge result={sheet.result} locale={locale} />
          </div>
        </div>
      </div>

      {/* The caveat that governs every figure on this page. */}
      <p className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-xs leading-relaxed">
        <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
        {t("votes.namedOnlyNotice")}
      </p>

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
  )
}
