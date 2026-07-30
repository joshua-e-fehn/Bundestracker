import type { Metadata } from "next"
import { Suspense } from "react"
import { MPRoster } from "@/components/mp-roster"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"
import { CURRENT_WAHLPERIODE } from "@/lib/period"

/**
 * The roster — every MP of the Wahlperiode `?wp=` names, filterable and
 * sortable.
 *
 * ## Why this stopped being a `preloadQuery` page
 *
 * It used to be a server component that preloaded `getMPsWithScores` for
 * `CURRENT_WAHLPERIODE` and handed the result to `MPTable`. That is the split
 * AGENTS.md asks for and it was right while the period was a constant. It stops
 * working the moment the period comes from the URL, for a reason that is not
 * obvious and is worth writing down rather than rediscovering:
 *
 * `preloadQuery` runs on the server and returns a `Preloaded<...>` bound to the
 * arguments it was called with. Those arguments are fixed at request time. So a
 * reader switching from WP21 to WP19 with the client-side router gets a *new
 * URL* and the *same preloaded WP21 roster*, because nothing on the server ran
 * again — and `usePreloadedQuery` would keep answering with it. The page would
 * show the WP19 heading over the WP21 chamber, which is precisely the class of
 * plausible-wrong-page this codebase refuses everywhere else.
 *
 * The alternatives were: read `searchParams` here and preload per period (a
 * server round-trip on every period switch, and a full document navigation
 * where the rest of the site does a client one), or fetch in the browser like
 * every other list page already does. The second is what the rest of the site
 * does — `/rankings`, `/feed`, `/votes` and `/parties` are all client-side
 * `useQuery` under a server shell — so it is also the choice that leaves one
 * pattern rather than two.
 *
 * What is lost is the server-rendered first paint of the table. That is a
 * smaller loss than it sounds and app/dashboard/page.tsx already argues it: the
 * language toggle is client state, so every string here is client-rendered
 * regardless, and `useQuery` degrades to a skeleton where `preloadQuery` turns
 * an unreachable Convex deployment into a 500 for the whole page.
 *
 * All ~630 rows still come down at once, deliberately. The chamber is small
 * enough that this is one request of a few hundred kilobytes, and every filter
 * the page offers — name, group, state, score — then answers instantly rather
 * than round-tripping. (`getMPsWithScores` caps at 700, which is above the
 * 635-row WP21 reality and above WP20's 772 mandate rows only because those are
 * mandates rather than seats — see `MAX_PAGE` in convex/lib/ingest.ts.)
 *
 * ## The metadata keeps the constant
 *
 * `generateMetadata` cannot await a Convex query without blocking the document
 * head on an uncached read, and it cannot see `?wp=` in a way that would help —
 * `CURRENT_WAHLPERIODE` is the documented fallback for exactly this caller;
 * see the note on it. The locale itself is negotiated per request via
 * `resolveServerLocale` (see app/layout.tsx), so the tab title matches the
 * reader's saved language rather than the site's default.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("mps.title", locale),
    description: t("mps.subtitle", locale, { wahlperiode: CURRENT_WAHLPERIODE }),
  }
}

export default function MPsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {/* `Suspense` is required, not decorative — the roster reads the period
          from `useSearchParams`, which opts its subtree out of static
          prerendering, and Next.js fails the *build* without a boundary above
          it. app/search/page.tsx carries the same note. */}
      <Suspense>
        <MPRoster />
      </Suspense>
    </main>
  )
}
