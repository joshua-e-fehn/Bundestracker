"use client"

import { useQuery } from "convex/react"
import { ExternalLink } from "lucide-react"
import { useState } from "react"
import { FraktionBadge } from "@/components/fraktion-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { useMPHref } from "@/components/providers/period-provider"
import { api } from "@/convex/_generated/api"
import { formatCount, formatDateShort } from "@/lib/format"

/**
 * Filed §31 declarations against one ballot — disclosed on request, not on load.
 *
 * ## What a row here asserts, and what it does not
 *
 * A vote's *subject* is its title, which the ballot already shows. A **reason**
 * is a different thing, and the Geschäftsordnung provides for exactly one:
 * under §31 a member may put on the record why they voted as they did. DIP
 * publishes each such declaration as an activity with the member's `person_id`,
 * the procedure it concerns, and a page-anchored PDF link — but not the prose.
 *
 * So this component shows **that** each named member filed a declaration,
 * **which procedure** it concerns, and **where** it is printed. It never
 * generates, summarises, paraphrases or otherwise invents rationale text. The
 * caveat under the list says as much in as many words, so a reader who scans
 * the list has been told before they draw a conclusion from any name they see.
 * That constraint is also asserted structurally, in convex/voteExplanations.test.ts:
 * the schema table carries no field that could hold generated text.
 *
 * ## Why this is behind a toggle
 *
 * Every ballot in the visible period pays for its explanation reads through
 * the same subscription contract as motion-sponsors: `useQuery("skip")` while
 * closed, so an unopened row costs nothing and holds no subscription. The
 * ballot list is 25 rows and the detail page is one; either way the disclosure
 * defaults closed so a wallpaper of empty panels does not manufacture a page
 * of reads readers did not ask for.
 *
 * ## The three empty states must not be conflated
 *
 * `getExplanationsByMotion` answering `[]` is one fact; whether the period has
 * been backfilled at all is a different one. `hasAnyForPeriod` is what tells
 * them apart — `getExplanationCoverage` is read **once at the caller's level**
 * and threaded down, rather than fetched per row. When true, an empty answer
 * means the source filed none for this Vorgang. When false or undefined,
 * the disclosure says the period's declarations have not been ingested yet.
 * Same distinction, and the same reasoning, as components/source-coverage-note.tsx.
 */
export function VoteExplanationsDisclosure({
  ballotId,
  wahlperiode,
  dipVorgangId,
  variant = "row",
  hasAnyForPeriod,
}: {
  /** The ballot's own Convex id. Threaded in as the panel-id key: the Vorgang
   * id is nullable, so it cannot alone guarantee uniqueness across a page
   * that ever renders more than one disclosure (a future list-row placement
   * would collide across every unlinked ballot). The Convex id is unique by
   * construction. */
  ballotId: string
  wahlperiode: number
  /** The ballot's procedure id. Null means the XLSX has been ingested but its
   * DIP procedure has not resolved yet — see the schema note on
   * `voteSheets.dipVorgangId` for the three distinct states. When null, the
   * disclosure explains the linkage is missing rather than saying the ballot
   * has no declarations, because those are different claims. */
  dipVorgangId: string | null
  /** `row` for a compact per-ballot control on the list; `section` for the
   * detail-page disclosure with its own heading. */
  variant?: "row" | "section"
  /** True when the period holds any §31 declaration at all —
   * `getExplanationCoverage(...).explanations > 0`. Passed in rather than
   * fetched here so the coverage query runs once at page level rather than
   * once per row. `undefined` while the caller's coverage query resolves. */
  hasAnyForPeriod: boolean | undefined
}) {
  const { t, locale } = useLocale()
  const mpHref = useMPHref()
  const [open, setOpen] = useState(false)

  // Keyed on the *ballot's* Convex id, not the Vorgang id. The Vorgang can
  // be null, and a fallback sentinel would collide across every unlinked
  // ballot rendered on one page (harmless today on the single-ballot detail
  // page, but the failure mode has already bitten the referrals disclosure
  // which sits on a multi-row list — same pattern here in advance).
  const panelId = `vote-explanations-${ballotId}`

  const explanations = useQuery(
    api.voteExplanations.getExplanationsByMotion,
    open && dipVorgangId !== null ? { wahlperiode, dipVorgangId } : "skip",
  )

  // The unlinked arm: DIP procedure not resolved for this ballot. Not "no
  // declarations" — a different claim, and the schema note on
  // `voteSheets.dipVorgangId` sets it out at length. Renders the honest empty
  // state without any query. The show/hide labels are the same as the linked
  // case on purpose — the toggle names the *subject* (§31 declarations), not
  // its state, so a screen reader hearing "expand" and then "collapse"
  // announces one coherent thing rather than "link missing" toggling to
  // "hide declarations".
  if (dipVorgangId === null) {
    return (
      <Shell
        variant={variant}
        panelId={panelId}
        open={open}
        onToggle={() => setOpen((current) => !current)}
        showLabel={t("voteExplanations.show")}
        hideLabel={t("voteExplanations.hide")}
        heading={variant === "section" ? t("voteExplanations.sectionHeading") : null}
      >
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("voteExplanations.unlinked")}
        </p>
      </Shell>
    )
  }

  // `loading` covers both the per-ballot query still in flight AND the
  // page-level coverage query still in flight — the empty state cannot
  // safely render until both have resolved, because the coverage flag is
  // what tells "none filed" from "not backfilled". Rendering `emptyNoneFiled`
  // while coverage is still `undefined` would flash a positive claim about
  // the ballot ("no §31 declaration was filed") for a period the deployment
  // has not actually looked at yet.
  const loading = explanations === undefined || hasAnyForPeriod === undefined
  const list = explanations ?? []

  return (
    <Shell
      variant={variant}
      panelId={panelId}
      open={open}
      onToggle={() => setOpen((current) => !current)}
      showLabel={t("voteExplanations.show")}
      hideLabel={t("voteExplanations.hide")}
      heading={variant === "section" ? t("voteExplanations.sectionHeading") : null}
    >
      {loading ? (
        <output className="text-muted-foreground text-xs" aria-live="polite">
          {t("voteExplanations.loading")}
        </output>
      ) : list.length === 0 ? (
        // Two empty states, one component, two very different things being
        // said. `hasAnyForPeriod === false` means this deployment holds no
        // §31 declarations for the whole period — a not-backfilled fact,
        // not a fact about this ballot. `true` means the source itself filed
        // none for this Vorgang, which for §31 is the usual case (measured —
        // see the header of convex/voteExplanations.ts). `undefined` is
        // gated above by `loading`, so the two branches here are exhaustive.
        <p className="text-muted-foreground text-xs leading-relaxed">
          {hasAnyForPeriod === false
            ? t("voteExplanations.emptyPeriodNotBackfilled")
            : t("voteExplanations.emptyNoneFiled")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {t("voteExplanations.count", { count: formatCount(list.length, locale) })}
          </p>
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {list.map((row) => (
              // The natural key. The join is one row per declaration; the DIP
              // activity id is what makes re-ingest an upsert on the server,
              // so it is unique within one Vorgang's list.
              <li
                key={row.dipAktivitaetId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              >
                <a
                  href={mpHref(row.mpInternalId)}
                  className="rounded-md underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {row.name}
                </a>
                {row.fraktion ? <FraktionBadge fraktion={row.fraktion} /> : null}
                <span className="text-muted-foreground tabular-nums">
                  {formatDateShort(row.date, locale)}
                </span>
                {row.protocolNumber !== null ? (
                  // The visible label is already the whole utterance
                  // ("Protokoll 21/90"), and the German short form reads
                  // correctly to a screen reader. `title` provides the
                  // expansion on hover for a sighted pointer user, which is
                  // what an `aria-label` on a non-interactive span cannot
                  // do — Biome's a11y rule refuses that pattern here.
                  <span
                    className="text-muted-foreground tabular-nums"
                    title={t("voteExplanations.protocolLabel", {
                      number: row.protocolNumber,
                    })}
                  >
                    {t("voteExplanations.protocol", { number: row.protocolNumber })}
                  </span>
                ) : null}
                {row.sourceUrl !== null ? (
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    // The accessible name is the source-link phrase plus the
                    // member's name, so a screen reader hearing a list of
                    // link items can tell whose PDF a "Zum Protokoll" link
                    // opens without the surrounding row context.
                    aria-label={t("voteExplanations.sourceLinkLabel", { name: row.name })}
                    className="inline-flex items-center gap-1 rounded-md underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {t("voteExplanations.sourceLink")}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          {/* The rule the whole feature turns on, restated to the reader in
              their own language. Present whenever the list is — a reader
              who scanned the names should not be able to leave without
              having read what a §31 row is and is not. */}
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("voteExplanations.caveat")}
          </p>
        </div>
      )}
    </Shell>
  )
}

/**
 * The shell every branch above renders through — one place that owns the
 * `aria-expanded` / `aria-controls` wiring and the `hidden` panel invariants
 * that keep `id`s resolvable while collapsed.
 *
 * Two variants because the row form sits inside a table cell and the section
 * form on the detail page has its own heading. Both variants use the exact
 * same disclosure semantics — the difference is the visible chrome, not the
 * accessibility contract.
 */
function Shell({
  variant,
  panelId,
  open,
  onToggle,
  showLabel,
  hideLabel,
  heading,
  children,
}: {
  variant: "row" | "section"
  panelId: string
  open: boolean
  onToggle: () => void
  showLabel: string
  hideLabel: string
  heading: string | null
  children: React.ReactNode
}) {
  // A `<section>` for the detail page, so it lands as a labelled region in the
  // page's outline beside the breakdown and records sections. On the list a
  // plain `<div>` — a section per row would litter the landmark map.
  const headingId = `${panelId}-heading`
  const Wrapper = variant === "section" ? "section" : "div"
  const wrapperProps =
    variant === "section" && heading !== null ? { "aria-labelledby": headingId } : {}

  return (
    <Wrapper {...wrapperProps} className="flex flex-col gap-2">
      {variant === "section" && heading !== null ? (
        <h2 id={headingId} className="font-semibold text-lg">
          {heading}
        </h2>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-fit rounded-md text-muted-foreground text-xs underline decoration-border underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? hideLabel : showLabel}
      </button>
      {/* Always mounted with the id — a hidden panel is display:none, so it
          adds no layout gap under the toggle, but the id remains resolvable
          for the `aria-controls` above. An id that resolves to nothing tells
          a screen reader the association is broken, which is worse than no
          association at all. Same shape motion-sponsors uses. */}
      <div id={panelId} hidden={!open}>
        {open ? children : null}
      </div>
    </Wrapper>
  )
}
