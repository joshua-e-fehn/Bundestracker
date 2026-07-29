"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { useState } from "react"
import { FraktionBadge } from "@/components/fraktion-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { useMPHref } from "@/components/providers/period-provider"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatCount } from "@/lib/format"

/**
 * Who put their name to one motion — disclosed on request, not on load.
 *
 * ## Why this is behind a toggle
 *
 * `getMotionSponsors` is one indexed range plus a roster lookup **per sponsor**,
 * and a Fraktion-wide Kleine Anfrage carries 28 of them in the sample measured
 * against production. A page of 25 motions that fetched sponsors eagerly would
 * open 25 subscriptions and resolve several hundred mandates before the reader
 * had decided which motion they cared about. So the query is `"skip"`ped until
 * the row is opened — Convex's own sentinel, so an unopened row costs nothing
 * and holds no subscription.
 *
 * That is also why this is a component rather than a field on the list query:
 * folding sponsors into `getMotionsPage` would make the page's cost a function
 * of how many co-signatories its motions happen to have, which is exactly the
 * unbounded read convex/motions.ts is arranged to avoid.
 *
 * ## The count is a lower bound, and the caveat is not optional
 *
 * DIP truncates `autoren_anzeige` at four entries with the real total in
 * `autoren_anzahl` (§3.4), so per-MP authorship has to come from `/aktivitaet` —
 * one record per MP per document, arriving over time. `convex/motions.ts` states
 * the consequence in as many words: the sponsors returned are the ones *known so
 * far*, a growing subset, and must not be presented as the signatory count. 12
 * of 40 recent WP21 motions had none recorded at all when this was measured.
 *
 * A number with that property cannot be shown bare. So the caveat renders
 * whenever the list does, and the empty state says "none recorded" rather than
 * "no co-signatories" — the same distinction between an absent record and an
 * absent fact that components/source-coverage-note.tsx exists for.
 *
 * ## Every name links to its profile, in the page's period
 *
 * Through `useMPHref`, like the nine other lists on this site, so a sponsor on
 * `/motions?wp=19` opens that member's WP19 profile rather than a 404. See
 * components/providers/period-provider.tsx for why that is a context rather than
 * a prop.
 */
export function MotionSponsors({ motionId }: { motionId: string }) {
  const { t, locale } = useLocale()
  const mpHref = useMPHref()
  const [open, setOpen] = useState(false)

  // `"skip"` while closed: no subscription, no read. See the header.
  const sponsors = useQuery(
    api.motions.getMotionSponsors,
    open ? { motionId: motionId as Id<"motions"> } : "skip",
  )

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        // `aria-expanded` rather than only a caret: the control's state is the
        // whole of what it communicates, and a glyph carries none of it to a
        // screen reader.
        aria-expanded={open}
        className="w-fit rounded-md text-muted-foreground text-xs underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? t("motions.sponsorsHide") : t("motions.sponsorsShow")}
      </button>

      {open ? (
        sponsors === undefined ? (
          <output className="text-muted-foreground text-xs" aria-live="polite">
            {t("motions.sponsorsLoading")}
          </output>
        ) : sponsors.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("motions.sponsorsNone")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">
              {t("motions.sponsors")} — {""}
              {t("motions.sponsorsCount", { count: formatCount(sponsors.length, locale) })}
            </p>
            <ul className="flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0">
              {sponsors.map((sponsor) => (
                <li key={sponsor.mpInternalId} className="flex items-center gap-1.5 text-xs">
                  <Link
                    href={mpHref(sponsor.mpInternalId)}
                    className="rounded-md underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {sponsor.name}
                  </Link>
                  {/* Only where the roster resolved one. `mpLabel` falls back to
                      an empty string for a mandate it could not find (§7.3's
                      Stammdaten lag), and a badge with no group in it would read
                      as a member with no group. */}
                  {sponsor.fraktion ? <FraktionBadge fraktion={sponsor.fraktion} /> : null}
                </li>
              ))}
            </ul>
            {/* Never without this. The number above is a lower bound by
                construction — see the header, and convex/motions.ts. */}
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("motions.sponsorsCaveat")}
            </p>
          </div>
        )
      ) : null}
    </div>
  )
}
