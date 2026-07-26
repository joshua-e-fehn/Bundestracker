import type { Metadata } from "next"
import { ActivityFeed } from "@/components/activity-feed"
import { CurrentPeriod } from "@/components/current-period"
import { PageHeading } from "@/components/page-heading"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/feed` — the chamber-wide activity feed.
 *
 * Same shape as `/rankings`: a server component wrapping client ones, so the
 * page itself ships no JS and the live Convex subscription lives below the
 * boundary. See app/rankings/page.tsx for the metadata-locale note.
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
      <CurrentPeriod component={ActivityFeed} />
    </main>
  )
}
