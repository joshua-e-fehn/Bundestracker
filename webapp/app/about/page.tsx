import type { Metadata } from "next"
import { AboutPage } from "@/components/about-page"
import { PageHeading } from "@/components/page-heading"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/about` — what the numbers on this site mean, in one place.
 *
 * ## Why a page, when the caveats are already everywhere
 *
 * They are, and they stay: `components/caveat-note.tsx` renders on five pages
 * for the reason its header gives — a limit belongs beside the figure it
 * qualifies, because a low number that means "not published" is misread in the
 * half-second before anyone clicks an "about" link.
 *
 * But a caveat beside a bar answers "what does *this* number not say", and it
 * cannot answer the question a sceptic actually arrives with: *does this thing
 * measure parliamentary work at all?* That objection is raised by sitting
 * members, it is correct, and until now the site had fifteen partial answers to
 * it and no whole one. This page is the whole one, and the sections are ordered
 * so the answer arrives before the defence of the method: what is counted, then
 * what is not, then where it comes from.
 *
 * ## It restates nothing
 *
 * Every limit here is already in the dictionary somewhere. The rule followed
 * while writing it was to reuse the existing string wherever the claim is the
 * same one — `home.bottomMPsCaveat`, `parties.disciplineCaveat`,
 * `score.caveat.*`, `votes.namedOnlyNotice`, `seating.syntheticNotice` — and to
 * add a key only for something no page says today. Two phrasings of one caveat
 * would drift, and the drift would be the site contradicting itself about its
 * own honesty.
 *
 * A server component rendering a client one, the shape AGENTS.md asks for and
 * the same split /parties and /votes use. Nothing here subscribes to Convex —
 * the page is prose, and the score table below reads `DEFAULT_WEIGHTS` from
 * lib/scoring.ts, not from the database — so `AboutPage` is a client component
 * only because it is translated.
 *
 * German metadata, matching every other route: `generateMetadata` cannot see
 * the client-side language toggle, so the tab title is the default locale's
 * while the page follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("about.title", DEFAULT_LOCALE),
  description: t("about.subtitle", DEFAULT_LOCALE),
}

export default function About() {
  return (
    // `max-w-4xl`, narrower than the `max-w-6xl` the data pages use. This is
    // the one page on the site that is mostly prose, and a 1 100 px measure is
    // roughly 140 characters — twice a readable line. /search makes the same
    // call for the same reason.
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <PageHeading titleKey="about.title" subtitleKey="about.subtitle" />
      <AboutPage />
    </main>
  )
}
