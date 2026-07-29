import { fetchQuery } from "convex/nextjs"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { MPProfileScope } from "@/components/mp-profile-scope"
import { api } from "@/convex/_generated/api"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"
import { CURRENT_WAHLPERIODE, PERIOD_PARAM, parsePeriodParam } from "@/lib/period"

/**
 * One MP's profile, in one Wahlperiode.
 *
 * The route parameter is `mps.internalId` — the Bundestrack id the pipeline
 * mints — not a Convex `_id`. That is the header note of convex/schema.ts made
 * visible in the URL: the Bundestag publishes an MP under three incompatible
 * identifiers, Bundestrack mints its own, and every table and every link uses
 * it. `getMP` strips `_id` from its response for exactly this reason, so there
 * is no second identifier to accidentally route by.
 *
 * ## The period is the second half of the address
 *
 * `internalId` alone does not name a page. A person is on the roster once *per
 * mandate*, `mps` is keyed on `(internalId, wahlperiode)`, and every panel
 * below — score, committees, trends, activities, contact — reads that pair. So
 * `/mps/bt-0001` is this person's *current* mandate and `/mps/bt-0001?wp=19` is
 * their WP19 one, and both are real pages about the same human being.
 *
 * This page used to pass `CURRENT_WAHLPERIODE` unconditionally. The consequence
 * was measured rather than theorised: an MP who sat in WP19 and not since —
 * Martin Hohmann, in the frontend check `.logs/historical-backfill-final.md`
 * §7 records — **404ed**, on a site holding their complete WP19 record. The
 * roster row exists; nothing could ask for it.
 *
 * ## A current profile URL is unchanged
 *
 * `/mps/bt-0001` still resolves to the current mandate, because an absent `wp`
 * means the current period everywhere (`lib/period.ts`). Every link that
 * existed before this change therefore still points where it did — the
 * parameter is additive, and the bare form is still the one the site writes for
 * a sitting member.
 *
 * ## Why the 404 decision moved into the client
 *
 * It used to happen here: one server `fetchQuery` for the mandate, `notFound()`
 * if it was null, and the panels below rendered client-side. That works for a
 * fixed period and cannot work for a switchable one — a reader moving from
 * WP21 to WP19 with the client router never re-runs this function, so the
 * profile would keep rendering the WP21 mandate under a WP19 URL. The same
 * hazard app/mps/page.tsx documents for `preloadQuery`, in its sharper form:
 * here the stale value decides whether the page exists.
 *
 * So the server still fetches — for the metadata, which genuinely is
 * per-request — and `MPProfileScope` owns the mandate lookup for the rendered
 * page, including the three ways it can be absent: wrong id, period not
 * backfilled, and person who did not sit in this period. Those were one 404
 * before and are three different sentences now.
 *
 * `notFound()` survives here for the one case it can still decide from the
 * server: an id that matches no mandate in *any* period, which is a bad link
 * rather than a period question.
 */

type Params = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** The `?wp=` of a server-side request, if it names a period.
 *
 * `searchParams` hands a value that may be an array — Next repeats duplicate
 * keys rather than dropping them — so `?wp=19&wp=20` arrives as `["19","20"]`.
 * The first wins, which matches what `URLSearchParams.get` does on the client
 * and keeps the two sides agreeing about a URL nobody should write but anyone
 * can. */
function periodFrom(searchParams: Record<string, string | string[] | undefined>): number | null {
  const raw = searchParams[PERIOD_PARAM]
  return parsePeriodParam(Array.isArray(raw) ? raw[0] : raw)
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams])
  // The URL's period, or the constant. Not `mps.getCurrentWahlperiode`: that is
  // a second uncached round-trip before the document head can be written, on a
  // page that is already fetching the mandate. See the note on
  // `CURRENT_WAHLPERIODE` for why this caller is the one it exists for.
  const wahlperiode = periodFrom(query) ?? CURRENT_WAHLPERIODE
  const mp = await fetchQuery(api.mps.getMP, {
    internalId: decodeURIComponent(id),
    wahlperiode,
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

  // Every mandate this person has ever held, in any period — a bounded read
  // (`getMPMandates` collects, and the bound is the number of Wahlperioden).
  // Empty means the id names nobody, which is a bad link and the one 404 that
  // is still a server-side decision. A person who *exists* but did not sit in
  // the requested period is a different answer and is made below, where the
  // period is known and can change without another request.
  const mandates = await fetchQuery(api.mps.getMPMandates, { internalId })
  if (mandates.length === 0) notFound()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <MPProfileScope
        internalId={internalId}
        // The heatmap window's last day, stamped once on the server so SSR and
        // hydration cannot straddle midnight and disagree about the grid.
        today={new Date().toISOString().slice(0, 10)}
      />
    </main>
  )
}
