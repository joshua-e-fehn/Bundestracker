import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { Rankings } from "@/components/rankings"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/rankings` — the leaderboards, for the Wahlperiode `?wp=` names.
 *
 * A server component that renders client ones, which is the shape AGENTS.md
 * asks for: pages are server components by default. The interactivity (tabs,
 * filters, sorting, paging) and the live Convex subscriptions live below this
 * boundary, so what ships as JS is the table and not the page.
 *
 * `Suspense` is required, not decorative: `PeriodScope` reads
 * `useSearchParams` to find the period, which opts its subtree out of static
 * prerendering, and Next.js fails the *build* for a component that reads it
 * without a boundary above. app/search/page.tsx carries the same note. The
 * fallback is deliberately absent — `PeriodScope` renders its own skeleton
 * while the period list resolves, so a second one here would be a skeleton
 * replacing a skeleton.
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
          the server/client boundary. See components/period-scope.tsx. */}
      <Suspense>
        <PeriodScope component={Rankings} />
      </Suspense>
    </main>
  )
}
