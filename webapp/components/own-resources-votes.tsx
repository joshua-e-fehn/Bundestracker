"use client"

import { useQuery } from "convex/react"
import { TriangleAlert } from "lucide-react"
import Link from "next/link"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { VoteBar } from "@/components/vote-bar"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { api } from "@/convex/_generated/api"
import { formatDateShort } from "@/lib/format"
import {
  OWN_RESOURCE_TOPIC_KEYS,
  OWN_RESOURCE_VOTES,
  OWN_RESOURCE_VOTES_AS_OF,
  ownResourceVote,
} from "@/lib/own-resources-votes"

/**
 * Ballots in which the Bundestag decided on its own resources.
 *
 * ## This page publishes a selection, and says so before it shows one
 *
 * Every other list on this site is a query: `/votes` shows the ballots that
 * exist, in the order they happened, and the only editorial act is the sort.
 * This one is different in kind — the ballots are real and the tallies come
 * from the published sheets, but *which* ballots appear is a human judgement
 * recorded in lib/own-resources-votes.ts. A reader has to know that before the
 * first row rather than after the last, which is why the notice here is the
 * gold `role="note"` shape rather than a muted `CaveatNote`: the same call
 * `SyntheticSeatingNotice` makes on /seating, and for the same reason — a
 * caveat that changes how the whole page should be read is not small print.
 *
 * ## Both sides of a live dispute, or neither
 *
 * "Parliament votes itself money" is a real and legitimate line of scrutiny.
 * It is also a claim with a documented counterweight, and publishing the first
 * without the second would make this page an argument rather than a record: the
 * Fraktionen's use of their state funding is **audited by the
 * Bundesrechnungshof** under §53 Abgeordnetengesetz, and parties file annual
 * accounts scrutinised by the Bundestagspräsident under the Parteiengesetz.
 * `ownResources.audited` carries that, at the same weight and on the same
 * screen — not behind a link, not below the fold. Nothing on this page is worth
 * publishing one-sidedly.
 *
 * The absent Diäten section is the other half of that honesty. Members' pay
 * has been indexed automatically since 2014 (§11 Abgeordnetengesetz) and
 * adjusts without a division, so there is nothing to list — and a reader who
 * finds no pay votes without being told why would reasonably conclude they had
 * been hidden. `ownResources.payNotice` says it outright.
 *
 * ## Bounded by the list, so no pager
 *
 * A curated collection is a few dozen ballots. `getVoteSheetsByKey` reads them
 * by natural key, capped, and the whole set arrives at once — the paging and
 * server-side filtering components/vote-list.tsx needs exist because a period's
 * corpus is hundreds of rows and its pager needs a `total`. Importing that
 * machinery for seven rows would be borrowing a constraint this page does not
 * have.
 */
export function OwnResourcesVotes() {
  // No `locale` here: every figure on this page is rendered by `BallotCard`,
  // which takes its own. The notices above are plain strings.
  const { t } = useLocale()

  // The keys are the curated list's, stripped to the natural key the query
  // takes. The topic and the rationale stay on the client — they are editorial
  // and the database has no business carrying them (see the module header).
  const sheets = useQuery(api.votes.getVoteSheetsByKey, {
    keys: OWN_RESOURCE_VOTES.map((entry) => ({
      wahlperiode: entry.wahlperiode,
      sitzungnr: entry.sitzungnr,
      abstimmnr: entry.abstimmnr,
    })),
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Above everything and unconditional — before any query resolves, so the
          framing never arrives after the figures it governs. */}
      <p
        // `note`, not `alert`: permanent context for the page rather than
        // something that has just gone wrong. Copied deliberately from
        // components/seating-notice.tsx, whose header sets out the reasoning.
        role="note"
        className="flex gap-2.5 rounded-lg border border-gold/40 bg-gold/10 p-3.5 text-sm leading-relaxed"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
        <span>
          {t("votes.ownResources.curatedNotice")}{" "}
          <span className="text-muted-foreground">
            {t("votes.ownResources.asOf", { month: OWN_RESOURCE_VOTES_AS_OF })}
          </span>
        </span>
      </p>

      {/* The counterweight, at the same weight as the framing above it and on
          the same screen. Not optional and not collapsible — see the header. */}
      <CaveatNote>{t("votes.ownResources.audited")}</CaveatNote>

      {/* Why there is no pay section. An absent category is a finding only if
          the reader knows why it is absent. */}
      <CaveatNote>{t("votes.ownResources.payNotice")}</CaveatNote>

      {sheets === undefined ? (
        <output className="flex flex-col gap-3" aria-live="polite">
          <span className="sr-only">{t("common.loading")}</span>
          {OWN_RESOURCE_VOTES.map((entry) => (
            <Skeleton
              key={`${entry.wahlperiode}-${entry.sitzungnr}-${entry.abstimmnr}`}
              className="h-28 w-full rounded-lg"
            />
          ))}
        </output>
      ) : sheets.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border border-dashed p-8 text-center">
          <p className="font-medium text-sm">{t("common.noData")}</p>
          {/* "not ingested", not "no such votes". The curated list is not empty
              — the corpus is — and the difference is the whole point of this
              page's honesty about its own construction. */}
          <p className="text-muted-foreground text-sm">{t("votes.ownResources.empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sheets.map((sheet) => (
            <BallotCard key={sheet.id} sheet={sheet} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One curated ballot: what it was, what it decided, and why it is on this
 * page. A card rather than a table row because the rationale is a sentence and
 * a sentence does not belong in a column. */
function BallotCard({
  sheet,
}: {
  sheet: {
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
  }
}) {
  const { t, locale } = useLocale()
  // Matched back to the curated entry by natural key. The query returns only
  // the sheets it found and in date order, so this cannot be an index lookup.
  const curated = ownResourceVote(sheet)

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={`/votes/${sheet.id}`} className="font-medium text-sm hover:underline">
            {sheet.title}
          </Link>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatDateShort(sheet.date, locale)} ·{" "}
            {t("votes.sitting", { sitzungnr: sheet.sitzungnr, abstimmnr: sheet.abstimmnr })}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {/* The topic, as a neutral tag. `bg-muted` with no hue: a category on
              a page about self-interest must not look like a verdict on the
              ballot it labels. */}
          {curated !== null && (
            <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
              {t(OWN_RESOURCE_TOPIC_KEYS[curated.topic])}
            </Badge>
          )}
          <VoteOutcomeBadge result={sheet.result} locale={locale} />
        </div>
      </div>

      <VoteBar
        counts={{
          yes: sheet.yesCount,
          no: sheet.noCount,
          abstain: sheet.abstainCount,
          invalid: sheet.invalidCount,
          absent: sheet.absentCount,
        }}
        locale={locale}
      />

      {/* The editorial part, visibly separated from the counted part above it:
          everything higher in this card is transcribed from the published
          sheet, and this sentence is ours. Muted and italic so the boundary is
          legible without a second box. */}
      {curated !== null && (
        <p className="text-muted-foreground text-xs italic leading-relaxed">
          {t(curated.rationaleKey)}
        </p>
      )}
    </li>
  )
}
