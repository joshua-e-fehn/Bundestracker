import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { PartyHeading } from "@/components/party-heading"
import { PartyMembers } from "@/components/party-members"
import { PeriodScope } from "@/components/period-scope"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"
import { isPartyKey, partyByKey } from "@/lib/parties"

/**
 * `/parties/[party]` — one Fraktion's members, ranked by activity.
 *
 * ## The route parameter is a `PartyKey`, not a Fraktion string
 *
 * `/parties/cdu-csu`, never `/parties/CDU%2FCSU`. Three reasons, and the first
 * is decisive on its own:
 *
 *  - **The stored spellings are not one value.** §6.4 and §5.2 catalogue four
 *    ways of writing one group, and a live deployment produced `Fraktionslos`
 *    and `fraktionslos` as separate rows — so a URL built from the stored string
 *    would be two URLs for one Fraktion, each listing half its members.
 *  - `CDU/CSU` contains a slash, so it cannot be a path segment without being
 *    escaped into something nobody would paste into a chat.
 *  - The key is what `lib/parties.ts` already treats as a group's identity;
 *    routing by anything else would introduce a second one.
 *
 * ## Validating before the query
 *
 * `getPartyMembers` takes a validated union, so an unknown segment would be
 * rejected by the argument validator as a 500 rather than a 404. `isPartyKey`
 * is the guard, and it runs here — before anything renders — because whether
 * this URL is a page at all is decided by it.
 *
 * ⚠ Like the other `[id]` boundaries on this site, `notFound()` here is served
 * with HTTP 200 under Next 16.2.12 while rendering the not-found body — see the
 * note in components/not-found-page.tsx. The call stays because it is correct
 * and will produce the right status once the framework does.
 *
 * ## The period is resolved by `PeriodScope`, not here
 *
 * Like every other route on the site: the *path* carries the group and the
 * *query string* carries the Bundestag, so `/parties/fdp?wp=19` is one group in
 * one period and both halves are shareable. A second resolution in this page
 * would be a second answer to "which Bundestag is this". The group rides along
 * as an extra prop — see the note on `PeriodScope`.
 *
 * ⚠ A group that is a valid `PartyKey` need not have sat in every period, and
 * this is the route where that shows: `/parties/fdp` is a real page in WP19 and
 * WP20 and an empty one in WP21, where the FDP holds no seats. `PartyMembers`
 * distinguishes that from an unscored period rather than rendering a bare empty
 * table — a group that did not sit and a group nobody has scored look identical
 * otherwise.
 */

type Params = { params: Promise<{ party: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [{ party }, locale] = await Promise.all([params, resolveServerLocale()])
  if (!isPartyKey(party)) {
    return { title: t("common.notFound", locale) }
  }
  // Locale-aware via `resolveServerLocale` — see app/layout.tsx for the cookie
  // → header → German precedence.
  return {
    title: t("parties.members.title", locale, { party: partyByKey(party).label }),
    description: t("parties.members.subtitle", locale),
  }
}

export default async function PartyPage({ params }: Params) {
  const { party } = await params

  // A real 404 rather than an empty roster: an unknown key here is a bad link,
  // not a Fraktion with no members.
  if (!isPartyKey(party)) notFound()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PartyHeading party={party} />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/period-scope.tsx — and
          app/rankings/page.tsx for why the `Suspense` boundary is required. */}
      <Suspense>
        <PeriodScope component={PartyMembers} props={{ party }} />
      </Suspense>
    </main>
  )
}
