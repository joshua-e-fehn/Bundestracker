import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { VoteList } from "@/components/vote-list"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/votes` — every named ballot in the Wahlperiode `?wp=` names.
 *
 * A server component rendering client ones, the shape AGENTS.md asks for: the
 * filters, the pager and the live Convex subscription live below this boundary,
 * so what ships as JS is the table rather than the page.
 *
 * The period defaults to the current one and is *not* written into the URL
 * there — `/votes` is this Bundestag, not `/votes?wp=21`, for the reason
 * `periodHref` gives: a pinned 21 names the previous chamber for months after
 * WP22 is sworn in.
 *
 * ⚠ This is the page where the vote-data boundary bites hardest. Roll-call
 * sheets begin **2019-09-26**, part-way through WP19
 * (`docs/historical-coverage.md`), so WP18 and earlier have no ballots at all
 * and WP19 has only its tail. `VoteList` states which of the two an empty list
 * is rather than leaving it as a bare zero — a page of no ballots reads as a
 * parliament that never divided.
 *
 * German metadata, matching the rest of the site: `generateMetadata` cannot see
 * the client-side language toggle, so the tab title is the default locale's
 * while the page content follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("votes.title", DEFAULT_LOCALE),
  description: t("votes.subtitle", DEFAULT_LOCALE),
}

export default function VotesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="votes.title" subtitleKey="votes.subtitle" />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/period-scope.tsx — and
          app/rankings/page.tsx for why the `Suspense` boundary is required. */}
      <Suspense>
        <PeriodScope component={VoteList} />
      </Suspense>
    </main>
  )
}
