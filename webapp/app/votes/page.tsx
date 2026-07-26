import type { Metadata } from "next"
import { CurrentPeriod } from "@/components/current-period"
import { PageHeading } from "@/components/page-heading"
import { VoteList } from "@/components/vote-list"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/votes` — every named ballot in the current electoral period.
 *
 * A server component rendering client ones, the shape AGENTS.md asks for: the
 * filters, the pager and the live Convex subscription live below this boundary,
 * so what ships as JS is the table rather than the page.
 *
 * The period is resolved by `CurrentPeriod` rather than carried in the URL, for
 * the reason that component gives at length — `/votes` should be the current
 * Bundestag, and a hardcoded 21 keeps showing the previous one for months after
 * WP22 is elected.
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
          the server/client boundary. See components/current-period.tsx. */}
      <CurrentPeriod component={VoteList} />
    </main>
  )
}
