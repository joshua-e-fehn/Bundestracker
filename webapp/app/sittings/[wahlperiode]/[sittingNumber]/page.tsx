import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SittingDetail } from "@/components/sitting-detail"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"
import { parseSittingParams } from "@/lib/sitting"

/**
 * One plenary sitting: the speeches given in it, in document order, and the
 * named ballots cast in it, in ballot-number order.
 *
 * ## Why the route is `(wahlperiode, sittingNumber)` and not a Convex id
 *
 * A sitting has no row of its own in this schema — it is only ever the natural
 * key of a speech (§5.2, `by_wahlperiode_and_sitzungnr_and_mpInternalId_and_speechIndex`)
 * or of a ballot (`by_wahlperiode_and_sitzungnr_and_abstimmnr`). So there is
 * no id to route by. `(wahlperiode, sitzungnr)` is the pair the source itself
 * uses to name a sitting — the URL of the protocol PDF is
 * `btp/21/21090.pdf` — and it is the only key that reaches both queries below
 * without inventing one.
 *
 * The two segments are the two halves of the pair, spelled out rather than
 * squashed together. `/sittings/21/90` reads the way §5.1 talks about
 * protocols and the way `mp.sitting` labels a row on a profile, and it makes
 * the sharing URL a reader can hand-type.
 *
 * ## Everything is decided client-side, unlike /votes/[id]
 *
 * That page loads a `voteSheets` row on the server so it can decide 404 before
 * anything renders. A sitting is not a row: an unknown `(wp, sitzungnr)` here
 * has to be answered by the *absence* of speeches and ballots for it, which
 * is a claim we can only make once both queries have resolved. So this route
 * validates the parameters — a bad shape *is* a 404, before any query runs —
 * and hands the pair to `SittingDetail`, which subscribes and decides how to
 * render the four states honest sources permit: loading, populated,
 * period-not-backfilled, no-records.
 *
 * Metadata is the same shape as `/mps/[id]`: the number goes in the title so
 * a browser tab shows it, the description names the sitting fully. German,
 * like every other server-rendered title on the site — `generateMetadata`
 * cannot see the client-side language toggle (app/layout.tsx).
 */

type Params = { params: Promise<{ wahlperiode: string; sittingNumber: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const raw = await params
  const parsed = parseSittingParams(raw.wahlperiode, raw.sittingNumber)
  if (!parsed) return { title: t("common.notFound", DEFAULT_LOCALE) }
  return {
    title: t("sitting.metaTitle", DEFAULT_LOCALE, {
      wahlperiode: parsed.wahlperiode,
      sitzungnr: parsed.sitzungnr,
    }),
    description: t("sitting.metaDescription", DEFAULT_LOCALE, {
      wahlperiode: parsed.wahlperiode,
      sitzungnr: parsed.sitzungnr,
    }),
  }
}

export default async function SittingPage({ params }: Params) {
  const raw = await params
  const parsed = parseSittingParams(raw.wahlperiode, raw.sittingNumber)
  // A bad URL is a 404 — the pair `wp=abc/sitzungnr=xyz` names nothing.
  // Absence of records for a well-formed pair is a *different* state, decided
  // by the client below once the queries resolve, because that is a claim
  // about the data rather than about the URL.
  if (!parsed) notFound()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <SittingDetail wahlperiode={parsed.wahlperiode} sitzungnr={parsed.sitzungnr} />
    </main>
  )
}
