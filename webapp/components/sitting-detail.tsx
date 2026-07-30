"use client"

import { useQuery } from "convex/react"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { FraktionBadge } from "@/components/fraktion-badge"
import { useLocale } from "@/components/providers/locale-provider"
import {
  PeriodProvider,
  useMPHref,
  usePeriodHref,
} from "@/components/providers/period-provider"
import { SourceCoverageNote } from "@/components/source-coverage-note"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { VoteOutcomeBadge } from "@/components/vote-outcome-badge"
import { api } from "@/convex/_generated/api"
import { formatDate, formatNumber, protocolPdfUrl } from "@/lib/bundestag"
import { periodLink } from "@/lib/period"

/**
 * One plenary sitting, top to bottom, from what the source publishes.
 *
 * ## What is shown, and what is not
 *
 * Two claims, both truthful because they name a specific published record:
 *
 *  - **The speeches given in the sitting**, in the order the protocol prints
 *    them — `getSpeechesBySitting` sorts by `speechIndex` (§5.2 records why
 *    the segment, not the `<rede>` element, is the row). Each row names the
 *    speaker, their group as printed on the ballot, the topic when the
 *    protocol printed one, and the word count where it was parsed.
 *  - **The named ballots cast in the sitting**, in `abstimmnr` order. Each
 *    links to `/votes/[id]`, which is where the tally and the per-member
 *    records live.
 *
 * ## What is not shown, and why
 *
 * Anything not in the published record. The Bundestag does not publish
 * per-sitting duration, per-member attendance (§4.2 records the protocol XML
 * lists only the MPs who cast a vote), procedural totals, or a list of items
 * on the agenda beyond what each speech was tagged with.
 *
 * So the header carries: the sitting label, the date (drawn from the actual
 * records), and a deep link to the protocol PDF — that is the source that
 * carries what this page can't. No claim about duration, attendance rate,
 * agenda coverage, or "how many members spoke".
 *
 * ## The four states, honestly
 *
 * 1. **Loading** — both queries still resolving. Skeleton.
 * 2. **Populated** — at least one of speeches or ballots is non-empty. Render.
 * 3. **Period has no source at all for either surface, and no ballots** —
 *    speeches begin at WP18 (protocol XML) and named ballots begin
 *    2019-09-26 mid-WP19 (§4.4 XLSX). WP17 and earlier can have neither on
 *    this site regardless of whether the sitting happened, so an empty
 *    result is a fact about publishing rather than about the sitting.
 * 4. **Period is covered but the pair names nothing** — the URL is
 *    well-formed and the sources reach this period, but no speech or ballot
 *    references this sitting number. Either the sitting did not happen or
 *    the deployment has not backfilled it. States as much and offers the
 *    protocol PDF, which is the only source that answers "did this sitting
 *    exist" without any of our tables.
 */

export function SittingDetail({
  wahlperiode,
  sitzungnr,
}: {
  wahlperiode: number
  sitzungnr: number
}) {
  const { t, locale } = useLocale()
  const periods = useQuery(api.mps.listPeriods, {})
  const speeches = useQuery(api.speeches.getSpeechesBySitting, { wahlperiode, sitzungnr })
  const sheets = useQuery(api.votes.getVoteSheetsBySitting, { wahlperiode, sitzungnr })

  const loading = speeches === undefined || sheets === undefined

  // The reported date, from the actual rows. Speeches carry `protocolDate` and
  // ballots carry `date`; a sitting happens on one day, so these agree, but
  // "either" is the honest phrasing: prefer speeches (more granular), fall
  // back to ballots, and if neither exists the header omits a date rather
  // than showing a placeholder.
  const displayDate: string | null =
    speeches?.[0]?.speech.protocolDate ?? sheets?.[0]?.date ?? null

  const protocolHref = protocolPdfUrl(wahlperiode, sitzungnr)

  return (
    // `current` is threaded through so links out of this page (per-speech to
    // the MP profile, per-ballot to `/votes/[id]`) inherit the sitting's own
    // period. `PeriodProvider` at the top of the render tree because
    // `/sittings/[wp]/[nr]` is a fresh route with no upstream provider (see
    // the header of components/providers/period-provider.tsx on opt-in).
    <PeriodProvider wahlperiode={wahlperiode} current={periods?.current}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          {/* Back to the votes list of *this* period, not the current one —
              the closest sibling surface a reader coming from a vote row
              would recognise. A dedicated /sittings list does not exist and
              would need its own coverage story. */}
          <Link
            href={periodLink("/votes", wahlperiode, periods?.current ?? null)}
            className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
          >
            ← {t("sitting.backToVotes")}
          </Link>

          <div className="flex flex-col gap-3">
            <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
              {t("sitting.title", { wahlperiode, sitzungnr })}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
              {displayDate ? (
                <span className="tabular-nums">{formatDate(displayDate, locale)}</span>
              ) : null}
              {/* The protocol PDF. Always rendered — the URL is deterministic
                  (lib/bundestag.ts) and belongs to bundestag.de whether or
                  not this deployment holds any rows for the sitting. It is
                  the only source that answers "what happened at this
                  sitting" independently of our tables. */}
              <a
                href={protocolHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-foreground"
              >
                {t("sitting.openProtocol")}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        {loading ? (
          <SittingSkeleton />
        ) : speeches.length === 0 && sheets.length === 0 ? (
          <EmptySitting
            wahlperiode={wahlperiode}
            sitzungnr={sitzungnr}
            current={periods?.current ?? null}
            protocolHref={protocolHref}
          />
        ) : (
          <>
            <BallotsSection
              wahlperiode={wahlperiode}
              sheets={sheets}
              current={periods?.current ?? null}
            />
            <SpeechesSection
              wahlperiode={wahlperiode}
              speeches={speeches}
              current={periods?.current ?? null}
            />
          </>
        )}
      </div>
    </PeriodProvider>
  )
}

/** The two lists side by side, as loading blocks — one heading each so the
 * outline is stable across loading / loaded, which matters for a reader on a
 * screen reader who navigates by heading. */
function SittingSkeleton() {
  const { t } = useLocale()
  return (
    <output className="flex flex-col gap-6" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </output>
  )
}

/**
 * The sitting exists in the URL and nowhere in our data. Says why, honestly,
 * and points at the protocol PDF — the one source that can answer whether
 * the sitting happened, since our tables cannot.
 *
 * The two arms:
 *  - Speeches AND votes both unavailable for this period ⇒ "this site does
 *    not publish this period's speeches or ballots". Puts the coverage note
 *    for both.
 *  - Period covered but no rows for the pair ⇒ "this sitting number is not
 *    ingested here or does not exist" — but the protocol PDF above will
 *    resolve it either way, so the fallback link is the answer.
 */
function EmptySitting({
  wahlperiode,
  sitzungnr,
  current,
  protocolHref,
}: {
  wahlperiode: number
  sitzungnr: number
  current: number | null
  protocolHref: string
}) {
  const { t } = useLocale()
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-8 text-center">
        <div className="mx-auto flex max-w-md flex-col gap-2">
          <p className="font-medium">{t("sitting.emptyTitle", { wahlperiode, sitzungnr })}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("sitting.emptyBody")}
          </p>
        </div>
        {/* One or two coverage notes, only where they apply. The wahlperiode
            is the sitting's own — a reader is looking at WP17's sitting 42
            and this is the one place that can say "we do not have the
            protocol XML for that period, and no backfill will change that
            because bundestag.de has not published it". */}
        <div className="mx-auto flex max-w-md flex-col gap-2 text-left">
          <SourceCoverageNote source="speeches" wahlperiode={wahlperiode} current={current} />
          <SourceCoverageNote source="votes" wahlperiode={wahlperiode} current={current} />
        </div>
        <a
          href={protocolHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:text-foreground"
        >
          {t("sitting.openProtocol")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </CardContent>
    </Card>
  )
}

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
  dipVorgangId: string | null
}

/**
 * The named ballots the sitting held.
 *
 * Above the speeches section, deliberately: a reader arriving from a specific
 * ballot (via the sitting-label link on `/votes/[id]`, added in this branch)
 * wants the other ballots of that sitting first. The speeches carry topic
 * headings that scan quickly but many rows; the ballots are handful-sized and
 * each is a click-target for the page it came from.
 *
 * The list uses `VoteOutcomeBadge` so the same label a reader saw on the
 * originating page is what they see here. `voteHref` builds `/votes/[id]`
 * through the period provider so a WP19 sitting's ballots link to their WP19
 * detail pages.
 */
function BallotsSection({
  wahlperiode,
  sheets,
  current,
}: {
  wahlperiode: number
  sheets: readonly Sheet[]
  current: number | null
}) {
  const { t, locale } = useLocale()
  const periodHref = usePeriodHref()

  return (
    <section aria-labelledby="sitting-ballots-heading" className="flex flex-col gap-3">
      <h2 id="sitting-ballots-heading" className="font-semibold text-lg">
        {t("sitting.ballotsHeading")}
      </h2>
      {sheets.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-sm">{t("sitting.noBallots")}</p>
          {/* The XLSX corpus starts 2019-09-26. Before that, this section is
              structurally empty regardless of whether the sitting held
              divisions — which is exactly the case `SourceCoverageNote`
              carries the wording for. */}
          <SourceCoverageNote source="votes" wahlperiode={wahlperiode} current={current} />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="flex flex-col divide-y">
              {sheets.map((sheet) => (
                <li key={sheet.id} className="flex flex-col gap-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link
                      href={periodHref(`/votes/${encodeURIComponent(sheet.id)}`)}
                      className="font-medium text-sm leading-snug underline decoration-border underline-offset-4 hover:decoration-foreground"
                    >
                      {sheet.title}
                    </Link>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {t("votes.sitting", {
                        sitzungnr: sheet.sitzungnr,
                        abstimmnr: sheet.abstimmnr,
                      })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
                    <VoteOutcomeBadge result={sheet.result} locale={locale} />
                    <span className="tabular-nums">{formatDate(sheet.date, locale)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  )
}

type SpeechRow = {
  speech: {
    id: string
    wahlperiode: number
    sitzungnr: number
    mpInternalId: string
    speechIndex: number | null
    protocolDate: string
    protocolId: string | null
    wordCount: number | null
    topic: string | null
    createdAt: number
  }
  name: string
  fraktion: string
}

/**
 * The speech segments given in the sitting, in document order.
 *
 * `getSpeechesBySitting` already sorts by `speechIndex`, which is the position
 * of the segment within the protocol — see the speeches.ts header for why the
 * segment rather than the `<rede>` is the row. `speechIndex` is nullable in
 * the schema; a row without one sorts to the front there, which is what its
 * position in the sitting *is* if the protocol did not resolve one, so it is
 * left as-is.
 *
 * Each row links the speaker to their profile in the sitting's period, via
 * `useMPHref`. The topic is printed when present — it is the protocol's own
 * tag (`Tagesordnungspunkt 22`) rather than a Bundestrack derivation — and
 * every row shows a link to open the protocol PDF at the sitting (page anchor
 * is not carried; §5.1 verified the pattern for the whole document).
 */
function SpeechesSection({
  wahlperiode,
  speeches,
  current,
}: {
  wahlperiode: number
  speeches: readonly SpeechRow[]
  current: number | null
}) {
  const { t, locale } = useLocale()
  const mpHref = useMPHref()

  return (
    <section aria-labelledby="sitting-speeches-heading" className="flex flex-col gap-3">
      <h2 id="sitting-speeches-heading" className="font-semibold text-lg">
        {t("sitting.speechesHeading", { count: formatNumber(speeches.length, locale) })}
      </h2>
      {speeches.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-sm">{t("sitting.noSpeeches")}</p>
          {/* Protocol XML begins at WP18. For WP17 and earlier no speech is
              *ever* recorded here, regardless of the sitting — same wording
              the vote list uses on the profile, so a reader learns the shape
              once. */}
          <SourceCoverageNote source="speeches" wahlperiode={wahlperiode} current={current} />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="flex flex-col divide-y">
              {speeches.map((row) => (
                <li key={row.speech.id} className="flex flex-col gap-1.5 p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link
                      href={mpHref(row.speech.mpInternalId)}
                      className="font-medium text-sm underline decoration-border underline-offset-4 hover:decoration-foreground"
                    >
                      {row.name}
                    </Link>
                    {row.fraktion ? <FraktionBadge fraktion={row.fraktion} /> : null}
                  </div>
                  {row.speech.topic ? (
                    <span className="text-muted-foreground text-xs leading-snug">
                      {row.speech.topic}
                    </span>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                    {/* Word count is what scoring weights, not the number of
                        times an MP took the floor — §5.2's finding, restated
                        wherever a speech is shown (matches
                        components/mp-recent-records.tsx). Nullable: a segment
                        parsed before the word rule was applied has none. */}
                    {row.speech.wordCount !== null ? (
                      <span>
                        {t("mp.wordCount", {
                          count: formatNumber(row.speech.wordCount, locale),
                        })}
                      </span>
                    ) : null}
                    <a
                      href={protocolPdfUrl(row.speech.wahlperiode, row.speech.sitzungnr)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {t("mp.openProtocol")}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
