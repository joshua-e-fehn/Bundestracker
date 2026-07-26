import type { Metadata } from "next"
import { CurrentPeriod } from "@/components/current-period"
import { PageHeading } from "@/components/page-heading"
import { Rankings } from "@/components/rankings"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/rankings` — the leaderboards.
 *
 * A server component that renders client ones, which is the shape AGENTS.md
 * asks for: pages are server components by default. The interactivity (tabs,
 * filters, sorting, paging) and the live Convex subscriptions live below this
 * boundary, so what ships as JS is the table and not the page.
 *
 * German metadata, matching the root layout's reasoning: `generateMetadata`
 * cannot see the client-side language toggle, so the tab title is the default
 * locale's while the page content follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("rankings.title", DEFAULT_LOCALE),
  description: t("rankings.subtitle", DEFAULT_LOCALE),
}

export default function RankingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="rankings.title" subtitleKey="rankings.subtitle" />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/current-period.tsx. */}
      <CurrentPeriod component={Rankings} />
    </main>
  )
}
