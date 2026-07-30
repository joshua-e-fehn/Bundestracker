import { fetchQuery } from "convex/nextjs"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { VoteDetail } from "@/components/vote-detail"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

/**
 * One named ballot — `/votes/[id]`.
 *
 * ## The route parameter is a Convex id, unlike `/mps/[id]`
 *
 * That page routes by `mps.internalId`, the identifier Bundestrack mints,
 * because an MP has three incompatible external ids and none of them is
 * canonical (convex/schema.ts). A ballot has the opposite problem: its natural
 * key is a *triple* — `(wahlperiode, sitzungnr, abstimmnr)` — and a URL built
 * from three segments is one the list page would have to reassemble on every
 * row when it already holds the row's identity. So this routes by the Convex
 * id, and `getVoteSheetsByKey` (convex/votes.ts) serves the natural-key form
 * for callers with the sheet number from an official document — `/votes/own-
 * resources` is the one today. An earlier single-row `getVoteSheet` query
 * covered the same case with `.first()`; it was removed after no caller
 * materialised, and its role sits with `getVoteSheetsByKey` now.
 *
 * ## Validating the id before the query
 *
 * `ctx.db.get` returns null for a well-formed id naming no row, but *throws*
 * for a string that is not an id of that table at all — so `/votes/nonsense`
 * would be a 500 rather than a 404. `looksLikeId` is the guard, and it is
 * deliberately a shape check rather than a parse: Convex ids are opaque, so the
 * only honest local test is "could this be one", and anything that passes and
 * still names nothing comes back null and takes the same 404 path.
 *
 * The sheet is fetched here rather than in the client component because this
 * one read decides whether the page is a 404, which has to happen before
 * anything renders — the same split as app/mps/[id]/page.tsx.
 */

type Params = { params: Promise<{ id: string }> }

/**
 * Whether `value` could be a Convex document id.
 *
 * Convex ids are URL-safe base32-ish strings of a fixed-ish length. This
 * rejects the obvious non-ids — an empty segment, a path, a sentence — without
 * pretending to validate the encoding, which only the backend can do.
 */
function looksLikeId(value: string): boolean {
  return /^[a-z0-9_-]{16,64}$/i.test(value)
}

async function loadSheet(rawId: string) {
  if (!looksLikeId(rawId)) return null
  return await fetchQuery(api.votes.getVoteSheetById, { id: rawId as Id<"voteSheets"> })
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [{ id }, locale] = await Promise.all([params, resolveServerLocale()])
  const data = await loadSheet(decodeURIComponent(id))
  // The ballot's title is language-agnostic; only the not-found fallback needs
  // a locale. See app/layout.tsx for the cookie → header → German precedence.
  if (!data) return { title: t("common.notFound", locale) }
  return {
    title: data.sheet.title,
    description: [data.sheet.result, data.sheet.date].filter(Boolean).join(" · "),
  }
}

export default async function VoteDetailPage({ params }: Params) {
  const { id } = await params
  const data = await loadSheet(decodeURIComponent(id))

  // A real 404 rather than an empty ballot: an unknown id here is a bad link,
  // not a vote nobody attended.
  if (!data) notFound()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <VoteDetail
        sheet={data.sheet}
        records={data.records}
        tallied={data.tallied}
        breakdown={data.breakdown}
        rebelCount={data.rebelCount}
      />
    </main>
  )
}
