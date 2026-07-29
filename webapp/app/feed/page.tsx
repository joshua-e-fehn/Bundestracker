import type { Metadata } from "next"
import { Suspense } from "react"
import { ActivityFeed } from "@/components/activity-feed"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/feed` — the chamber-wide activity feed, for the Wahlperiode `?wp=` names.
 *
 * Same shape as `/rankings`: a server component wrapping client ones, so the
 * page itself ships no JS and the live Convex subscription lives below the
 * boundary. See app/rankings/page.tsx for the metadata-locale note and for why
 * the `Suspense` boundary is required rather than decorative.
 */
export const metadata: Metadata = {
  title: t("feed.title", DEFAULT_LOCALE),
  description: t("feed.subtitle", DEFAULT_LOCALE),
}

export default function FeedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="feed.title" subtitleKey="feed.subtitle" />
      {/* The component itself, not a closure over it — see app/rankings/page.tsx. */}
      <Suspense>
        <PeriodScope component={ActivityFeed} />
      </Suspense>
    </main>
  )
}
