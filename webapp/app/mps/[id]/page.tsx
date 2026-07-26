import { fetchQuery } from "convex/nextjs"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { MPProfile } from "@/components/mp-profile"
import { api } from "@/convex/_generated/api"
import { CURRENT_WAHLPERIODE } from "@/lib/bundestag"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * One MP's profile.
 *
 * The route parameter is `mps.internalId` — the Bundestrack id the pipeline
 * mints — not a Convex `_id`. That is the header note of convex/schema.ts made
 * visible in the URL: the Bundestag publishes an MP under three incompatible
 * identifiers, Bundestrack mints its own, and every table and every link uses
 * it. `getMP` strips `_id` from its response for exactly this reason, so there
 * is no second identifier to accidentally route by.
 *
 * The roster row is fetched here and the rest of the page loads client-side.
 * The split is not arbitrary: this one read decides whether the page is a 404,
 * so it has to happen before anything renders, while the six panels below it
 * are independent, individually empty-able, and — for the score panel — live
 * under weights only the browser knows.
 */

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const mp = await fetchQuery(api.mps.getMP, {
    internalId: decodeURIComponent(id),
    wahlperiode: CURRENT_WAHLPERIODE,
  })
  // German, like the rest of the site's metadata: `generateMetadata` cannot see
  // the client-side language toggle. See the note in app/layout.tsx.
  if (!mp) return { title: t("common.notFound", DEFAULT_LOCALE) }
  return {
    title: mp.name,
    description: [mp.name, mp.fraktion, mp.constituency].filter(Boolean).join(" · "),
  }
}

export default async function MPProfilePage({ params }: Params) {
  const { id } = await params
  const internalId = decodeURIComponent(id)
  const mp = await fetchQuery(api.mps.getMP, {
    internalId,
    wahlperiode: CURRENT_WAHLPERIODE,
  })

  // A real 404 rather than an empty profile. An unknown id here is a bad link,
  // not an MP with no data — and §7.3's Stammdaten lag means "no mandate row"
  // is a state that genuinely occurs, so it must not render as a nameless page.
  if (!mp) notFound()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <MPProfile
        mp={mp}
        wahlperiode={CURRENT_WAHLPERIODE}
        // The heatmap window's last day, stamped once on the server so SSR and
        // hydration cannot straddle midnight and disagree about the grid.
        today={new Date().toISOString().slice(0, 10)}
      />
    </main>
  )
}
