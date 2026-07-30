"use client"

import { useQuery } from "convex/react"
import { useLocale } from "@/components/providers/locale-provider"
import { SourceCoverageNote } from "@/components/source-coverage-note"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { VoteResultBadge } from "@/components/vote-result-badge"
import { api } from "@/convex/_generated/api"
import {
  drucksachePdfUrl,
  formatDate,
  formatNumber,
  protocolPdfUrl,
  safeExternalUrl,
} from "@/lib/bundestag"

/**
 * The five "latest five" panels: speeches, motions, written questions, votes,
 * §31 declarations.
 *
 * Five each, not fifty. This is a summary beside the score, and the queries
 * behind it are the profile-page reads their own docstrings name — a longer
 * list belongs on a dedicated tab with paging, which is not this.
 *
 * Every row that can link to its source document does. `drucksachePdfUrl` and
 * `protocolPdfUrl` reconstruct the address from the deterministic patterns in
 * §8 of docs/api-research.md, which is why no URL is stored per row. Questions
 * are the exception and say why at `RecentQuestions`; §31 declarations link to
 * their page-anchored protocol PDF, which is a stored field.
 *
 * The questions panel is in this file rather than beside it, which is a
 * deliberate reversal of the obvious split: it is a fifth instance of the same
 * thing — same `Panel` chrome, same `LIMIT`, same three-state loading rule — and
 * a `mp-recent-questions.tsx` would have carried its own copy of all three. The
 * panels are siblings on one page; the moment they stop sharing a definition of
 * "latest five" is the moment one of them starts showing eight.
 */
export function MPRecentRecords({
  mpInternalId,
  wahlperiode,
  current,
}: {
  mpInternalId: string
  wahlperiode: number
  /**
   * The sitting period, so two of these panels can say why they are empty.
   *
   * Speeches and votes are the panels with a source boundary: protocol XML
   * begins at WP18 and roll-call sheets at 2019-09-26, so an empty list in an
   * earlier period is "never published" rather than "this member never spoke or
   * voted" (`docs/historical-coverage.md`). Motions and questions come from
   * DIP, which covers every tracked period, so their empty states are already
   * honest as they stand. §31 declarations are on the same DIP feed as the
   * questions, so they carry no source boundary either — the emptiness they
   * *do* have to distinguish is not-yet-backfilled from none-filed, and
   * `RecentExplanations` resolves that with the period-level coverage query.
   */
  current?: number | null
}) {
  return (
    <div className="flex flex-col gap-6">
      <RecentSpeeches mpInternalId={mpInternalId} wahlperiode={wahlperiode} current={current} />
      <RecentMotions mpInternalId={mpInternalId} wahlperiode={wahlperiode} />
      {/* Between the motions an MP tables and the votes they cast: a written
          question is the same kind of act as a motion — something the member
          initiated — where a vote is a response to someone else's. */}
      <RecentQuestions mpInternalId={mpInternalId} wahlperiode={wahlperiode} />
      <RecentVotes mpInternalId={mpInternalId} wahlperiode={wahlperiode} current={current} />
      {/* §31 declarations, immediately after votes because they are *about*
          votes: a member's own on-the-record reason for the way they voted.
          Kept below the ballot list — not folded into it — because a
          declaration exists as its own DIP record with its own protocol page,
          and treating it as a footnote on a vote row would drop the deep link
          into the protocol PDF that is the only route to the wording. */}
      <RecentExplanations mpInternalId={mpInternalId} wahlperiode={wahlperiode} />
    </div>
  )
}

const LIMIT = 5

function RecentSpeeches({
  mpInternalId,
  wahlperiode,
  current,
}: {
  mpInternalId: string
  wahlperiode: number
  current?: number | null
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
        <div className="flex flex-col gap-2">
          <Empty>{t("mp.noSpeeches")}</Empty>
          {/* Protocol XML begins at WP18. For WP17 and earlier the sittings
              happened and the transcripts are PDF-only, so this panel is empty
              for *every* member of those periods — which is a fact about the
              publishing format, not about anybody's willingness to speak.
              Renders nothing from WP18 on, where an empty list really does mean
              this member has no recorded speech. */}
          <SourceCoverageNote source="speeches" wahlperiode={wahlperiode} current={current} />
        </div>
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

/**
 * Kleine and Große Anfragen — the questions this member put to the government.
 *
 * ## Why this panel exists
 *
 * `getQuestionsByMP` sat in convex/questions.ts with no caller. Written
 * questions are the cheapest scrutiny instrument an individual member has: no
 * majority needed, no committee slot, no speaking time, and the government must
 * answer. That makes them the nearest thing to a floor on what a backbencher can
 * be *seen* to do — and until now a visitor could read that an MP asked forty of
 * them, because the score panel counts them, without being able to see one.
 *
 * A count nobody can open is exactly the kind of figure AGENTS.md says this site
 * does not publish.
 *
 * ## Both kinds are marked, not merged
 *
 * The distinction is constitutional rather than editorial — a Große Anfrage is
 * debated in the chamber, a Kleine Anfrage answered in writing — which is why
 * `type` is a closed union in the schema where `aktivitaetsart` is not. They are
 * also lopsided, Kleine Anfragen dominating, so an undifferentiated list would
 * let one debated question vanish among thirty written ones. The badge renders
 * on both rather than only on the rare kind: an unbadged row would read as
 * "kind unknown" rather than as the common case.
 *
 * ## No source link, and that is the honest answer
 *
 * The three sibling panels link every row to its document; this one cannot. A
 * question reaches the database as an `/aktivitaet` record, while the Drucksache
 * number that would build the address is on a different record with no shared id
 * — the behavioural-key note in convex/questions.ts. `drucksachePdfUrl` already
 * refuses to guess rather than emit an address pointing at a different document,
 * and the same refusal applies here: a link to the wrong Anfrage is worse than
 * no link.
 */
function RecentQuestions({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const questions = useQuery(api.questions.getQuestionsByMP, {
    mpInternalId,
    wahlperiode,
    limit: LIMIT,
  })

  return (
    <Panel title={t("mp.latestQuestions")} loading={questions === undefined}>
      {questions?.length === 0 ? (
        <Empty>{t("mp.noQuestions")}</Empty>
      ) : (
        <ul className="flex flex-col divide-y">
          {questions?.map((question) => (
            <li key={question.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-sm leading-snug">{question.subject}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {formatDate(question.date, locale)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                <span>
                  {t(question.type === "major" ? "mp.questionMajor" : "mp.questionMinor")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecentVotes({
  mpInternalId,
  wahlperiode,
  current,
}: {
  mpInternalId: string
  wahlperiode: number
  current?: number | null
}) {
  const { t, locale } = useLocale()
  const votes = useQuery(api.votes.getVotesByMP, { mpInternalId, wahlperiode, limit: LIMIT })
  const tally = useQuery(api.votes.getDissentTally, { mpInternalId, wahlperiode })

  return (
    <Panel title={t("mp.latestVotes")} loading={votes === undefined}>
      {/* Five rows of "auf Fraktionslinie" say nothing about whether this member
          usually is. The period figure is what turns the list into a sample of
          something — and it is the one number here that the five rows *cannot*
          imply, since `getVotesByMP` caps at 25 for read-cost reasons and the
          most recent five are not a random draw. Above the list rather than
          below it: it is the summary the rows are instances of. */}
      {tally !== undefined && tally !== null && tally.ballotsCast > 0 ? (
        <p className="mb-3 text-muted-foreground text-xs leading-relaxed">
          {tally.dissents === 0
            ? t("mp.dissentNone", { cast: formatNumber(tally.ballotsCast, locale) })
            : t("mp.dissentCount", {
                count: formatNumber(tally.dissents, locale),
                cast: formatNumber(tally.ballotsCast, locale),
              })}
        </p>
      ) : null}

      {votes?.length === 0 ? (
        <div className="flex flex-col gap-2">
          <Empty>{t("mp.noVotes")}</Empty>
          {/* Two limits, and on a pre-2019 period the second is the bigger one.
              Roll-call data sheets begin 2019-09-26, so for WP18 and earlier
              *no* per-member ballot record exists in any format — an emptiness
              that covers every member of those chambers. Above the standing
              caveat because it is the stronger claim where it applies, and
              absent from WP20 on, where the standing caveat is the whole
              story. */}
          <SourceCoverageNote source="votes" wahlperiode={wahlperiode} current={current} />
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
 * The MP's own §31 declarations in this Wahlperiode.
 *
 * ## What is shown, and what is not
 *
 * A §31 declaration is a member's on-the-record reason for their vote. DIP
 * publishes the *existence* — who filed it, which procedure it concerns, which
 * protocol page it is printed on — but never the prose (§3.4 of
 * convex/voteExplanations.ts). So every row here is one of those four facts
 * passed through and none of them synthesised: the referenced procedure's
 * title, the date, the protocol reference, and a deep link into the page
 * anchored PDF. Nothing on this panel invents, paraphrases, summarises or
 * labels the reason itself — the words live in the linked protocol, which is
 * exactly where the caveat below points.
 *
 * ## The three empty states
 *
 * `getExplanationsByMP` returning `[]` is ambiguous: it may mean the source
 * filed none for this member, or it may mean the deployment has not backfilled
 * §31 declarations for this period yet. `hasAnyExplanationsForPeriod` is the
 * cheap boolean that tells them apart (one document read per page load,
 * bounded on the period index — the header of the query in
 * convex/voteExplanations.ts explains why the count form is not used here).
 * Same distinction, and the same reasoning, as
 * components/vote-explanations-disclosure.tsx uses per-ballot; scoped here to
 * the member rather than to a Vorgang.
 *
 * Loading covers both queries: rendering "no declaration was filed" while
 * coverage is still resolving would flash a positive claim about the member
 * that a page hasn't yet checked.
 *
 * ## Positioned below the vote list, not above it
 *
 * Below because it is the *further-detail* signal: a member typically files a
 * declaration on a ballot they voted against their group's line, so this panel
 * is the tail on the vote list rather than a peer of it. Above the section
 * boundary — this is not a floor of the page, and the panel has to compete for
 * a reader's attention with the vote list beside it.
 */
function RecentExplanations({
  mpInternalId,
  wahlperiode,
}: {
  mpInternalId: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const explanations = useQuery(api.voteExplanations.getExplanationsByMP, {
    mpInternalId,
    wahlperiode,
    limit: LIMIT,
  })
  // Period-level coverage: is any §31 declaration ingested for this WP at all?
  // Reading the boolean rather than the count form because the UI needs only a
  // yes/no here — see the header on `hasAnyExplanationsForPeriod` for why the
  // page cost of a populated period is one document, not thousands.
  const hasAnyForPeriod = useQuery(api.voteExplanations.hasAnyExplanationsForPeriod, {
    wahlperiode,
  })

  const loading = explanations === undefined || hasAnyForPeriod === undefined

  return (
    <Panel title={t("mp.latestExplanations")} loading={loading}>
      {explanations?.length === 0 ? (
        <div className="flex flex-col gap-2">
          {/* Two empty states, one wording of each, one query result. Same
              exhaustiveness `vote-explanations-disclosure` documents: `false`
              means the deployment has not yet ingested §31 for this period,
              `true` means the source filed none for this MP. The
              undefined-while-loading arm is gated above. */}
          <Empty>
            {hasAnyForPeriod === false
              ? t("mp.explanationsPeriodNotBackfilled")
              : t("mp.noExplanations")}
          </Empty>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y">
            {explanations?.map((row) => (
              // The DIP activity id is the natural key (`upsertVoteExplanations`
              // upserts on it), so it is unique across the list — the panel is
              // per-MP, but the ids are global.
              <li
                key={row.dipAktivitaetId}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {/* `subject` is the *procedure's* title — what was voted on
                      — never the member's reason. The schema note on
                      `voteExplanations.subject` and the header of
                      convex/voteExplanations.ts are explicit about this
                      distinction, and it is why the field is not called
                      `title`. Falls back to a synthesised label if the
                      referenced Vorgang was published with none. */}
                  <span className="font-medium text-sm leading-snug">
                    {row.subject ?? t("mp.explanationSubjectMissing")}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatDate(row.date, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                  {row.protocolNumber !== null ? (
                    <span
                      className="tabular-nums"
                      // The visible label already reads correctly to a screen
                      // reader ("Protokoll 21/90"); `title` provides the long
                      // form on hover for a pointer user. Same trade-off as
                      // vote-explanations-disclosure.tsx.
                      title={t("voteExplanations.protocolLabel", {
                        number: row.protocolNumber,
                      })}
                    >
                      {t("voteExplanations.protocol", { number: row.protocolNumber })}
                    </span>
                  ) : null}
                  {row.sourceUrl !== null ? (
                    <SourceLink href={row.sourceUrl}>
                      {t("voteExplanations.sourceLink")}
                    </SourceLink>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {/* The rule the whole feature turns on, restated in the reader's
              language. Present whenever the list is — a reader who scanned the
              rows should not be able to leave without having read what a §31
              row is and is not. Same wording, same reason, as
              vote-explanations-disclosure.tsx. */}
          <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
            {t("voteExplanations.caveat")}
          </p>
        </>
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
      className={withGroup ? "text-muted-foreground text-xs" : "text-vote-abstain text-xs"}
    >
      {withGroup ? t("mp.partyLineWith") : t("mp.partyLineAgainst")}
    </span>
  )
}

/**
 * The chrome every "latest five" panel shares — one place that owns the
 * heading semantics all five inherit.
 *
 * ## Why `CardTitle as="h2"` here in particular
 *
 * The MP profile's `<h1>` is the member's name. The five panels — speeches,
 * motions, questions, votes, §31 declarations — are the primary landmark
 * sections *below* that heading, and a screen-reader reader navigating by
 * heading should be able to jump between them. Before F-05 was addressed
 * `CardTitle` was a `<div>`, so the profile's heading list had exactly one
 * entry (the name); five sections could only be reached by scrolling or
 * tabbing through content.
 *
 * Passing `as="h2"` here fixes it for all five panels in one place. The
 * primitive default remains `div` — see the note on `CardTitle` — so this
 * does not accidentally promote any other card on the site.
 */
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
        <CardTitle as="h2">{title}</CardTitle>
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

/**
 * A link to the source document, or nothing.
 *
 * ## Three ways this returns null, not one
 *
 * `href` is null — the caller could not build the URL (a Bundesrat paper
 * with no `wp/` prefix, a §31 declaration with no stored `sourceUrl`). That
 * is what `drucksachePdfUrl` and the ingest layer already communicate: a
 * disabled anchor is worse than no anchor, because it looks like a bug.
 *
 * `safeExternalUrl(href)` returns null — the URL parses but its scheme is
 * neither `http:` nor `https:`. A `javascript:` or `data:` URL landing in
 * `voteExplanations.sourceUrl` would be a data-side regression the ingest
 * pipeline is meant to catch (test_pipeline_sync.py:1374) but does not
 * catch on the render side; this is that guard. See F-01/F-02/F-10 of the
 * review — the ingest check is not a rendering-side guard.
 *
 * `href` did not survive URL parsing — it was empty, whitespace, or
 * malformed. Same reason as the scheme case: an `<a href="">` renders as a
 * link that reloads the current page, which is a broken outcome the caller
 * cannot see. `safeExternalUrl` folds all three into one null.
 *
 * ## `rel="noopener noreferrer"` matches every other outbound link on the site
 *
 * Was `rel="noreferrer"` alone. `noreferrer` in modern browsers implies
 * `noopener`, but stale WebView / very old Chromium still leak
 * `window.opener` under `noreferrer` alone (F-01 of the review). The other
 * 11 `target="_blank"` sites on this codebase carry both — this is the last
 * one that did not, and now does.
 */
function SourceLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const safe = safeExternalUrl(href)
  if (!safe) return null
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  )
}
