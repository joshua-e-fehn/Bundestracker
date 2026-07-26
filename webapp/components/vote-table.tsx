"use client"

import Link from "next/link"
import { useDeferredValue, useMemo, useState } from "react"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { RebelVoteBadge } from "@/components/rebel-vote-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Vote, VoteResultBadge } from "@/components/vote-result-badge"
import type { TranslationKey } from "@/lib/i18n"
import { foldName } from "@/lib/search"

/**
 * How every MP voted in one ballot — search, filter by group, filter by
 * position, show only dissenters.
 *
 * ## All 630 rows arrive at once, and that is the right call here
 *
 * `getVoteSheetById` returns the whole ballot. A ballot is bounded by the
 * chamber — 630 records, not a table that grows — and every filter here is a
 * predicate over the set the reader is looking at. Paging on the server would
 * mean a round trip per keystroke and a "dissenters only" filter that could only
 * see the current page, which is the same mistake `RankingsTable` avoids in the
 * opposite direction: there the population is ranked and paged server-side
 * because a page-local sort would produce page-local ranks.
 *
 * Rows are still paged for rendering — 630 table rows is a slow paint on a
 * phone, and nobody reads them all in order.
 *
 * ## Dissent is not recomputed here
 *
 * `row.rebel` comes from the server. The rule has three exceptions
 * (convex/votes.ts `isRebel`) and deriving it in the browser from `vote !==
 * groupVote` would eventually flag an absence or a tied group — a public
 * accusation produced by a rendering shortcut. See components/rebel-vote-badge.
 */

/** Sentinel for "no filter" — Radix reserves the empty string on `SelectItem`
 * to mean "clear the value", so the absence of a filter needs a real name. */
const ANY = "__any__"

/** Rows per rendered page. */
const PAGE_SIZE = 50

/** The five positions, for the filter. Ordered as the result is read out. */
const VOTE_OPTIONS = [
  { value: "yes", labelKey: "vote.yes" },
  { value: "no", labelKey: "vote.no" },
  { value: "abstain", labelKey: "vote.abstain" },
  { value: "invalid", labelKey: "vote.invalid" },
  { value: "absent", labelKey: "vote.absent" },
] as const satisfies ReadonlyArray<{ value: Vote; labelKey: TranslationKey }>

/**
 * The group a row belongs to, as *this ballot* recorded it.
 *
 * Module scope rather than a closure inside the component: it depends on
 * nothing but its argument, and defining it per render would make it a
 * dependency of every `useMemo` below that calls it — re-filtering 630 rows on
 * every keystroke that changed nothing else.
 */
function groupOf(row: VoteTableRow): string {
  return row.partyAtVote ?? row.fraktion
}

export type VoteTableRow = {
  mpInternalId: string
  name: string
  fraktion: string
  vote: Vote
  /** The group printed on the ballot, which is not always the MP's current one
   * (§6.4). Shown in preference to `fraktion` so a historical ballot renders as
   * it was, not as things later became. */
  partyAtVote: string | null
  remark: string | null
  groupVote: { vote: Vote; share: number } | null
  rebel: boolean
}

export function VoteTable({ rows }: { rows: ReadonlyArray<VoteTableRow> }) {
  const { t, locale } = useLocale()
  const [search, setSearch] = useState("")
  const [fraktion, setFraktion] = useState<string>(ANY)
  const [voteFilter, setVoteFilter] = useState<string>(ANY)
  const [rebelsOnly, setRebelsOnly] = useState(false)
  const [page, setPage] = useState(0)

  // Typing re-filters 630 rows per keystroke; deferring keeps the input
  // responsive and lets React drop intermediate results.
  const deferredSearch = useDeferredValue(search)

  const fraktionen = useMemo(
    () => [...new Set(rows.map(groupOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")),
    [rows],
  )

  const rebelCount = useMemo(() => rows.filter((row) => row.rebel).length, [rows])

  const filtered = useMemo(() => {
    const needle = foldName(deferredSearch)
    return rows.filter((row) => {
      if (fraktion !== ANY && groupOf(row) !== fraktion) return false
      if (voteFilter !== ANY && row.vote !== voteFilter) return false
      if (rebelsOnly && !row.rebel) return false
      if (needle && !foldName(row.name).includes(needle)) return false
      return true
    })
  }, [rows, deferredSearch, fraktion, voteFilter, rebelsOnly])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Clamped rather than reset in an effect: a filter that shortens the list
  // below the current page would otherwise render one frame of an empty table
  // before correcting itself.
  const currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  /** Every filter change returns to the first page — a page number is an offset
   * into a particular list, and carrying it across a filter is how a reader
   * lands on an empty page that looks like no data. */
  function change<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setPage(0)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <label htmlFor="vote-table-search" className="text-muted-foreground text-xs">
            {t("common.search")}
          </label>
          <Input
            id="vote-table-search"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
            placeholder={t("votes.searchMembers")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="vote-table-fraktion-label" className="text-muted-foreground text-xs">
            {t("votes.filterFraktion")}
          </span>
          <Select value={fraktion} onValueChange={change(setFraktion)}>
            {/* `aria-labelledby` rather than a wrapping <label>: Radix renders
                the trigger as a button, which an implicit label does not reach.
                Same reasoning as components/rankings-filters.tsx. */}
            <SelectTrigger
              id="vote-table-fraktion"
              aria-labelledby="vote-table-fraktion-label"
              className="w-[13rem]"
            >
              <SelectValue placeholder={t("votes.allFraktionen")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("votes.allFraktionen")}</SelectItem>
              {fraktionen.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="vote-table-vote-label" className="text-muted-foreground text-xs">
            {t("votes.filterVote")}
          </span>
          <Select value={voteFilter} onValueChange={change(setVoteFilter)}>
            <SelectTrigger
              id="vote-table-vote"
              aria-labelledby="vote-table-vote-label"
              className="w-[11rem]"
            >
              <SelectValue placeholder={t("votes.allVotes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("votes.allVotes")}</SelectItem>
              {VOTE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Hidden when nobody dissented, rather than shown and selecting
            nothing — the same rule the rankings filters follow. */}
        {rebelCount > 0 ? (
          <Button
            variant={rebelsOnly ? "default" : "outline"}
            size="sm"
            aria-pressed={rebelsOnly}
            onClick={() => change(setRebelsOnly)(!rebelsOnly)}
          >
            {t("votes.rebels")} ({rebelCount})
          </Button>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        {t("common.showingCount", { shown: visible.length, total: filtered.length })}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("votes.noMembers")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("votes.columnMember")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("mp.party")}</TableHead>
                  <TableHead>{t("votes.columnVote")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("votes.groupMajority")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("votes.columnRemark")}</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.mpInternalId}>
                    <TableCell>
                      <Link
                        href={`/mps/${encodeURIComponent(row.mpInternalId)}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      {/* The group repeats under the name where its own column
                          is hidden — without it a name on a phone has no
                          context at all. */}
                      <span className="sm:hidden">
                        <PartyBadge fraktion={groupOf(row)} className="mt-1" />
                      </span>
                    </TableCell>

                    <TableCell className="hidden sm:table-cell">
                      <PartyBadge fraktion={groupOf(row)} />
                    </TableCell>

                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <VoteResultBadge vote={row.vote} locale={locale} />
                        {row.rebel ? <RebelVoteBadge locale={locale} compact /> : null}
                      </span>
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      {row.groupVote === null ? (
                        <span className="text-muted-foreground text-xs">
                          {t("votes.groupMajorityNone")}
                        </span>
                      ) : (
                        <VoteResultBadge vote={row.groupVote.vote} locale={locale} />
                      )}
                    </TableCell>

                    {/* The sheet's `Bemerkung` — the published reason an absence
                        was excused, e.g. "gesetzlicher Mutterschutz". Shown
                        because an unexplained absence and an excused one are
                        different facts. */}
                    <TableCell className="hidden max-w-[16rem] truncate text-muted-foreground text-xs lg:table-cell">
                      {row.remark ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pages > 1 ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t("common.previous")}
              </Button>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("common.page", { page: currentPage + 1, pages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {t("common.next")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
