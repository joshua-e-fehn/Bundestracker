import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { CommitteeHeading } from "@/components/committee-heading"
import { CommitteeMembers } from "@/components/committee-members"
import { PeriodScope } from "@/components/period-scope"
import { parseCommitteeParam } from "@/lib/committees"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"
import { parsePeriodParam, PERIOD_PARAM } from "@/lib/period"

/**
 * `/committees/[id]` — one committee's roster.
 *
 * ## The route param is the committee name, verbatim
 *
 * `encodeURIComponent(name)` in the URL, `decodeURIComponent(name)` — Next
 * does that for us — as `params.id`. Not a slug: `lib/committees.ts` opens
 * with the reasoning, and it comes down to `Ausschuss für Digitales` and
 * `Ausschuss fur Digitales` being *two* committees the source names
 * differently, so any lossy folding would collapse two rows onto one URL and
 * pick one arbitrarily. `parseCommitteeParam` only rejects the segments that
 * cannot be a name at all — blank, or ASCII control characters — and
 * everything else reaches the roster component, which decides between
 * "unknown committee" and "period without published data".
 *
 * ## `notFound()` is used sparingly and deliberately
 *
 * Only when the URL segment itself cannot be a committee name — the same rule
 * `app/parties/[party]/page.tsx` uses for `isPartyKey`. An unknown-but-well-
 * formed name is *not* a 404: names can be recut mid-period (§6.3), so a
 * page addressable by a name that no longer exists is still a page a shared
 * link should reach, and the "no such committee for this period" message
 * inside `CommitteeMembers` explains the state.
 *
 * ⚠ Like other `[id]` boundaries on this site, `notFound()` under Next
 * 16.2.12 is served with HTTP 200 while rendering the not-found body — see
 * the note in `components/not-found-page.tsx`. The call stays because it is
 * correct and will produce the right status once the framework does.
 *
 * ## The back link's period is resolved here, not by the heading
 *
 * `searchParams` is read once, on the server, and the back href is passed to
 * `CommitteeHeading` as a plain string. That is why the heading takes
 * `backHref` rather than reading `useSearchParams` itself — see the note in
 * that file. The alternative was a second `<Suspense>` boundary above the
 * heading, and this shape is one fewer wrinkle.
 */

type SearchParams = { [key: string]: string | string[] | undefined }

type Params = {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}

/** Rebuild the `/committees` href with the same `?wp=` this URL carries.
 *
 * `parsePeriodParam` folds every bad value (empty string, `1e2`, negative,
 * out-of-range) to `null`, which produces a bare path. The parameter is only
 * written back when it round-trips, so a mistyped `?wp=nope` on the detail
 * page does not become `?wp=nope` on the list page. */
function backToListHref(searchParams: SearchParams): string {
  const raw = searchParams[PERIOD_PARAM]
  const requested = parsePeriodParam(typeof raw === "string" ? raw : null)
  return requested === null ? "/committees" : `/committees?${PERIOD_PARAM}=${requested}`
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const committeeName = parseCommitteeParam(id)
  if (committeeName === null) {
    return { title: t("common.notFound", DEFAULT_LOCALE) }
  }
  // German metadata, like every other page on the site: `generateMetadata`
  // cannot see the client-side language toggle. The tab title carries the
  // committee's own name — it is a proper noun in either language, and
  // Stammdaten prints only the German form.
  return {
    title: `${committeeName} — ${t("committees.title", DEFAULT_LOCALE)}`,
    description: t("committees.subtitle", DEFAULT_LOCALE),
  }
}

export default async function CommitteePage({ params, searchParams }: Params) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const committeeName = parseCommitteeParam(id)

  // The one condition that is a real 404: a segment that cannot be a
  // committee name — empty or a stray control-character escape. Everything
  // else is a well-formed address for a page that may or may not have
  // members in the current view.
  if (committeeName === null) notFound()

  const backHref = backToListHref(sp)

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <CommitteeHeading committeeName={committeeName} backHref={backHref} />
      {/* Same shape as every other detail route on the site: the *path*
          carries the committee and the *query string* carries the
          Bundestag. The name rides along as a serialisable prop through
          `PeriodScope`. */}
      <Suspense>
        <PeriodScope component={CommitteeMembers} props={{ committeeName }} />
      </Suspense>
    </main>
  )
}
