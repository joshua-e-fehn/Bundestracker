import type { Metadata } from "next"
import { Suspense } from "react"
import { InquiryQuorum } from "@/components/inquiry-quorum"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

/**
 * `/inquiry-quorum` — the Untersuchungsausschuss quarter, as arithmetic.
 *
 * ## Why this page is here
 *
 * Art. 44(1) GG makes a committee of inquiry a *minority* right: a quarter of
 * the members can compel one, and the majority cannot stop it. That makes the
 * question of who can reach a quarter a question about seat counts — which is
 * the one seating fact §9 of docs/api-research.md says is derivable — and this
 * site already counts them.
 *
 * What it does not have, and what the page needs to be worth reading, is which
 * groups have ruled out working with which. No Bundestag dataset records that,
 * so it is a hand-maintained constant (`RULED_OUT` in lib/inquiry.ts) in the
 * same class as `GOVERNING_PARTIES`, and the page marks it as one at full
 * contrast rather than in a footnote. The rule the codebase follows for this
 * kind of claim is set out in lib/seating.ts and components/seating-notice.tsx;
 * this page follows it because the alternative is spending the site's premise —
 * that every figure is checkable — on a page that did not have to.
 *
 * A server component rendering a client one, the shape AGENTS.md asks for: the
 * Convex subscription and the combination filter live below this boundary.
 *
 * ## The period, and why this page carries one at all
 *
 * The quarter is arithmetic over seat counts, so it is answerable for any
 * period whose roster is loaded — and it is a genuinely different answer in
 * each: WP20's 736 seats and its six groups produce a different threshold and a
 * different set of combinations from WP21's. That makes the selector here a
 * feature rather than a consequence of adding it everywhere.
 *
 * ⚠ `RULED_OUT` in lib/inquiry.ts is a hand-maintained record of which groups
 * have ruled out working with which, and it describes the **present**
 * political situation. On a historical period it is therefore an anachronism —
 * a WP19 combination marked "ruled out" is marked so by a statement made years
 * later. The page says as much where the table says it, rather than letting a
 * current fact be read as a historical one.
 *
 * The period defaults to the current one and writes no parameter there — a
 * hardcoded 21 would keep computing a quarter of a chamber that no longer
 * sits, months after WP22 is elected.
 *
 * Locale-aware metadata via `resolveServerLocale` — see app/layout.tsx for the
 * cookie → header → German precedence.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("inquiry.title", locale),
    description: t("inquiry.subtitle", locale),
  }
}

export default function InquiryQuorumPage() {
  return (
    // `max-w-5xl`, between the `max-w-6xl` of the data pages and the
    // `max-w-4xl` of /about, because this page is both: two wide tables and a
    // run of explanatory prose. The tables need more than a prose measure; the
    // prose would run to ~140 characters at `6xl`.
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="inquiry.title" subtitleKey="inquiry.subtitle" />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/period-scope.tsx — and
          app/rankings/page.tsx for why the `Suspense` boundary is required. */}
      <Suspense>
        <PeriodScope component={InquiryQuorum} />
      </Suspense>
    </main>
  )
}
