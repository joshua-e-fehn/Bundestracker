"use client"

import { useQuery } from "convex/react"
import { useLocale } from "@/components/providers/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { VoteResultBadge } from "@/components/vote-result-badge"
import { api } from "@/convex/_generated/api"
import { drucksachePdfUrl, formatDate, formatNumber, protocolPdfUrl } from "@/lib/bundestag"

/**
 * The three "latest five" panels: speeches, motions, recorded votes.
 *
 * Five each, not fifty. This is a summary beside the score, and the queries
 * behind it are the profile-page reads their own docstrings name — a longer
 * list belongs on a dedicated tab with paging, which is not this.
 *
 * Every row that can link to its source document does. `drucksachePdfUrl` and
 * `protocolPdfUrl` reconstruct the address from the deterministic patterns in
 * §8 of docs/api-research.md, which is why no URL is stored per row.
 */
export function MPRecentRecords({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  return (
    <div className="flex flex-col gap-6">
      <RecentSpeeches mpInternalId={mpInternalId} wahlperiode={wahlperiode} />
      <RecentMotions mpInternalId={mpInternalId} wahlperiode={wahlperiode} />
      <RecentVotes mpInternalId={mpInternalId} wahlperiode={wahlperiode} />
    </div>
  )
}

const LIMIT = 5

function RecentSpeeches({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const speeches = useQuery(api.speeches.getSpeechesByMP, {
    mpInternalId,
    wahlperiode,
    limit: LIMIT,
  })

  return (
    <Panel title={t("mp.latestSpeeches")} loading={speeches === undefined}>
      {speeches?.length === 0 ? (
        <Empty>{t("mp.noSpeeches")}</Empty>
      ) : (
        <ul className="flex flex-col divide-y">
          {speeches?.map((speech) => (
            <li key={speech.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-sm">
                  {speech.topic ?? t("mp.sitting", { number: speech.sitzungnr })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(speech.protocolDate, locale)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                <span>{t("mp.sitting", { number: speech.sitzungnr })}</span>
                {/* `wordCount` is what the score weights, not the number of
                    times the MP took the floor — §5.2's finding, restated
                    wherever a speech is shown. Nullable: a segment parsed
                    before the word rule was applied has none. */}
                {speech.wordCount !== null ? (
                  <span>
                    {t("mp.wordCount", { count: formatNumber(speech.wordCount, locale) })}
                  </span>
                ) : null}
                <SourceLink href={protocolPdfUrl(speech.wahlperiode, speech.sitzungnr)}>
                  {t("mp.openProtocol")}
                </SourceLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecentMotions({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const motions = useQuery(api.motions.getMotionsByMP, {
    mpInternalId,
    wahlperiode,
    limit: LIMIT,
  })

  return (
    <Panel title={t("mp.latestMotions")} loading={motions === undefined}>
      {motions?.length === 0 ? (
        <Empty>{t("mp.noMotions")}</Empty>
      ) : (
        <ul className="flex flex-col divide-y">
          {motions?.map(({ motion, role }) => {
            const pdf = drucksachePdfUrl(motion.drucksacheNr)
            return (
              <li key={motion.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-sm leading-snug">{motion.title}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatDate(motion.date, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                  {motion.type ? <span>{motion.type}</span> : null}
                  {motion.drucksacheNr ? <span>{motion.drucksacheNr}</span> : null}
                  {role ? <span>{role}</span> : null}
                  <SourceLink href={pdf}>{t("mp.openDrucksache")}</SourceLink>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function RecentVotes({ mpInternalId, wahlperiode }: { mpInternalId: string; wahlperiode: number }) {
  const { t, locale } = useLocale()
  const votes = useQuery(api.votes.getVotesByMP, { mpInternalId, wahlperiode, limit: LIMIT })

  return (
    <Panel title={t("mp.latestVotes")} loading={votes === undefined}>
      {votes?.length === 0 ? (
        <div className="flex flex-col gap-2">
          <Empty>{t("mp.noVotes")}</Empty>
          {/* The caveat belongs on an empty vote list more than anywhere: only
              named ballots exist as per-MP records at all (§4.4), so "no votes"
              never means "did not vote". */}
          <p className="text-muted-foreground text-xs">{t("score.caveat.namedVotes")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y">
          {votes?.map((record) => (
            <li key={record.sheet.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-sm leading-snug">{record.sheet.title}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {formatDate(record.sheet.date, locale)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <VoteResultBadge vote={record.vote} locale={locale} />
                <PartyLine record={record} />
              </div>
              {record.remark ? (
                <span className="text-muted-foreground text-xs">{record.remark}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * Whether this MP voted with their own group.
 *
 * `groupVote` is null when there is no majority to compare against — no group
 * on the record, nobody in it voted, or the group split evenly. That is stated
 * as "unknown" rather than folded into agreement; see `groupMajority` in
 * convex/votes.ts for why a tie is not a line.
 *
 * An `absent` MP is not compared at all: not voting is not a position, and
 * calling an absence "against the group" would be a claim the sheet does not
 * make.
 */
function PartyLine({
  record,
}: {
  record: {
    vote: "yes" | "no" | "abstain" | "invalid" | "absent"
    groupVote: { vote: string; share: number } | null
  }
}) {
  const { t } = useLocale()
  if (record.vote === "absent") return null
  if (!record.groupVote) {
    return <span className="text-muted-foreground text-xs">{t("mp.partyLineUnknown")}</span>
  }
  const withGroup = record.groupVote.vote === record.vote
  return (
    <span
      // `--vote-abstain` — the brand gold's ink tier — for a vote against the
      // group's line, matching components/rebel-vote-badge.tsx, which marks the
      // same fact in a table cell. These were `text-amber-700` /
      // `dark:text-amber-400`, a hue from outside the palette that also made
      // this line and that badge two different colours for one concept.
      //
      // The token is redefined per theme and each side clears 4.5:1, so the
      // `dark:` half is dropped rather than translated. Gold rather than red
      // for the reason that badge gives at length: dissent is notable, not bad,
      // and red on a name reads as an error state.
      className={
        withGroup ? "text-muted-foreground text-xs" : "text-vote-abstain text-xs"
      }
    >
      {withGroup ? t("mp.partyLineWith") : t("mp.partyLineAgainst")}
    </span>
  )
}

function Panel({
  title,
  loading,
  children,
}: {
  title: string
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <div className="h-24 animate-pulse rounded-md bg-muted" /> : children}
      </CardContent>
    </Card>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>
}

/** A link to the source document, or nothing. Null rather than a disabled link
 * when the URL cannot be built — see `drucksachePdfUrl`, which refuses to guess
 * for a Bundesrat-numbered paper rather than produce an address pointing at a
 * different document. */
function SourceLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  )
}
