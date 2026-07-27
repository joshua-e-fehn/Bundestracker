"use client"

import Link from "next/link"
import { ActivityHeatmap } from "@/components/activity-heatmap"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MPCommittees } from "@/components/mp-committees"
import { MPPhoto } from "@/components/mp-photo"
import { MPRecentRecords } from "@/components/mp-recent-records"
import { MPScorePanel } from "@/components/mp-score-panel"
import { useLocale } from "@/components/providers/locale-provider"
import { TrendGraphs } from "@/components/trend-graphs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, occupationOf } from "@/lib/bundestag"
import type { Locale } from "@/lib/i18n"

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

/**
 * ⚠ The enrichment fields are `| null | undefined`, not `| null`.
 *
 * Same reason as `SeatTooltipData` in components/seat-tooltip.tsx, which
 * records the outage: during the window between a frontend deploy and the
 * Convex deploy that backs it, a field the client expects simply is not on the
 * document, and `undefined` is not `null`. A `!== null` check lets it through
 * to a `.trim()` that throws and takes the page to its error boundary. Narrow
 * with `?.` and treat both as "not recorded".
 */
export type MPDoc = {
  internalId: string
  name: string
  fraktion: string
  party: string
  constituency: string | null
  photoUrl: string | null
  photoCredit?: string | null
  bio: string | null
  birthDate: string | null
  education: string | null
  profession: string | null
  occupation?: string | null
  electionMethod: string | null
  datesInOffice: { start: string; end: string | null } | null
  contact?: {
    formUrl: string | null
    constituencyOffice: string | null
    homepage: string | null
    socials: Array<{ platform: string; url: string }>
  } | null
}

export function MPProfile({
  mp,
  wahlperiode,
  today,
}: {
  mp: MPDoc
  wahlperiode: number
  today: string
}) {
  const { t, locale } = useLocale()

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/mps"
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
              <MPPhoto name={mp.name} photoUrl={mp.photoUrl} className="size-28" />
              {/* The licence condition, not a nicety: these portraits are
                  photographer-credited rather than open-licensed (§6.5), so a
                  portrait that renders must render its credit with it. */}
              {mp.photoUrl && mp.photoCredit?.trim() ? (
                <p className="-mt-1 text-[11px] text-muted-foreground leading-tight">
                  {t("mp.photoCredit", { credit: mp.photoCredit })}
                </p>
              ) : null}
              <div className="flex flex-col items-center gap-2">
                <h1 className="font-semibold text-2xl tracking-tight">{mp.name}</h1>
                {/* Directly under the name, because it is the one line that
                    says who this person is rather than how they rank. */}
                {occupationOf(mp) ? (
                  <p className="text-muted-foreground text-sm">{occupationOf(mp)}</p>
                ) : null}
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
            </CardContent>
          </Card>

          <Biography mp={mp} locale={locale} />
          <Contact mp={mp} />
          <MPCommittees mpInternalId={mp.internalId} wahlperiode={wahlperiode} />
        </aside>

        <div className="flex flex-col gap-6">
          <MPScorePanel mpInternalId={mp.internalId} wahlperiode={wahlperiode} />

          <Card>
            <CardHeader>
              <CardTitle>{t("heatmap.title")}</CardTitle>
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

          <MPRecentRecords mpInternalId={mp.internalId} wahlperiode={wahlperiode} />
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
  // Both, and labelled apart. `profession` is Stammdaten's `BERUF` — the trade
  // practised before the mandate — and `occupation` is what the MP does now,
  // which for a sitting member is often `MdB`. Collapsing them would drop a
  // real answer; the header line above shows only the current one.
  if (mp.occupation?.trim()) rows.push({ label: t("mp.occupation"), value: mp.occupation })
  if (mp.profession) rows.push({ label: t("mp.profession"), value: mp.profession })
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
        <CardTitle>{t("mp.biography")}</CardTitle>
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

/** One outbound link in the Contact card. */
export type ContactLink = { key: string; label: string; href: string }

/**
 * The links a contact block yields, in the order they are shown.
 *
 * Exported and pure so it can be tested without a renderer, in the same spirit
 * as `referenceHref` in components/activity-feed-item.tsx — the rule about
 * *which* links exist is the part worth asserting, and it needs no DOM.
 *
 * `labels` is passed in rather than read from the locale here, because a pure
 * function that calls a hook is neither.
 */
export function contactLinks(
  contact: MPDoc["contact"],
  labels: { form: string; homepage: string },
): ContactLink[] {
  if (!contact) return []
  const links: ContactLink[] = []
  // The form first: it is the only route to the MP the Bundestag itself
  // offers, and the closest thing to the email address that does not exist.
  if (contact.formUrl?.trim()) {
    links.push({ key: "form", label: labels.form, href: contact.formUrl })
  }
  if (contact.homepage?.trim()) {
    links.push({ key: "homepage", label: labels.homepage, href: contact.homepage })
  }
  for (const social of contact.socials ?? []) {
    if (social.url?.trim()) {
      links.push({ key: `social:${social.url}`, label: social.platform, href: social.url })
    }
  }
  return links
}

/**
 * How to reach this MP — as much of it as is actually published.
 *
 * ⚠ **No email address and no phone number**, and that is a property of the
 * sources rather than a gap here: `MDB_STAMMDATEN.DTD` declares no contact
 * elements at all, and the biography pages carry no `mailto:` or `tel:` links.
 * The card says so in words. Leaving the absence unexplained would read as
 * data the pipeline had failed to fetch, and someone would go looking for it.
 *
 * The Berlin office is not shown: it is `Platz der Republik 1` for all 630, so
 * it is a fact about the Bundestag rather than about this MP.
 */
function Contact({ mp }: { mp: MPDoc }) {
  const { t } = useLocale()
  const office = mp.contact?.constituencyOffice?.trim()
  const links = contactLinks(mp.contact, {
    form: t("mp.contactForm"),
    homepage: t("mp.homepage"),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mp.contact")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {links.length === 0 && !office ? (
          <p className="text-muted-foreground text-sm">{t("mp.noContact")}</p>
        ) : (
          <>
            {office ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">{t("mp.constituencyOffice")}</span>
                {/* `whitespace-pre-line`: the line breaks are the address's
                    structure, and a doubled one separates two offices. */}
                <address className="whitespace-pre-line text-sm not-italic leading-snug">
                  {office}
                </address>
              </div>
            ) : null}
            {links.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {links.map((link) => (
                  <li key={link.key}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <p className="text-muted-foreground text-xs leading-snug">{t("mp.noDirectContact")}</p>
      </CardContent>
    </Card>
  )
}
