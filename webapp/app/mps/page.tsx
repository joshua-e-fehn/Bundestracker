import { preloadQuery } from "convex/nextjs"
import type { Metadata } from "next"
import { MPTable } from "@/components/mp-table"
import { api } from "@/convex/_generated/api"
import { CURRENT_WAHLPERIODE } from "@/lib/bundestag"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * The roster — every MP of the current Wahlperiode, filterable and sortable.
 *
 * A server component that preloads and hands off, which is the split AGENTS.md
 * asks for: the data is public and identical for everyone, so it is fetched
 * once on the server, while the filtering, sorting and paging that follow are
 * pure interaction and belong in the browser.
 *
 * `preloadQuery` rather than `fetchQuery`: it renders the first paint on the
 * server *and* hands the client a live subscription, so an ingest landing while
 * someone has the page open updates it. `fetchQuery` would give the same first
 * paint and then go stale.
 *
 * All ~630 rows come down at once, deliberately. The chamber is small enough
 * that this is one request of a few hundred kilobytes, and every filter the
 * page offers — name, group, state, score — then answers instantly rather than
 * round-tripping. Server-side paging would cost a request per keystroke to
 * search a list that fits in memory. (`getMPsWithScores` caps at 700, which is
 * above the 635-row WP21 reality — see `MAX_PAGE` in convex/lib/ingest.ts for
 * why that ceiling is set where it is.)
 */

export const metadata: Metadata = {
  title: t("mps.title", DEFAULT_LOCALE),
  description: t("mps.subtitle", DEFAULT_LOCALE, { wahlperiode: CURRENT_WAHLPERIODE }),
}

export default async function MPsPage() {
  const preloaded = await preloadQuery(api.mps.getMPsWithScores, {
    wahlperiode: CURRENT_WAHLPERIODE,
  })

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <MPTable preloaded={preloaded} wahlperiode={CURRENT_WAHLPERIODE} />
    </main>
  )
}
