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
  // Derived from the motion id rather than `useId`, on the pattern
  // components/activity-feed-item.tsx:192 sets: the id is already unique and
  // stable across renders, and using it directly means the `aria-controls`
  // relationship is self-documenting rather than opaque. The `aria-expanded`
  // alone is what /components/activity-feed-item.tsx: 260-269 warns against —
  // a screen reader hears "expanded" with no way to know what was expanded
  // or where to look.
  const panelId = `motion-sponsors-${motionId}`

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
        // screen reader. `aria-controls` points at the panel the state is
        // *about*, matching the pattern components/activity-feed-item.tsx
        // uses for its actors disclosure — a button that says "expanded"
        // without saying what is expanded is what fails on JAWS/NVDA.
        aria-expanded={open}
        aria-controls={panelId}
        className="w-fit rounded-md text-muted-foreground text-xs underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? t("motions.sponsorsHide") : t("motions.sponsorsShow")}
      </button>

      {/* The panel the toggle names, whether or not it is open. Keeping the
          element mounted with an id — even collapsed to nothing — is what
          keeps `aria-controls` valid at every state: an id that resolves to
          nothing tells a screen reader the association is broken, which is
          worse than no association at all. No `role`: the pattern
          components/activity-feed-item.tsx uses for its actors disclosure
          leaves the wrapper untyped and lets its children carry the
          semantics; adding a role here would either promote the panel to a
          landmark (cluttering the page's landmark map with one per motion
          row) or restate what the child list already conveys.
          `hidden` while collapsed rather than an unstyled empty div: the
          parent above is a `flex flex-col gap-2` so an always-mounted
          empty child still takes an 8 px gap under the toggle. Across 25
          rows that would add ~200 px of dead scroll to the list. `hidden`
          removes the element from layout (display: none) while leaving
          the `id` resolvable to `aria-controls` — which is what
          matters. */}
      <div id={panelId} hidden={!open}>
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
    </div>
  )
}
