import type { Metadata } from "next"
import { Suspense } from "react"
import { ActivityFeed } from "@/components/activity-feed"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

/**
 * `/feed` — the chamber-wide activity feed, for the Wahlperiode `?wp=` names.
 *
 * Same shape as `/rankings`: a server component wrapping client ones, so the
 * page itself ships no JS and the live Convex subscription lives below the
 * boundary. Locale-aware metadata via `resolveServerLocale` — see
 * app/layout.tsx for the cookie → header → German precedence.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("feed.title", locale),
    description: t("feed.subtitle", locale),
  }
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
