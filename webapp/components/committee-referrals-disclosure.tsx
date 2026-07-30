"use client"

import { useQuery } from "convex/react"
import { useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { api } from "@/convex/_generated/api"
import { formatCount, formatDateShort } from "@/lib/format"

/**
 * Committees a bill was sent to — motion-level, disclosed on request.
 *
 * ## What this shows and what it does not
 *
 * A referral (`Ueberweisung`, §3.3 of docs/api-research.md) says a step of the
 * procedure sent the bill to a named committee, marks which committee leads,
 * and carries the referring document reference. **It names no person.** So this
 * component tells a reader which committees a motion travels through — that is
 * a fact about the *bill*, not evidence of any MP's committee work. The label
 * inside says so in plain language, because the temptation to read it as the
 * latter is specific and the referrals feature explicitly refuses to structure
 * itself around a per-MP index (convex/committeeReferrals.ts).
 *
 * ## Behind a toggle, like motion-sponsors
 *
 * `getReferralsByMotion` is one indexed range per motion. A page of 25 motions
 * that fetched referrals eagerly would open 25 subscriptions before the reader
 * had decided which motion they cared about. `useQuery` is `"skip"`ped while
 * closed — Convex's own sentinel, so an unopened row costs nothing and holds
 * no subscription — the exact contract components/motion-sponsors.tsx documents
 * for its own reasons.
 *
 * ## The empty state, honestly labelled
 *
 * `hasAnyForPeriod` is threaded down from the caller, which reads
 * `getReferralCoverage` once at page level rather than once per row. When
 * false, the empty state says the period's referrals have not been ingested
 * yet (a fixable fact about this deployment). When true, an empty answer for
 * one motion means no committee referral was published for it — measured over
 * the WP18–21 samples, that is roughly 90–95 % of positions (see the header of
 * convex/committeeReferrals.ts). Same distinction, and the same reasoning, as
 * components/source-coverage-note.tsx.
 */
export function CommitteeReferralsDisclosure({
  motionId,
  dipVorgangId,
  hasAnyForPeriod,
}: {
  /** The motion's own Convex id. Threaded in for the panel id alone: the
   * Vorgang id is null for Drucksache-only rows, and any number of such rows
   * can sit on one page — a fallback sentinel would then collide across
   * every one of them, so a per-motion stable value is required. */
  motionId: string
  /** The motion's DIP procedure id. Null means the row was ingested via its
   * Drucksache alone and no procedure resolved — the referral index is keyed
   * by Vorgang, so there is no honest read to make. */
  dipVorgangId: string | null
  /** True when the period holds any referral at all —
   * `getReferralCoverage(...).referrals > 0`. Passed in rather than fetched
   * per row so the coverage query runs once at page level. `undefined` while
   * the caller's coverage query is still resolving. */
  hasAnyForPeriod: boolean | undefined
}) {
  const { t, locale } = useLocale()
  const [open, setOpen] = useState(false)

  // Keyed on the *motion's* Convex id, not the Vorgang id. The Vorgang id is
  // null for Drucksache-only rows, and a nullable field cannot carry an id
  // uniqueness invariant: three such rows on one page all fell back to the
  // same `committee-referrals-unlinked` string, producing three
  // `aria-controls="committee-referrals-unlinked"` buttons pointing at three
  // `#committee-referrals-unlinked` panels — an HTML id-uniqueness violation
  // and an ambiguous screen-reader association. `motionId` is unique across
  // the corpus by construction (it is the Convex id the list row already
  // holds), so this is collision-free without another lookup.
  const panelId = `committee-referrals-${motionId}`

  const referrals = useQuery(
    api.committeeReferrals.getReferralsByMotion,
    open && dipVorgangId !== null ? { dipVorgangId } : "skip",
  )

  // `loading` covers both the per-motion referrals query AND the page-level
  // coverage query while either is in flight — the empty state cannot
  // render `emptyNoReferral` until both have resolved, because coverage is
  // what tells "no referral for this motion" from "period not backfilled".
  // A transient wrong claim about the motion was the failure mode this
  // guard prevents. On the unlinked branch there is no per-motion query
  // to wait on, so coverage alone gates the panel's readiness.
  const loading =
    (dipVorgangId !== null && referrals === undefined) || hasAnyForPeriod === undefined
  const list = referrals ?? []

  // One show label for both arms — the toggle names its subject
  // ("committee referrals"), not its state, so a linked and an unlinked
  // motion offer coherent show/hide labels rather than "link missing"
  // toggling to "hide committee referrals". The unlinked panel body
  // explains why there is nothing to list.
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        // The pattern components/activity-feed-item.tsx and
        // components/motion-sponsors.tsx set for every disclosure on this
        // site: `aria-expanded` says what state the control is in, and
        // `aria-controls` says what it operates on. A caret alone would
        // carry neither — see the warning in activity-feed-item.tsx.
        aria-expanded={open}
        aria-controls={panelId}
        className="w-fit rounded-md text-muted-foreground text-xs underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? t("referrals.hide") : t("referrals.show")}
      </button>

      {/* Always mounted with the id so `aria-controls` above always resolves —
          same shape motion-sponsors uses. `hidden` while collapsed removes it
          from layout so the parent's `gap` does not accumulate under every
          closed disclosure on the page. */}
      <div id={panelId} hidden={!open}>
        {open ? (
          dipVorgangId === null ? (
            // The unlinked arm. `getReferralsByMotion` needs a Vorgang, and
            // the schema note on `motions` records that either a Vorgang or
            // a Drucksache id may be present — so a Drucksache-only row is a
            // real case, not a data error, and it deserves a truthful line.
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("referrals.unlinked")}
            </p>
          ) : loading ? (
            <output className="text-muted-foreground text-xs" aria-live="polite">
              {t("referrals.loading")}
            </output>
          ) : list.length === 0 ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {hasAnyForPeriod === false
                ? t("referrals.emptyPeriodNotBackfilled")
                : t("referrals.emptyNoReferral")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground text-xs">
                {t("referrals.count", { count: formatCount(list.length, locale) })}
              </p>
              <ul className="flex list-none flex-col gap-1.5 p-0">
                {list.map((row) => (
                  // The natural key. A step refers a bill to several
                  // committees at once, so `dipVorgangspositionId` alone is
                  // not unique; the pair matches the schema's index.
                  <li
                    key={`${row.dipVorgangspositionId}:${row.committeeName}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                  >
                    <span className="font-medium text-foreground">{row.committeeName}</span>
                    {/* Three states, three different claims, kept apart in
                        the label the reader sees. `leadCommittee === true`
                        is the source saying "this one leads"; `false` is
                        the source saying "co-advising"; `null` is the
                        source saying nothing. Folding null into either
                        would assert what the source did not. */}
                    {row.leadCommittee === true ? (
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                        {t("referrals.lead")}
                      </span>
                    ) : row.leadCommittee === false ? (
                      <span className="text-muted-foreground text-[0.7rem]">
                        {t("referrals.consulted")}
                      </span>
                    ) : null}
                    {row.committeeAbbreviation !== null ? (
                      // `title` rather than `aria-label`: Biome's a11y rule
                      // reserves `aria-label` for elements with an
                      // interactive role, and the pointer-user's tooltip is
                      // what this offers anyway — the visible parenthetical
                      // and the committee name above already tell a screen
                      // reader what the abbreviation belongs to.
                      <span
                        className="text-muted-foreground text-[0.7rem]"
                        title={t("referrals.abbreviationLabel", {
                          value: row.committeeAbbreviation,
                        })}
                      >
                        ({row.committeeAbbreviation})
                      </span>
                    ) : null}
                    {row.positionKind !== null ? (
                      <span className="text-muted-foreground">{row.positionKind}</span>
                    ) : null}
                    <span className="text-muted-foreground tabular-nums">
                      {formatDateShort(row.date, locale)}
                    </span>
                    {row.documentNumber !== null ? (
                      <span className="text-muted-foreground tabular-nums">
                        {row.documentNumber}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {/* The boundary this feature exists to hold, restated where a
                  reader can see it. A referral is about a bill; it names
                  no member and cannot be committee membership. */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("referrals.caveat")}
              </p>
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}
