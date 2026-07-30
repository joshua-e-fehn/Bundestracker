import type { Metadata } from "next"
import { Suspense } from "react"
import { CommitteeDirectory } from "@/components/committee-directory"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

/**
 * `/committees` — the directory of standing committees for the Wahlperiode
 * `?wp=` names.
 *
 * ## What this page does not claim
 *
 * The header comment on `convex/committees.ts` opens with the fact this page
 * has to carry: MdB-Stammdaten is the **only** machine-readable committee
 * source in existence, and it covers the current Wahlperiode alone (§6.3 and
 * §6.4 of docs/api-research.md). So `/committees?wp=19` cannot list
 * committees — not because none existed, but because none was ever published.
 * `SourceCoverageNote source="committees"` under the heading renders that
 * distinction on every closed period; without it, an empty list would read as
 * "this parliament had no committees" and be false.
 *
 * The referrals on the neighbouring `convex/committeeReferrals.ts` table are
 * a fact about *bills* — one row per bill sent to one committee, not per
 * member on it. They are deliberately not shown here: this is a page about
 * membership, and a section titled "referrals" beside a membership list
 * would flatten two different questions into one number. Referral coverage
 * has its home on motion and profile surfaces where a bill is the subject.
 *
 * ## Server component, client child
 *
 * The same split every directory page uses (`app/parties/page.tsx`,
 * `app/mps/page.tsx`): the page is a server component so the tab title is
 * server-rendered, and the interactive parts (`PeriodScope`'s
 * `useSearchParams`, the search filter's state) sit under a client boundary
 * inside `CommitteeDirectory`. The `Suspense` is required because
 * `PeriodScope` reads `useSearchParams`, which opts its subtree out of static
 * prerender and fails the build without a boundary above it — the same note
 * `app/rankings/page.tsx` and `app/search/page.tsx` carry.
 *
 * Locale-aware metadata via `resolveServerLocale` — see app/layout.tsx for the
 * cookie → header → German precedence, and app/metadata-locale.test.ts for the
 * scan that refuses a page that ships static metadata or forgets the helper.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("committees.title", locale),
    description: t("committees.subtitle", locale),
  }
}

export default function CommitteesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="committees.title" subtitleKey="committees.subtitle" />
      <Suspense>
        <PeriodScope component={CommitteeDirectory} />
      </Suspense>
    </main>
  )
}
