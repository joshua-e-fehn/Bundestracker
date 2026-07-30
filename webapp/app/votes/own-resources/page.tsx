import type { Metadata } from "next"
import { OwnResourcesVotes } from "@/components/own-resources-votes"
import { PageHeading } from "@/components/page-heading"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

/**
 * `/votes/own-resources` — ballots in which the Bundestag decided on its own
 * resources: party financing, the political foundations, and the electoral law
 * that decides who holds a seat.
 *
 * A server component rendering a client one, the shape AGENTS.md asks for.
 *
 * ## No `CurrentPeriod`
 *
 * Every other list on this site is scoped to the current Wahlperiode, and this
 * one deliberately is not: the collection is curated across periods and its
 * clearest entries (the Parteiengesetz amendment, the
 * Stiftungsfinanzierungsgesetz) are WP20's. Scoping to WP21 would empty most of
 * the page, and an empty page about the Bundestag's own resources is exactly
 * the thing a reader would misread as a finding. The ballots therefore carry
 * their period rather than inheriting one — see lib/own-resources-votes.ts.
 *
 * ## The segment name is checked, not lucky
 *
 * This sits beside `/votes/[id]`. Next resolves the static segment first, so
 * the route is reached — but `looksLikeId` in that page (a 16–64 character
 * id-shaped string) is the guard that stops a stray sibling reaching
 * `fetchQuery` with a bogus id and producing a 500. `own-resources` is 13
 * characters and fails that shape check, so it 404s cleanly even if the routing
 * order ever changed. A longer slug would not; that is a real constraint on
 * renaming this directory rather than a coincidence worth relying on silently.
 *
 * `/votes` already prefix-matches this path in `isPublicPath`, so no new entry
 * in lib/auth-routes.ts is needed — that only applies to top-level routes.
 *
 * Locale-aware metadata via `resolveServerLocale` — see app/layout.tsx for the
 * cookie → header → German precedence.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("votes.ownResources.title", locale),
    description: t("votes.ownResources.subtitle", locale),
  }
}

export default function OwnResourcesVotesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="votes.ownResources.title" subtitleKey="votes.ownResources.subtitle" />
      <OwnResourcesVotes />
    </main>
  )
}
