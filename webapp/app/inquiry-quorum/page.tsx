import type { Metadata } from "next"
import { CurrentPeriod } from "@/components/current-period"
import { InquiryQuorum } from "@/components/inquiry-quorum"
import { PageHeading } from "@/components/page-heading"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

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
 * Convex subscription and the combination filter live below this boundary. The
 * period is resolved by `CurrentPeriod` rather than carried in the URL, for the
 * reason that component gives — a hardcoded 21 keeps naming the previous
 * Bundestag for months after WP22 is elected, which on *this* page would mean
 * computing a quarter of a chamber that no longer sits.
 *
 * German metadata, matching every other route: `generateMetadata` cannot see the
 * client-side language toggle, so the tab title is the default locale's while
 * the page content follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("inquiry.title", DEFAULT_LOCALE),
  description: t("inquiry.subtitle", DEFAULT_LOCALE),
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
          the server/client boundary. See components/current-period.tsx. */}
      <CurrentPeriod component={InquiryQuorum} />
    </main>
  )
}
