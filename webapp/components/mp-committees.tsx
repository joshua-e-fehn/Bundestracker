"use client"

import { useQuery } from "convex/react"
import { useLocale } from "@/components/providers/locale-provider"
import { SourceCoverageNote } from "@/components/source-coverage-note"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/convex/_generated/api"
import { formatDate } from "@/lib/bundestag"

/**
 * This MP's committee seats.
 *
 * The empty state is the reason this is its own component. Committee data is
 * **current-period only** — all 1 744 entries in the dump belong to WP21 by
 * design (§6.4 of docs/api-research.md) — so for an earlier period the answer
 * is always empty, and `getCommittees` in convex/committees.ts warns in as many
 * words that "the UI must not present emptiness as a finding". An MP who sat on
 * four committees in WP20 renders identically to one who sat on none.
 *
 * So the empty message says "not recorded", never "none", and the caveat under
 * it says why. That is the same wording the score panel attaches to the
 * committees row; both come from `score.caveat.committees`.
 */
export function MPCommittees({
  mpInternalId,
  wahlperiode,
  current,
}: {
  mpInternalId: string
  wahlperiode: number
  /** The sitting period, so the empty state can name the *right* reason. See
   * the note on the empty branch below. */
  current?: number | null
}) {
  const { t, locale } = useLocale()
  const committees = useQuery(api.committees.getCommitteesByMP, { mpInternalId, wahlperiode })

  return (
    <Card>
      <CardHeader>
        {/* `as="h2"` — sibling landmark of the biography, contact and score
            panels on the MP profile. F-05 of the review, applied through
            the shared `CardTitle` primitive. */}
        <CardTitle as="h2">{t("mp.committees")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {committees === undefined ? (
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        ) : committees.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">{t("mp.noCommittees")}</p>
            {/* Two different reasons for one empty list, and the page can now
                be on either. On the current period the caveat is the general
                one this card has always carried — the dump is a snapshot and a
                member may genuinely hold no seat. On a *closed* period the
                answer is sharper and permanent: nothing was ever published, for
                anyone, so every profile in WP19 shows this and none of them is
                a finding. `SourceCoverageNote` renders the second and nothing
                on the first, which is why the general caveat stays below it
                rather than being replaced. */}
            <SourceCoverageNote source="committees" wahlperiode={wahlperiode} current={current} />
            <p className="text-muted-foreground text-xs">{t("score.caveat.committees")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {committees.map((membership) => (
              <li
                key={`${membership.committeeName}-${membership.role ?? ""}`}
                className="flex flex-col gap-0.5"
              >
                <span className="font-medium text-sm leading-snug">{membership.committeeName}</span>
                {membership.role ? (
                  <span className="text-muted-foreground text-xs">{membership.role}</span>
                ) : null}
                {membership.startDate ? (
                  <span className="text-muted-foreground text-xs">
                    {formatDate(membership.startDate, locale)} –{" "}
                    {/* An open `endDate` means serving, same convention as the
                        mandate span; a blank would read as a missing date. */}
                    {membership.endDate
                      ? formatDate(membership.endDate, locale)
                      : t("mp.stillServing")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
