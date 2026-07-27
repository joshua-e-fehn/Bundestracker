"use client"

import { useQuery } from "convex/react"
import { ArrowRightIcon, CheckIcon, MinusIcon, TriangleAlert, XIcon } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { SectionHeading } from "@/components/section-heading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { formatCount, formatPercent } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"
import { hasRuledOut, refusalsOf } from "@/lib/inquiry"
import { type PartyKey, partyByKey, partyKeyColor, partyLabel } from "@/lib/parties"
import { cn } from "@/lib/utils"

/**
 * `/inquiry-quorum` — whether this Bundestag can compel a committee of inquiry.
 *
 * ## One page, two kinds of claim, and a visible seam between them
 *
 * Everything on this page is one of two things, and the design's whole job is to
 * keep a reader able to tell which they are looking at:
 *
 *  - **Counted.** Seats per Fraktion, the total, the quarter, every combination's
 *    sum and whether it clears the bar. All of it comes from the roster via
 *    `inquiry.getQuorum` — the one seating fact §9 of docs/api-research.md says
 *    is derivable.
 *  - **Maintained.** Which group has ruled out working with which. No Bundestag
 *    dataset records it (see `RULED_OUT` in lib/inquiry.ts), so it is a
 *    hand-kept editorial claim, exactly like `GOVERNING_PARTIES`.
 *
 * The site's premise is that every figure is checkable against an official
 * record. This page is the one place that premise needs an explicit exception,
 * so the exception is stated at full contrast above the matrix it applies to —
 * the treatment components/seating-notice.tsx gives §9's disclaimer, and for the
 * same reason: a caveat a reader might not scroll to is a caveat that did not
 * happen.
 *
 * That is also why the status column never collapses to one verdict. A row that
 * reaches the quarter and is politically ruled out says *both*, and names the
 * two groups — "reaches 361 seats; the CDU/CSU has ruled out cooperation with
 * Die Linke" is a sentence a reader can go and check, where a red cell is one
 * they must take on trust.
 *
 * ## Why the colours are three and not two
 *
 * Green / amber / neutral, and the middle one is the page's actual subject: a
 * combination that is arithmetically sufficient and politically excluded is not
 * the same as one that is simply too small, and painting both red would erase
 * the distinction the page exists to draw. Each status also carries an icon and
 * a word, so none of it rests on hue — the rule components/vote-result-badge.tsx
 * and the /about dissent cards already follow.
 *
 * A client component because it subscribes to Convex and is entirely translated;
 * the route above it is a server component, which is the split AGENTS.md asks
 * for.
 */

// --- status vocabulary -----------------------------------------------------

/**
 * The three things a combination can be, as a table.
 *
 * A table rather than branches for the reason `SEATING_MODES` is one: the three
 * differ in a label, an icon, a colour and a tone, and are otherwise identical.
 * Written as branches, this is where one status quietly loses its icon and
 * becomes colour-only.
 *
 * `blocked` deliberately takes the gold that carries every maintained-fact
 * warning on this site rather than the ballot red. Red on this page would read
 * as "rejected", which is the one thing that has *not* happened — nobody voted
 * these combinations down, and saying so in the colour reserved for a lost
 * division would misstate the finding. Gold is what the site already uses for
 * "this figure is ours, not the Bundestag's", which is precisely what the
 * blocked status is.
 */
type ComboStatus = "viable" | "blocked" | "short"

const STATUS_STYLES: Record<
  ComboStatus,
  { labelKey: TranslationKey; className: string; row: string }
> = {
  viable: {
    labelKey: "inquiry.status.viable",
    className: "border-transparent bg-muted text-vote-yes",
    row: "bg-vote-yes/5",
  },
  blocked: {
    labelKey: "inquiry.status.blocked",
    className: "border-transparent bg-muted text-gold",
    row: "bg-gold/5",
  },
  short: {
    labelKey: "inquiry.status.short",
    className: "border-border bg-muted text-muted-foreground",
    row: "",
  },
}

const STATUS_ICONS: Record<ComboStatus, typeof CheckIcon> = {
  viable: CheckIcon,
  blocked: XIcon,
  short: MinusIcon,
}

function statusOf(combination: { reaches: boolean; blocked: boolean }): ComboStatus {
  if (!combination.reaches) return "short"
  return combination.blocked ? "blocked" : "viable"
}

/**
 * The two row shapes the query returns, named once.
 *
 * Written inline at four call sites before this, which is how the opposition
 * scope's rows and the chamber's came to be described by two structural types
 * that had to be kept in step by hand. They are the same rows over different
 * subsets — see `oppositionScope` in lib/inquiry.ts.
 */
type GroupRow = {
  party: PartyKey
  fraktion: string
  seats: number
  share: number
  reachesAlone: boolean
  eligible: boolean
  role: "government" | "opposition" | "unknown"
}

type CombinationRow = {
  parties: PartyKey[]
  seats: number
  share: number
  reaches: boolean
  blocked: boolean
  blockedBy: Array<{ a: PartyKey; b: PartyKey }>
  viable: boolean
}

/**
 * Which set of groups the tables below are counting.
 *
 * ⚠ The distinction this page turns on, and the reason it is a control rather
 * than a fixed view. Over the whole chamber the quarter is reachable several
 * ways — the CDU/CSU alone holds 208 of 630 — and that answer is true and
 * useless: Art. 44(1) is a right *against* the government, and a government
 * does not compel an inquiry into itself. Restricted to the opposition, the
 * arithmetic binds.
 *
 * Both are shown rather than only the second, because the chamber-wide figure is
 * the one a sceptical reader will check first, and a page that quietly omitted
 * it would look like it had picked the subset that proved its point. Opening on
 * the opposition and letting the reader widen is the honest ordering: the
 * narrower scope is the finding, the wider one is available to verify it.
 */
type Scope = "opposition" | "chamber"

function StatusBadge({ status }: { status: ComboStatus }) {
  const { t } = useLocale()
  const style = STATUS_STYLES[status]
  const Icon = STATUS_ICONS[status]
  return (
    <Badge variant="outline" className={cn("gap-1", style.className)}>
      {/* `aria-hidden`: the word beside it already says which status this is.
          The icon is here so the distinction survives greyscale, not to be
          announced a second time. */}
      <Icon aria-hidden="true" />
      {t(style.labelKey)}
    </Badge>
  )
}

// --- shared bits -----------------------------------------------------------

/** A group's name in its own colour — the same treatment
 * components/party-badge.tsx gives a Fraktion, keyed by `PartyKey` because this
 * page has grouped by party and no longer holds one representative spelling.
 * `partyKeyColor` rather than the label round trip it documents. */
function PartyChip({ party, className }: { party: PartyKey; className?: string }) {
  const color = partyKeyColor(party)
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span style={{ color }} className="font-medium">
        {partyByKey(party).label}
      </span>
    </span>
  )
}

/** The groups of a combination, in the order the query returned them — left to
 * right along the political axis, matching the seat table above. `+` rather than
 * a comma: these are addends, and the row's next column is their sum. */
function CombinationLabel({ parties }: { parties: readonly PartyKey[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {parties.map((party, index) => (
        <span key={party} className="flex items-center gap-1.5">
          {index > 0 && (
            <span aria-hidden className="text-muted-foreground text-xs">
              +
            </span>
          )}
          <PartyChip party={party} />
        </span>
      ))}
    </span>
  )
}

// --- the maintained-fact notice --------------------------------------------

/**
 * The one sentence on this page that limits the site's own premise.
 *
 * Rendered at full contrast in a gold frame rather than as muted small print,
 * and unconditionally — the same shape and the same reasoning as
 * `SyntheticSeatingNotice`. Every other figure on Bundestracker is checkable
 * against a Bundestag record; the exclusion matrix is not, and a reader who
 * takes it for one has been misled by us rather than by their own carelessness.
 *
 * The date is part of the notice rather than a footnote. A maintained political
 * fact with no date is one nobody can tell is stale, and the whole class of
 * claim here — "party X has ruled out Y" — is exactly the kind that changes
 * without anyone updating a website.
 */
function MaintainedNotice({ asOf }: { asOf: string }) {
  const { t } = useLocale()
  return (
    <div
      role="note"
      className="flex gap-2.5 rounded-lg border border-gold/40 bg-gold/10 p-3.5 text-sm leading-relaxed"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
      <div className="flex flex-col gap-2">
        <p>{t("inquiry.maintainedNotice")}</p>
        <p className="text-muted-foreground text-xs">
          {t("inquiry.maintainedAsOf", { date: asOf })}
        </p>
      </div>
    </div>
  )
}

// --- sections --------------------------------------------------------------

/**
 * The threshold itself: two figures and the rule that connects them.
 *
 * The rounding is stated rather than performed silently. `ceil` is a legal
 * reading here, not a display choice (see `quorumThreshold`), and a reader
 * checking 630 ÷ 4 gets 157.5 — so the page says why the answer is 158 and not
 * 157, using the number one below the threshold as the evidence.
 */
function Threshold({ total, threshold }: { total: number; threshold: number }) {
  const { t, locale } = useLocale()

  return (
    <section aria-labelledby="inquiry-threshold" className="flex flex-col gap-4">
      <SectionHeading id="inquiry-threshold" titleKey="inquiry.threshold.title" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Figure labelKey="inquiry.threshold.seats" value={formatCount(total, locale)} />
        <Figure
          labelKey="inquiry.threshold.needed"
          value={formatCount(threshold, locale)}
          // The one figure on the page a reader is asked to hold on to, so it
          // carries the gold the site reserves for its own emphasis.
          accent
          noteKey="inquiry.threshold.rule"
        />
      </div>

      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        {t("inquiry.threshold.explainer", {
          threshold: formatCount(threshold, locale),
          total: formatCount(total, locale),
          below: formatCount(Math.max(0, threshold - 1), locale),
        })}
      </p>
    </section>
  )
}

function Figure({
  labelKey,
  value,
  noteKey,
  accent = false,
}: {
  labelKey: TranslationKey
  value: string
  noteKey?: TranslationKey
  accent?: boolean
}) {
  const { t } = useLocale()
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-muted-foreground text-xs uppercase tracking-wide">
          {t(labelKey)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span
          className={cn(
            "font-semibold text-3xl tabular-nums tracking-tight",
            accent ? "text-gold" : null,
          )}
        >
          {value}
        </span>
        {noteKey ? <span className="text-muted-foreground text-xs">{t(noteKey)}</span> : null}
      </CardContent>
    </Card>
  )
}

/**
 * Every Fraktion's seats, share, and distance from the quarter.
 *
 * The "to the quarter" column is the page's first finding and the reason this
 * table is not just a seat list: it prints, per group, the number of seats it
 * lacks. In this Bundestag every row carries one, which is the whole point —
 * the largest Fraktion is short by a third of the threshold again.
 *
 * The exclusions column is in this table too, rather than only in the matrix
 * below, because a reader scanning seat counts is exactly the reader forming
 * the combinations in their head. It is marked as maintained by the notice
 * above the section, and the header wording ("declared") does not present it as
 * a record.
 */
function Groups({ groups, threshold }: { groups: ReadonlyArray<GroupRow>; threshold: number }) {
  const { t, locale } = useLocale()
  const hasIneligible = groups.some((group) => !group.eligible)

  return (
    <section aria-labelledby="inquiry-groups" className="flex flex-col gap-4">
      <SectionHeading
        id="inquiry-groups"
        titleKey="inquiry.groups.title"
        subtitleKey="inquiry.groups.subtitle"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("inquiry.groups.column.group")}</TableHead>
            <TableHead className="text-right">{t("inquiry.groups.column.seats")}</TableHead>
            <TableHead className="text-right">{t("inquiry.groups.column.share")}</TableHead>
            <TableHead className="text-right">{t("inquiry.groups.column.toThreshold")}</TableHead>
            <TableHead>{t("inquiry.groups.column.role")}</TableHead>
            <TableHead>{t("inquiry.groups.column.ruledOut")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const refusals = refusalsOf(group.party)
            return (
              <TableRow key={group.party}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    {/* `partyLabel` on the stored spelling rather than the key's
                        canonical label: an unrecognised Fraktion shows the
                        string the record actually held, which is how a missing
                        matcher becomes visible instead of collapsing to a dash.
                        See lib/parties.ts. */}
                    <PartyChipWithLabel party={group.party} label={partyLabel(group.fraktion)} />
                    {!group.eligible && (
                      <Badge variant="outline" className="text-muted-foreground text-xs">
                        {t("inquiry.groups.notABloc")}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCount(group.seats, locale)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(group.share, locale)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {group.reachesAlone ? (
                    <span className="text-vote-yes">{t("inquiry.groups.reachesAlone")}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("inquiry.groups.short", {
                        count: formatCount(Math.max(0, threshold - group.seats), locale),
                      })}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {/* Reuses `seating.government` / `seating.opposition` rather
                      than adding a second pair: the /seating chamber's coalition
                      mode names the same two roles from the same table
                      (`GOVERNING_PARTIES`), and two spellings of one label are
                      how the two pages come to disagree about who governs. */}
                  <span
                    className={group.role === "government" ? "text-gold" : "text-muted-foreground"}
                  >
                    {t(
                      group.role === "government"
                        ? "seating.government"
                        : group.role === "opposition"
                          ? "seating.opposition"
                          : "seating.coalitionUnknown",
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {refusals.length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {t("inquiry.groups.noneDeclared")}
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-x-2 gap-y-1">
                      {refusals.map((other) => (
                        <PartyChip key={other} party={other} className="text-xs" />
                      ))}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Only when the roster actually has such a group. A note explaining an
          absent row would be a caveat about nothing. */}
      {hasIneligible && <CaveatNote>{t("inquiry.groups.notABlocNote")}</CaveatNote>}
    </section>
  )
}

/** A chip whose label comes from the stored spelling rather than the key — see
 * the call site. Separate from `PartyChip` rather than an optional prop on it,
 * because everywhere else on this page the party *is* the key and inventing a
 * spelling for it would be the round trip lib/parties.ts warns against. */
function PartyChipWithLabel({ party, label }: { party: PartyKey; label: string }) {
  const color = partyKeyColor(party)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span style={{ color }} className="font-medium">
        {label}
      </span>
    </span>
  )
}

/**
 * The combinations, and the toggle that decides how many of them are shown.
 *
 * Opens on the ones that reach the quarter, because that is the question, and
 * offers the rest rather than hiding them. Both halves matter: a table of only
 * the successes answers "who can" while silently discarding the near misses,
 * and the near misses are what a reader asking *why not* has come for. The
 * query returns the full list (see `quorumCombinations`), so the toggle is a
 * filter over data already in hand rather than a second request.
 */
function Combinations({ combinations }: { combinations: ReadonlyArray<CombinationRow> }) {
  const { t, locale } = useLocale()
  const [showAll, setShowAll] = useState(false)

  const reachingCount = useMemo(
    () => combinations.filter((entry) => entry.reaches).length,
    [combinations],
  )
  const shown = showAll ? combinations : combinations.filter((entry) => entry.reaches)

  return (
    <section aria-labelledby="inquiry-combos" className="flex flex-col gap-4">
      <SectionHeading
        id="inquiry-combos"
        titleKey="inquiry.combos.title"
        subtitleKey="inquiry.combos.subtitle"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("inquiry.combos.countReaching", {
            count: formatCount(reachingCount, locale),
            total: formatCount(combinations.length, locale),
          })}
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowAll((value) => !value)}>
          {t(showAll ? "inquiry.combos.showReaching" : "inquiry.combos.showAll")}
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("inquiry.combos.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inquiry.combos.column.combination")}</TableHead>
              <TableHead className="text-right">{t("inquiry.combos.column.seats")}</TableHead>
              <TableHead className="text-right">{t("inquiry.combos.column.share")}</TableHead>
              <TableHead>{t("inquiry.combos.column.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((combination) => {
              const status = statusOf(combination)
              return (
                <TableRow key={combination.parties.join("+")} className={STATUS_STYLES[status].row}>
                  {/* `whitespace-normal` overrides the cell's default nowrap:
                      a three-group label plus its reason is the one cell here
                      that must be allowed to wrap on a phone rather than
                      widening the table past the viewport. */}
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-1">
                      <CombinationLabel parties={combination.parties} />
                      {/* The reason, named rather than left to the colour. Each
                          blocking pair becomes a sentence a reader can check —
                          which is the difference between a claim and a cell. */}
                      {combination.blockedBy.map((pair) => (
                        <span key={`${pair.a}-${pair.b}`} className="text-muted-foreground text-xs">
                          {t("inquiry.status.blockedBy", {
                            a: partyByKey(pair.a).label,
                            b: partyByKey(pair.b).label,
                          })}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCount(combination.seats, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(combination.share, locale)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

/**
 * The exclusion matrix — the page's editorial half, fenced off as one.
 *
 * A grid rather than a list because the question it answers is a crossing one:
 * a reader picks two groups and looks up the cell. That is the case
 * `DefinitionList` in components/about-page.tsx explicitly says a table is
 * *right* for, as against its own definition lists.
 *
 * Every cell carries a `title` and an `sr-only` sentence naming both groups and
 * the answer, so the grid is readable without seeing it — a matrix whose meaning
 * lives entirely in cell position is unusable with a screen reader, and this one
 * is small enough (six by six) that spelling each cell out costs nothing.
 */
function Matrix({ parties }: { parties: readonly PartyKey[] }) {
  const { t } = useLocale()

  return (
    <section aria-labelledby="inquiry-matrix" className="flex flex-col gap-4">
      <SectionHeading
        id="inquiry-matrix"
        titleKey="inquiry.matrix.title"
        subtitleKey="inquiry.matrix.subtitle"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            {parties.map((party) => (
              <TableHead key={party} scope="col" className="text-center">
                <span className="text-xs" style={{ color: partyKeyColor(party) }}>
                  {partyByKey(party).label}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {parties.map((row) => (
            <TableRow key={row}>
              <TableCell scope="row" className="font-medium">
                <PartyChip party={row} />
              </TableCell>
              {parties.map((column) => {
                const self = row === column
                const ruledOut = !self && hasRuledOut(row, column)
                return (
                  <TableCell
                    key={column}
                    className="text-center"
                    title={
                      self
                        ? undefined
                        : t(ruledOut ? "inquiry.matrix.cellRuledOut" : "inquiry.matrix.cellOpen", {
                            a: partyByKey(row).label,
                            b: partyByKey(column).label,
                          })
                    }
                  >
                    {self ? (
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                    ) : (
                      <>
                        {/* The visible mark is a shape, not only a colour —
                            an X for a declared exclusion and a hyphen for
                            none. The sentence beside it is what a screen
                            reader announces. */}
                        {ruledOut ? (
                          <XIcon aria-hidden="true" className="mx-auto size-4 text-gold" />
                        ) : (
                          <MinusIcon
                            aria-hidden="true"
                            className="mx-auto size-4 text-muted-foreground/50"
                          />
                        )}
                        <span className="sr-only">
                          {t(ruledOut ? "inquiry.matrix.cellRuledOut" : "inquiry.matrix.cellOpen", {
                            a: partyByKey(row).label,
                            b: partyByKey(column).label,
                          })}
                        </span>
                      </>
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          <XIcon aria-hidden="true" className="size-3.5 text-gold" />
          {t("inquiry.matrix.legendRuledOut")}
        </span>
        <span className="flex items-center gap-1.5">
          <MinusIcon aria-hidden="true" className="size-3.5 text-muted-foreground/50" />
          {t("inquiry.matrix.legendOpen")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          {t("inquiry.matrix.legendSelf")}
        </span>
      </div>

      {/* What the table deliberately does *not* claim. A maintained fact is
          only worth keeping if it also stays silent where the record is thin —
          see the note on `RULED_OUT`. */}
      <CaveatNote>{t("inquiry.maintainedOmissions")}</CaveatNote>
    </section>
  )
}

/**
 * The scope control, and the sentence that states the lock in numbers.
 *
 * The two buttons are the page's main control. Each carries its own note rather
 * than relying on the labels, because "whole chamber" and "opposition only" do
 * not by themselves say why the second is the one that matters — and a reader
 * who takes the first for the answer has read the page backwards.
 *
 * `inquiry.scope.lock` is the finding as arithmetic: opposition total, the total
 * without the AfD, the gap, and the AfD's own distance from the bar. Four
 * numbers rather than an adjective, because each is checkable against the table
 * directly above it.
 */
function ScopeControl({
  scope,
  onScope,
  available,
}: {
  scope: Scope
  onScope: (scope: Scope) => void
  /** Whether the opposition scope exists for this period. False where the
   * coalition is unrecorded — see `oppositionScope`. */
  available: boolean
}) {
  const { t } = useLocale()

  const options: ReadonlyArray<{ id: Scope; labelKey: TranslationKey; noteKey: TranslationKey }> = [
    {
      id: "opposition",
      labelKey: "inquiry.scope.opposition",
      noteKey: "inquiry.scope.oppositionNote",
    },
    { id: "chamber", labelKey: "inquiry.scope.chamber", noteKey: "inquiry.scope.chamberNote" },
  ]

  if (!available) {
    return <CaveatNote>{t("inquiry.scope.unavailable")}</CaveatNote>
  }

  return (
    <div className="flex flex-col gap-3">
      {/* `radiogroup` rather than two buttons: these are two views of one
          question, exactly one of which is active, which is what a radio group
          means and what a screen reader announces. */}
      <div
        role="radiogroup"
        aria-label={t("inquiry.combos.column.status")}
        className="flex flex-wrap gap-2"
      >
        {/* Real `<input type="radio">` under a styled label, rather than a
            button carrying `role="radio"`. Biome rejects the latter and is
            right to: the native control brings arrow-key navigation within the
            group and a single tab stop for the whole set, which a pair of
            buttons with ARIA attributes does not. The input is visually hidden
            (`sr-only`) and the label is what is painted, so the appearance
            matches the outline/solid `Button` pair it replaces. */}
        {options.map((option) => (
          <label
            key={option.id}
            className={cn(
              "cursor-pointer rounded-md border px-3 py-1.5 font-medium text-sm transition-colors",
              "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              scope === option.id
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="inquiry-scope"
              value={option.id}
              checked={scope === option.id}
              onChange={() => onScope(option.id)}
              className="sr-only"
            />
            {t(option.labelKey)}
          </label>
        ))}
      </div>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        {t(options.find((option) => option.id === scope)?.noteKey ?? "inquiry.scope.chamberNote")}
      </p>
    </div>
  )
}

/**
 * The lock, stated as four numbers.
 *
 * Computed here from the rows already on screen rather than returned as a
 * sentence by the query, so every figure in it is one the reader can find in the
 * table above. The AfD is singled out because the exclusion table singles it
 * out — every other group has ruled it out, so it is the one group whose seats
 * the rest of the opposition cannot use.
 */
function LockSentence({
  opposition,
  total,
  threshold,
}: {
  opposition: { groups: ReadonlyArray<GroupRow>; seats: number }
  total: number
  threshold: number
}) {
  const { t, locale } = useLocale()

  const afdSeats = opposition.groups
    .filter((group) => group.party === "afd")
    .reduce((sum, group) => sum + group.seats, 0)
  // Every opposition seat that is not the AfD's, including unaffiliated members
  // — they hold seats and may sign, even though they are not a bloc.
  const withoutAfd = opposition.seats - afdSeats

  // Nothing to say where the AfD is not in opposition (or not in the chamber):
  // the sentence is specifically about the group the others have excluded.
  if (afdSeats === 0) return null

  return (
    <p className="max-w-prose text-base leading-relaxed">
      {t("inquiry.scope.lock", {
        oppositionSeats: formatCount(opposition.seats, locale),
        total: formatCount(total, locale),
        withoutAfd: formatCount(withoutAfd, locale),
        gap: formatCount(Math.max(0, threshold - withoutAfd), locale),
        afd: formatCount(afdSeats, locale),
        afdGap: formatCount(Math.max(0, threshold - afdSeats), locale),
      })}
    </p>
  )
}

/**
 * What the two halves add up to, in a sentence.
 *
 * The shortfall is the figure that turns this from a colour into a quantity: not
 * "the combinations are blocked" but "the largest unblocked combination is N
 * seats short". Null-checked rather than defaulted, because
 * `quorumSummary.shortfall` is deliberately null when a combination *does*
 * reach — a 0 there would render as "0 seats short", which reads as success.
 */
function Result({
  reaching,
  viableCount,
  shortfall,
}: {
  reaching: number
  viableCount: number
  shortfall: number | null
}) {
  const { t, locale } = useLocale()

  return (
    <section
      aria-labelledby="inquiry-result"
      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-5"
    >
      <h2 id="inquiry-result" className="font-semibold text-lg tracking-tight">
        {t("inquiry.result.title")}
      </h2>
      <p className="max-w-prose text-base leading-relaxed">
        {viableCount > 0
          ? t("inquiry.result.some", { count: formatCount(viableCount, locale) })
          : t("inquiry.result.none", {
              reaching: formatCount(reaching, locale),
              shortfall: formatCount(shortfall ?? 0, locale),
            })}
      </p>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        {t("inquiry.result.conclusion")}
      </p>
    </section>
  )
}

/** The explainer. Four titled points rather than a wall of prose, matching the
 * `Point` cards on /about — this is the section a reader arrives at without
 * knowing what the instrument is, and they should be able to skim to the part
 * they need. */
const EXPLAINER: ReadonlyArray<{ titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  { titleKey: "inquiry.explainer.quarterTitle", bodyKey: "inquiry.explainer.quarter" },
  { titleKey: "inquiry.explainer.powersTitle", bodyKey: "inquiry.explainer.powers" },
  { titleKey: "inquiry.explainer.limitsTitle", bodyKey: "inquiry.explainer.limits" },
  { titleKey: "inquiry.explainer.mattersTitle", bodyKey: "inquiry.explainer.matters" },
]

function Explainer() {
  const { t } = useLocale()

  return (
    <section aria-labelledby="inquiry-explainer" className="flex flex-col gap-4">
      <SectionHeading id="inquiry-explainer" titleKey="inquiry.explainer.title" />
      <p className="max-w-prose text-base leading-relaxed">{t("inquiry.explainer.what")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {EXPLAINER.map(({ titleKey, bodyKey }) => (
          <Card key={titleKey} size="sm">
            <CardHeader>
              <CardTitle>{t(titleKey)}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground leading-relaxed">
              {t(bodyKey)}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/seating">
            {t("inquiry.seeSeating")}
            <ArrowRightIcon />
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/about">
            {t("inquiry.seeAbout")}
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </section>
  )
}

// --- the page --------------------------------------------------------------

/**
 * The whole page for one period.
 *
 * Three states, like every other data view here: loading (skeletons),
 * loaded-and-empty (a message), loaded-with-rows. The empty case is not
 * defensive — a deployment whose pipeline has not run has no roster, and a
 * quorum page rendering a threshold of 0 would assert that one signature
 * compels an inquiry.
 *
 * The explainer renders in every state, including the empty one. It is prose
 * about the Grundgesetz rather than about this roster, so it is true whether or
 * not any data has loaded — and it is the half of the page a reader who arrives
 * with no context needs most.
 */
export function InquiryQuorum({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const quorum = useQuery(api.inquiry.getQuorum, { wahlperiode })

  // Opens on the opposition — the scope in which the arithmetic is a finding
  // rather than a triviality. See `Scope`.
  const [scope, setScope] = useState<Scope>("opposition")

  // In arc order and eligible only: the matrix asks "would these two sign
  // together", and `fraktionslos` cannot sign anything as a bloc — a row for it
  // would invite exactly the reading `isEligible` exists to refuse.
  const matrixParties = useMemo(
    () => (quorum?.groups ?? []).filter((group) => group.eligible).map((group) => group.party),
    [quorum],
  )

  if (quorum === undefined) {
    return (
      <output className="flex flex-col gap-4" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </output>
    )
  }

  if (quorum.totalSeats === 0) {
    return (
      <div className="flex flex-col gap-10">
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("common.noDataHint")}
        </p>
        <Explainer />
      </div>
    )
  }

  // Falls back to the chamber where the period's coalition is unrecorded, so a
  // historical Bundestag renders its arithmetic rather than an empty page — the
  // opposition scope is withheld, not substituted. See `oppositionScope`.
  const effectiveScope: Scope = quorum.opposition === null ? "chamber" : scope

  // The counts the tables and the result sentence read, chosen once. Doing this
  // per section is how the combination table and the conclusion under it come to
  // describe different scopes.
  const active =
    effectiveScope === "opposition" && quorum.opposition !== null
      ? {
          combinations: quorum.opposition.combinations,
          viableCount: quorum.opposition.viableCount,
          blockedCount: quorum.opposition.blockedCount,
          shortfall: quorum.opposition.shortfall,
        }
      : {
          combinations: quorum.combinations,
          viableCount: quorum.viableCount,
          blockedCount: quorum.blockedCount,
          shortfall: quorum.shortfall,
        }

  return (
    <div className="flex flex-col gap-10">
      {/* The finding, before the tables that support it. A reader who reads one
          paragraph should get the conclusion, not the method. */}
      <p className="max-w-prose text-base leading-relaxed sm:text-lg">{t("inquiry.lead")}</p>

      <Threshold total={quorum.totalSeats} threshold={quorum.threshold} />

      {/* Above the first table that carries an exclusion column, not merely
          above the matrix — the maintained half of the page starts here. */}
      <MaintainedNotice asOf={quorum.ruledOutAsOf} />

      {/* Always the full chamber: the seat table is the roster, and hiding the
          governing groups from it would leave the threshold unaccounted for —
          the quarter is a quarter of *all* members. The `role` column is what
          separates the two scopes here, rather than dropping rows. */}
      <Groups groups={quorum.groups} threshold={quorum.threshold} />

      {/* The control, and then the sentence it is the evidence for. Between the
          seat table and the combinations, because it changes what the table
          below it counts and a control placed after its effect reads as a
          footnote. */}
      <ScopeControl
        scope={effectiveScope}
        onScope={setScope}
        available={quorum.opposition !== null}
      />

      {quorum.opposition !== null && effectiveScope === "opposition" && (
        <LockSentence
          opposition={quorum.opposition}
          total={quorum.totalSeats}
          threshold={quorum.threshold}
        />
      )}

      <Combinations combinations={active.combinations} />

      <Result
        reaching={active.viableCount + active.blockedCount}
        viableCount={active.viableCount}
        shortfall={active.shortfall}
      />

      <Matrix parties={matrixParties} />
      <Explainer />

      {/* The period this page counted, stated rather than assumed. Every figure
          above is scoped to one Bundestag, and the header's chip is the only
          other place that says which. */}
      <p className="text-muted-foreground text-xs">
        {t("search.period", { wahlperiode: formatCount(quorum.wahlperiode, locale) })}
      </p>
    </div>
  )
}
