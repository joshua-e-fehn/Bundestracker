"use client"

import { ArrowDownIcon, ExternalLinkIcon } from "lucide-react"
import Link from "next/link"
import { ActivityHeatmap } from "@/components/activity-heatmap"
import { FollowButton } from "@/components/follow-button"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MPCommittees } from "@/components/mp-committees"
import { MPPhoto, MPPhotoCredit } from "@/components/mp-photo"
import { MPRecentRecords } from "@/components/mp-recent-records"
import { MPScorePanel } from "@/components/mp-score-panel"
import { useLocale } from "@/components/providers/locale-provider"
import { TrendGraphs } from "@/components/trend-graphs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/bundestag"
import { CONTACT_ANCHOR, type ContactBlock, contactChannels, hostOf } from "@/lib/contact"
import type { Locale } from "@/lib/i18n"
import { BUNDESTAG_MPS_URL, BUNDESTAG_SWITCHBOARD, BUNDESTAG_SWITCHBOARD_TEL } from "@/lib/links"
import { periodLink } from "@/lib/period"

/**
 * The profile: who this MP is, what they have done, and how it was scored.
 *
 * A sidebar of things that are true of the *person* — portrait, group,
 * constituency, biography, committee seats — beside a main column of things
 * they *did*: the score and its parts, the contribution graph, and the most
 * recent speeches, motions and votes.
 *
 * A client component because three of those panels are interactive (the weight
 * sliders, the heatmap's tooltips) and the rest subscribe: an ingest landing
 * while the page is open should update it. The roster row itself arrives from
 * the server, already fetched — see app/mps/[id]/page.tsx.
 */

export type MPDoc = {
  internalId: string
  name: string
  fraktion: string
  party: string
  constituency: string | null
  photoUrl: string | null
  birthDate: string | null
  electionMethod: string | null
  datesInOffice: { start: string; end: string | null } | null
  /**
   * The enrichment fields, all three optional as well as nullable.
   *
   * `?:` rather than `| undefined` is the load-bearing part. These are
   * `v.optional` in convex/schema.ts, because they were added to a populated
   * `mps` table and Convex validates every existing row at deploy time — a
   * required field there rejects the deploy outright. `v.optional` makes the
   * generated document type declare the *property* optional, and a required
   * `bio: string | null | undefined` is not assignable from that: the key may
   * be missing entirely, not merely hold `undefined`.
   *
   * So there are three states, not two — key absent (the row predates the
   * field), `null` (the source published nothing), and a value — and the two
   * absences mean the same thing to a reader. Every use below narrows on
   * truthiness, which handles all three; see the longer note on
   * `SeatTooltipData.profession` in components/seat-tooltip.tsx for the outage
   * that a `!== null` check caused here.
   */
  bio?: string | null
  education?: string | null
  profession?: string | null
  /**
   * What the MP does *now* — abgeordnetenwatch's answer, where `profession` is
   * Stammdaten's `BERUF` and is what they did before the mandate.
   *
   * Absent from this type until now, and the omission was visible on the page:
   * `occupationOf` in lib/bundestag.ts exists precisely so the search card and
   * the profile agree on what "occupation" shows, and its comment says as much
   * — but `components/search-results.tsx` called it while this type had no
   * field for it, so the profile could only ever read `profession`. For the 28
   * WP21 members who have an `occupation` and no `profession` that meant the
   * Biografie card showed no job at all, verified on Alexander Arpaschi
   * (bt-11005404, "selbstständiger Immobilienunternehmer").
   */
  occupation?: string | null
  /** Whose photograph `photoUrl` is. Displaying it is the licence condition,
   * not a courtesy — see the header of components/mp-photo.tsx. */
  photoCredit?: string | null
  /**
   * How to reach the MP, as the Bundestag actually publishes it.
   *
   * ⚠ No per-member address and no direct dial, and that is a fact about the
   * sources rather than a gap here: `MDB_STAMMDATEN.DTD` declares no contact
   * element, and 110 biography pages audited on 2026-07-31 carried neither.
   * `formUrl` is the Bundestag's own substitute. See the note on `contact` in
   * convex/schema.ts.
   *
   * The shape lives in lib/contact.ts, with the rule for reading it — one
   * definition, so the card and its tests cannot disagree about what "has
   * contact data" means.
   */
  contact?: ContactBlock
}

export function MPProfile({
  mp,
  wahlperiode,
  today,
  current,
}: {
  mp: MPDoc
  wahlperiode: number
  today: string
  /**
   * The sitting Wahlperiode, so the panels below can tell "not published for a
   * closed period" from "zero".
   *
   * Passed down rather than queried in each card. Five surfaces on this page
   * need it — the committee card, the score panel, the vote list, the trend
   * graphs and the back-link — and a query each would be five subscriptions to
   * one number. It is also the value that decides whether the back-link carries
   * a period, and that must be the *same* number the selector above used or the
   * link would leave the period the reader is in.
   */
  current?: number | null
}) {
  const { t, locale } = useLocale()

  return (
    <div className="flex flex-col gap-6">
      {/* Back to the roster of *this* period. A bare `/mps` would drop a reader
          browsing WP19 into the current chamber — the silent period loss the
          acceptance criteria name, on the one link every profile carries. */}
      <Link
        href={periodLink("/mps", wahlperiode, current)}
        className="text-muted-foreground text-sm hover:text-foreground hover:underline"
      >
        ← {t("mp.backToList")}
      </Link>

      {/* `minmax(0,1fr)` on the base single-column track, not only on the `lg:`
          two-column one. A grid item's `min-width` defaults to `auto`, which
          means "at least as wide as my content" — so below `lg` the one column
          sized itself to the widest thing in either child and the page grew to
          737 px inside a 375 px viewport, scrolling the whole profile sideways.
          The `lg:` track already said `minmax(0,1fr)` for this reason; the
          narrow case needed the same and did not have it. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 pt-2 text-center">
              <MPPhoto
                name={mp.name}
                photoUrl={mp.photoUrl}
                credit={mp.photoCredit}
                // The credit is printed below, so the avatar's hidden copy
                // would announce it twice.
                creditShownSeparately
                className="size-28"
              />
              <div className="flex flex-col items-center gap-2">
                <h1 className="font-semibold text-2xl tracking-tight">{mp.name}</h1>
                <FraktionBadge fraktion={mp.fraktion} />
                {/* The party, when it differs from the group. `CDU` inside
                    `CDU/CSU` is not news; a `fraktionslos` MP's former party
                    is. The two are separate columns in the schema precisely
                    because they are not the same thing. */}
                {mp.party && mp.party !== mp.fraktion ? (
                  <span className="text-muted-foreground text-sm">{mp.party}</span>
                ) : null}
                <span className="text-muted-foreground text-sm">
                  {mp.constituency ?? t("mps.listMandate")}
                </span>
              </div>
              {/* Printed rather than left to the portrait's `title`, because
                  here the photograph is the subject of the page rather than a
                  label on a row — and displaying the credit is the condition on
                  which it may be shown at all (convex/schema.ts:207). */}
              <MPPhotoCredit photoUrl={mp.photoUrl} credit={mp.photoCredit} />

              {/* Follow, in the identity card and under the name it is about.
                  This is the surface the product promise names — an account
                  "lets you follow individual members" — and it belongs here
                  rather than in the score panel opposite: following is a
                  statement about the *person*, and the panel is about the
                  arithmetic over their record.

                  Self-fetching (`isFollowing`) rather than reading the whole
                  follow list, because this page shows exactly one MP. A list
                  passes the answer in instead; see components/follow-button.tsx.

                  `size="default"` — this is the page's one follow control, not
                  a cell in a row, so it gets the standard target rather than
                  the compact one the roster uses. */}
              <FollowButton
                mpInternalId={mp.internalId}
                name={mp.name}
                size="default"
                className="items-center"
              />

              {/* The jump to the card two hundred pixels below. It is in the
                  identity card rather than beside the name because that is the
                  block a reader is already looking at when the question "how do
                  I write to them" occurs to them.

                  A plain anchor, like `/`'s skip link and for the same reasons:
                  it works before hydration and survives a middle-click. It is
                  never conditional on `contact` — the card below always renders
                  now, so a link that appeared only for populated members would
                  reintroduce the silence this branch exists to remove, on
                  exactly the members who need the explanation most. */}
              <ContactJumpLink />
            </CardContent>
          </Card>

          {/* Contact directly under the identity card, above the biography.
              It used to sit third, which put its heading ~1 450 px down the
              page — about 1.6 viewports, on both desktop and mobile — and the
              audit of 2026-07-29 found readers concluding from that there were
              no contact details at all (GAP-002).

              Ordering by what a reader came for rather than by what describes
              the person: below `lg` this grid is a single column, so sidebar
              order *is* page order on a phone, and "how do I reach them" is a
              question people arrive with. The biography follows, then the
              committee seats — both are context, and context can wait. */}
          <Contact mp={mp} />
          <Biography mp={mp} locale={locale} />
          {/* `current` is what lets the empty state say *why* it is empty.
              Committee membership is published for the sitting Bundestag alone
              (§6.4), so on a closed period every MP has none — and "none" and
              "not published" are the same empty array. */}
          <MPCommittees mpInternalId={mp.internalId} wahlperiode={wahlperiode} current={current} />
        </aside>

        <div className="flex flex-col gap-6">
          <MPScorePanel mpInternalId={mp.internalId} wahlperiode={wahlperiode} current={current} />

          <Card>
            <CardHeader>
              {/* `as="h2"`, matching the `Panel` chrome in
                  mp-recent-records.tsx and the sibling cards on this page —
                  the MP profile's `<h1>` is the member's name, and every
                  landmark section below is a peer that a screen-reader
                  reader should be able to jump between. F-05 of the review. */}
              <CardTitle as="h2">{t("heatmap.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityHeatmap mpInternalId={mp.internalId} locale={locale} today={today} />
            </CardContent>
          </Card>

          {/* Above the "latest five" panels, not below them: the heatmap says
              which days were busy and this says whether that is rising or
              falling, so the two graphs sit together and the record lists
              follow. */}
          <TrendGraphs mpInternalId={mp.internalId} wahlperiode={wahlperiode} />

          <MPRecentRecords
            mpInternalId={mp.internalId}
            wahlperiode={wahlperiode}
            current={current}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Education, profession, birth date, mandate type and span.
 *
 * Every field here is nullable in the schema and most are null in practice, so
 * the panel renders only what exists and says so plainly when nothing does —
 * rather than printing five labels with five dashes after them, which looks
 * like a broken page instead of a sparse record.
 */
function Biography({ mp, locale }: { mp: MPDoc; locale: Locale }) {
  const { t } = useLocale()

  const rows: Array<{ label: string; value: string }> = []
  if (mp.birthDate) rows.push({ label: t("mp.birthDate"), value: formatDate(mp.birthDate, locale) })
  if (mp.profession) rows.push({ label: t("mp.profession"), value: mp.profession })
  // Both, where the sources answer differently — they are two questions ("what
  // do they do now" vs "what did they do before"), and §6 records them
  // disagreeing usefully. Shown only when it adds something: for the many
  // members whose `occupation` is literally "MdB", or simply repeats the
  // profession, a second row would say nothing twice.
  //
  // The comparison is what makes this more than cosmetic. `occupationOf` picks
  // `occupation` first, so the search card already showed it while this card
  // showed only `profession` — and the 28 members who have one and not the
  // other had no job line here at all.
  if (mp.occupation && mp.occupation.trim() !== mp.profession?.trim()) {
    rows.push({ label: t("mp.occupation"), value: mp.occupation })
  }
  if (mp.education) rows.push({ label: t("mp.education"), value: mp.education })
  if (mp.electionMethod) rows.push({ label: t("mp.electionMethod"), value: mp.electionMethod })
  if (mp.datesInOffice) {
    // An open `end` means still serving — that is how §6.2 reconciles 635 rows
    // to 630 seats, so it renders as words rather than as a blank after the
    // dash, which would read as a missing date.
    const start = formatDate(mp.datesInOffice.start, locale)
    const end = mp.datesInOffice.end
      ? formatDate(mp.datesInOffice.end, locale)
      : t("mp.stillServing")
    rows.push({ label: t("mp.datesInOffice"), value: `${start} – ${end}` })
  }

  return (
    <Card>
      <CardHeader>
        {/* `as="h2"` — sibling of the panels in the main column and of the
            contact + committees cards below. See the note on the heatmap
            title above. */}
        <CardTitle as="h2">{t("mp.biography")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && !mp.bio ? (
          <p className="text-muted-foreground text-sm">{t("mp.noBiography")}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-2.5">
              {rows.map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground text-xs">{row.label}</dt>
                  <dd className="text-sm">{row.value}</dd>
                </div>
              ))}
            </dl>
            {mp.bio ? <p className="text-sm leading-relaxed">{mp.bio}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The identity card's jump to the contact card below it.
 *
 * Quiet, like `/`'s "straight to the data" — it is a shortcut, not a call to
 * action — but present in the first block of the page, which is the point. The
 * audit measured the contact heading at 1 385–1 492 px with nothing above it
 * hinting the card existed (GAP-002); this is the hint.
 *
 * ## The label names the destination, and carries the whole accessible name
 *
 * `mp.jumpToContact` is "Zu den Kontaktdaten", not "Kontakt". The bare word was
 * `mp.contact` verbatim — the heading of the card this points at — so a reader
 * listing the page's links heard the same word twice with nothing to say which
 * one was the shortcut. The arrow is `aria-hidden`, so the glyph that makes the
 * direction obvious to a sighted reader adds nothing to that name.
 *
 * There is deliberately no `aria-label` and no `sr-only` suffix: the visible
 * text *is* the accessible name, which is what keeps WCAG 2.5.3 (Label in Name)
 * satisfied and voice control working — a longer spoken name over a shorter
 * visible one means "click Kontakt" stops matching the thing it names.
 */
function ContactJumpLink() {
  const { t } = useLocale()
  return (
    <a
      href={`#${CONTACT_ANCHOR}`}
      className="flex items-center gap-1.5 rounded-md font-medium text-muted-foreground text-xs underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {t("mp.jumpToContact")}
      <ArrowDownIcon className="size-3" aria-hidden="true" />
    </a>
  )
}

/**
 * How to reach this member.
 *
 * ## There is no per-member address, and saying so is part of the card
 *
 * ⚠ The member directory publishes none — `MDB_STAMMDATEN.DTD` declares no
 * contact element at all, and an audit of 110 biography pages on 2026-07-31
 * found not one address or direct dial on any of them (docs/api-research.md
 * §6.6). The contact *form* is the Bundestag's own substitute, so the form link
 * carries a line saying why it is a form. Without it the card reads as though an
 * address had been left out; the note is what makes the absence a fact about the
 * source rather than a gap in the pipeline. See the note on `contact` in
 * convex/schema.ts, which this card is the reader-facing half of.
 *
 * ⚠ The claim is deliberately about the **directory**, not about the
 * parliament. An earlier version of this copy said the Bundestag published no
 * addresses or numbers at all, which the same audit refuted: it prints its own
 * switchboard on its imprint, and roughly 70 % of members publish an
 * `@bundestag.de` address on their own website. Those member sites are linked,
 * never harvested — one lists four staff addresses with nothing marking which
 * is the member's, and some obfuscate theirs precisely to stop collection, so
 * picking one would be inventing an answer the source did not give.
 *
 * ## It renders even when the source published nothing
 *
 * It used to return `null` for a member with no contact block, which is 12 of
 * 635 in WP21 — and, whenever a sync blanks the enrichment columns (GAP-001),
 * all 635. That made the page *silent* rather than sparse: a reader could not
 * tell "the Bundestag publishes nothing for this member" from "this site failed
 * to fetch it", because both rendered as a profile with no contact section on
 * it. `grep "E-Mail-Adressen"` on Habeck's live page returned zero.
 *
 * So the absence is now a state of the card, not the absence of the card. It
 * says what the directory does and does not publish, prints the Berlin office
 * and the switchboard — both of which reach every member and are true
 * regardless of what the pipeline holds — and links the Bundestag's own
 * directory as the place to look next. Nothing in it is invented: there is no
 * fabricated address, no guessed per-member URL, and no personal address or
 * direct dial, because the source publishes none.
 *
 * ## The Berlin office and the switchboard are constants, not rows
 *
 * `Platz der Republik 1` and the switchboard are the same for all 630 members,
 * so the schema deliberately does not store either 630 times and this prints
 * them from the dictionary. They are what make the card useful for the roughly
 * half of the roster that lists no constituency office, and they are the
 * substitute the empty state leans on — but they are deliberately *not* counted
 * as contact data by `contactChannels`, or every row would look populated.
 *
 * Within the populated state it still renders only what exists, like `Biography`
 * above and for the same reason: printing four labelled blanks looks like a
 * broken page rather than a sparse record.
 */
function Contact({ mp }: { mp: MPDoc }) {
  const { t } = useLocale()
  const contact = contactChannels(mp.contact)

  return (
    // `scroll-mt` because the site header is sticky: without it the jump above
    // lands with the heading underneath the bar. Same treatment, same reason,
    // as the sections in components/about-page.tsx.
    <Card id={CONTACT_ANCHOR} className="scroll-mt-20">
      <CardHeader>
        {/* `as="h2"` — same reason, see the heatmap title above. */}
        <CardTitle as="h2">{t("mp.contact")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {contact.any ? null : (
          <div className="flex flex-col gap-1">
            <p className="text-sm leading-snug">{t("mp.noContact")}</p>
            {/* Why, in the Bundestag's terms rather than this site's. This is
                the sentence whose absence was GAP-003: without it the reader
                is left to infer whether the gap is the parliament's or ours. */}
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("mp.noContactExplain")}
            </p>
          </div>
        )}

        {contact.formUrl ? (
          <div className="flex flex-col gap-1">
            <ExternalLink href={contact.formUrl}>{t("mp.contactForm")}</ExternalLink>
            {/* The reason the link is a form and not an address. */}
            <p className="text-muted-foreground text-xs">{t("mp.contactFormHint")}</p>
          </div>
        ) : null}

        {contact.homepage ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{t("mp.homepage")}</span>
            <ExternalLink href={contact.homepage}>
              {/* The bare host, not the URL: `https://www.sanaeabdi.de/` is
                  wider than the card on a phone and says nothing the host does
                  not. Falls back to the raw value if it does not parse, rather
                  than rendering an empty link. */}
              {hostOf(contact.homepage) ?? contact.homepage}
            </ExternalLink>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{t("mp.berlinOffice")}</span>
          {/* In the empty state the address needs a sentence in front of it,
              because there it is the *answer* rather than one channel among
              several — an unlabelled address under "no contact details are
              recorded" reads as a contradiction. */}
          {contact.any ? null : (
            <p className="text-muted-foreground text-xs">{t("mp.postalSubstitute")}</p>
          )}
          {/* `whitespace-pre-line`, because the address is two lines and the
              dictionary holds it with the newline in it — the same treatment
              the constituency office below needs, and for the same reason. */}
          <p className="whitespace-pre-line text-sm leading-snug">{t("mp.berlinAddress")}</p>
        </div>

        {/* The switchboard, beside the postal address because it is the same
            kind of fact: the institution's own, true for all 630, and printed
            from the dictionary rather than stored per row. It renders in both
            branches for the same reason the address does — it reaches this
            member whatever the pipeline holds.

            The hint is not decoration. A phone number under a person's name
            reads as their direct line, and this one is not: it is the house
            switchboard, which connects onward. Saying so is what keeps the
            card's promise the size of the source. */}
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{t("mp.switchboard")}</span>
          {/* Not `ExternalLink`: a `tel:` is not an outbound *page*, so it takes
              neither `target="_blank"` nor the external-link icon. It shares the
              appearance and nothing else. */}
          <a href={BUNDESTAG_SWITCHBOARD_TEL} className={cardLinkClass()}>
            {BUNDESTAG_SWITCHBOARD}
          </a>
          <p className="text-muted-foreground text-xs">{t("mp.switchboardHint")}</p>
        </div>

        {contact.constituencyOffice ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{t("mp.constituencyOffice")}</span>
            {/* Newline-separated as printed, and an MP may list two — Sanae
                Abdi has offices in Köln-Innenstadt and Kalk in one string. So
                the whitespace is content, not formatting. */}
            <p className="whitespace-pre-line text-sm leading-snug">{contact.constituencyOffice}</p>
          </div>
        ) : null}

        {contact.socials.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t("mp.socials")}</span>
            <ul className="flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0">
              {contact.socials.map((social) => (
                <li key={social.url}>
                  {/* `platform` is free text and the list is the Bundestag's —
                      it grows — so it is printed rather than matched against an
                      enum of known networks with an icon each. An unrecognised
                      platform must render as itself, not disappear. */}
                  <ExternalLink href={social.url}>{social.platform}</ExternalLink>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* The last resort, and only in the empty state: the Bundestag's own
            listing, where the member's page — and with it the contact form this
            profile could not resolve — can be looked up by hand. The *listing*
            rather than a per-MP URL, because the per-MP page is keyed by an id
            the pipeline learns by name-matching, and a member it failed to
            match is precisely one it has no id for. See lib/links.ts. */}
        {contact.any ? null : (
          <ExternalLink href={BUNDESTAG_MPS_URL}>{t("mp.officialDirectory")}</ExternalLink>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * A link off the site.
 *
 * `rel="noreferrer noopener"` and `target="_blank"`, matching
 * components/site-footer.tsx — every outbound link on the site behaves the same
 * way, and these ones go to personal sites and social networks, where passing a
 * referrer says which MP's page the reader was on.
 */
/**
 * How a link inside the contact card looks.
 *
 * Shared by `ExternalLink` and the switchboard's `tel:` anchor, which are two
 * different elements for good reasons — a phone number opens no tab and takes
 * no external-link icon — but must not be two different *appearances*. They sit
 * four lines apart in the same card, so a class list copied between them is one
 * a later edit changes in one place only.
 */
const cardLinkClass = (gap = "") =>
  `inline-flex w-fit items-center ${gap}rounded-md text-sm underline decoration-border ` +
  `underline-offset-4 outline-none transition-colors hover:decoration-foreground ` +
  `focus-visible:ring-3 focus-visible:ring-ring/50`

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      // `gap-1.5` is this variant's own: it is the space before the icon below,
      // and a link with no icon has nothing to space.
      className={cardLinkClass("gap-1.5 ")}
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  )
}

// Named re-export for `components/mp-contact.test.ts` to render Contact in
// isolation: `MPProfile` itself pulls in `FollowButton`, `MPCommittees`,
// `MPScorePanel`, `ActivityHeatmap`, `TrendGraphs`, and `MPRecentRecords` —
// every one of them a client component with a Convex subscription — so
// importing the whole profile into a source-only test drags in the entire
// dependency graph. The re-export sits at the bottom of the file rather
// than in front of `function Contact` above so `mp-profile.test.ts`'s
// source-slice guards (which scan for the next `\nfunction ` boundary)
// keep finding the same Contact boundary they always did — a `function`
// declaration, not an `export function` one. See `mp-contact.test.ts` for
// the AC-6 rendered-DOM assertions this makes possible.
export { Contact }
