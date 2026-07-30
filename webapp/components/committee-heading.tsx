"use client"

import Link from "next/link"
import { useLocale } from "@/components/providers/locale-provider"

/**
 * A committee page's title, standfirst, and way back.
 *
 * `PageHeading` cannot serve here: the title *is* the committee's own name —
 * a proper noun that must not be translated, and one this component receives
 * as data rather than as a translation key. Same shape as
 * `components/party-heading.tsx`, and for the same reason: the string enters
 * the render as a value, not as a key.
 *
 * ## The back link carries `?wp=` because the *server* resolved it
 *
 * `backHref` is computed once by the enclosing page from `searchParams` and
 * passed down as a plain string. Reading `useSearchParams` inside this
 * client component would have worked, but it forces a `<Suspense>` boundary
 * above every render — the boundary that opts the subtree out of static
 * generation. Since the value is known at request time and does not
 * subscribe to anything, the server computation is both simpler and one
 * fewer client-tree wrinkle.
 *
 * A reader on `/committees/…?wp=19` who clicks the back link lands on
 * `/committees?wp=19`, not on the current period. `PartyHeading` under
 * `/parties/[party]` does *not* preserve the parameter today — its back
 * link is a bare `/parties` — and the divergence is deliberate: the task
 * for this route says the period must survive navigation, and losing it
 * silently is the failure the resolved `backHref` prevents.
 */
export function CommitteeHeading({
  committeeName,
  backHref,
}: {
  committeeName: string
  backHref: string
}) {
  const { t } = useLocale()

  return (
    <header className="flex flex-col gap-2">
      <Link
        href={backHref}
        className="w-fit rounded-md text-muted-foreground text-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        ← {t("committees.backToCommittees")}
      </Link>
      <h1 className="font-semibold text-3xl tracking-tight">{committeeName}</h1>
    </header>
  )
}
