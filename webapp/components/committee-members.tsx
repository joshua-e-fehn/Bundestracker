"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { useMPHref, usePeriod } from "@/components/providers/period-provider"
import { SourceCoverageNote } from "@/components/source-coverage-note"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"
import { sourceUnavailable } from "@/lib/period"

/**
 * One committee's membership — the body of `/committees/[id]`.
 *
 * ## Three states this must keep separate
 *
 *  - **Source unavailable** (`wahlperiode < current`) — a closed period, and
 *    `sourceCoverage("committees", …)` says `none`. The list is empty for a
 *    permanent structural reason: MdB-Stammdaten publishes committee
 *    membership for the sitting Bundestag alone (§6.3 of
 *    docs/api-research.md; convex/committees.ts opens with the same note).
 *    We render `SourceCoverageNote` and stop — no "no members" line under it,
 *    because there *are* members, they are just not machine-readable here.
 *  - **Current period, no rows** — the committee name in the URL matches
 *    nothing in the loaded roster. That is almost always a stale link (a
 *    committee renamed mid-period, or a typo); the note names it plainly and
 *    does not claim the URL is invalid. Not a 404: the address is a
 *    well-formed identifier, and the reader's fix is a smaller step than
 *    correcting a URL.
 *  - **Current period, rows loaded** — the roster. Every row links back to
 *    the MP's profile via `useMPHref`, which carries the page's period so
 *    a WP21 committee link opens a WP21 profile.
 *
 * ## Roles are shown when the source records one
 *
 * `committeeMemberships.role` is nullable in the schema — Stammdaten sets it
 * per row, and a row without one is authoritatively "no role recorded",
 * distinct from "Ordentliches Mitglied" (which is *also* what the source
 * writes when it wants to say full member). So the column renders the raw
 * string when present and the neutral placeholder from
 * `committees.detail.roleUnspecified` when absent. Not translated: role
 * values are proper German nouns from the source (`Vorsitzender`, `Obmann`,
 * `Stellvertretendes Mitglied`), and a translation would either drop
 * distinctions or invent them.
 *
 * ## Chair-appears-twice trap, handled at storage
 *
 * Stammdaten emits a chair as both `Vorsitzender` and `Ordentliches
 * Mitglied` on the same committee (§6.3, verified on Armin Laschet). The
 * upsert key `(mpInternalId, wahlperiode, committeeName)` collapses that to
 * one row — see convex/committees.ts. So the list is one row per person and
 * a chair is not double-listed here; the *role* column shows whichever value
 * the source wrote last, which is what the storage layer preserves.
 */
export function CommitteeMembers({
  committeeName,
  wahlperiode,
}: {
  committeeName: string
  wahlperiode: number
}) {
  const { t, locale } = useLocale()
  const { current } = usePeriod()
  const mpHref = useMPHref()
  const members = useQuery(api.committees.getCommitteeMembers, { wahlperiode, committeeName })

  // First state: the source does not publish committees for this period.
  // Detect this synchronously from the URL — no need to wait for the empty
  // roster to come back. Otherwise the reader briefly sees the roster
  // skeleton for a query that will never yield rows.
  if (sourceUnavailable("committees", wahlperiode, current)) {
    return (
      <div className="flex flex-col gap-4">
        <SourceCoverageNote source="committees" wahlperiode={wahlperiode} current={current} />
        {/* A second sentence sharpening the first — the caveat is the
            general rule, this names why *this page* is empty as a result. */}
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("committees.detail.unavailable")}
        </p>
      </div>
    )
  }

  if (members === undefined) {
    return (
      <output className="flex flex-col gap-2" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        {Array.from({ length: 8 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
          <div key={index} className="h-11 animate-pulse rounded-md bg-muted" />
        ))}
      </output>
    )
  }

  // Second state: a well-formed URL that does not match any committee in the
  // loaded (current) period. Distinct from the unavailable case above — the
  // source *is* published here, we simply hold no row by this name.
  if (members.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("committees.detail.unknownCommittee")}
      </p>
    )
  }

  // Third state: the roster.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-xl tracking-tight">{t("committees.detail.rosterTitle")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("committees.detail.subtitle", { wahlperiode: formatCount(wahlperiode, locale) })}
        </p>
      </div>

      <p className="text-muted-foreground text-sm">
        {members.length === 1
          ? t("committees.memberCountOne")
          : t("committees.memberCount", { count: formatCount(members.length, locale) })}
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("committees.detail.column.member")}</TableHead>
              {/* The Fraktion column hides on the narrowest widths — a
                  small screen puts the badge under the name inside the
                  member cell, so nothing is lost. */}
              <TableHead className="hidden sm:table-cell">
                {t("committees.detail.column.faction")}
              </TableHead>
              <TableHead className="hidden md:table-cell">
                {t("committees.detail.column.role")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.mpInternalId}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Link
                      href={mpHref(member.mpInternalId)}
                      className="font-medium hover:underline"
                    >
                      {member.name}
                    </Link>
                    {/* Fraktion under the name on small screens where the
                        column is hidden. `sm:hidden` inverts the column's
                        `hidden sm:table-cell`. */}
                    <div className="sm:hidden">
                      <PartyBadge fraktion={member.fraktion} />
                    </div>
                    {/* Role under the name on medium-and-below where its
                        column is hidden, so it never disappears entirely. */}
                    {member.role !== null && (
                      <span className="text-muted-foreground text-xs md:hidden">
                        {member.role}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <PartyBadge fraktion={member.fraktion} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground text-sm md:table-cell">
                  {member.role ?? (
                    <span className="text-muted-foreground/60">
                      {t("committees.detail.roleUnspecified")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
