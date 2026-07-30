"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

/**
 * The signed-out reader's way in, at the top-right of the header.
 *
 * ## Why this is not the second account control the shell rules out
 *
 * `components/sidebar-account.tsx` is the *account*: an avatar, the reader's
 * name and email, and the sign-out item. There is one of it, at the foot of the
 * rail and of the drawer, and this does not duplicate it — because this renders
 * **nothing at all once there is a session**. The two are never on screen
 * together, so a signed-in reader still has exactly one avatar, one menu, and
 * one place to sign out, which is the property the earlier `<UserMenu />`
 * removal was protecting.
 *
 * What it restores is the other half, which that removal took with it: for a
 * signed-out reader the only route to `/sign-in` was the foot of the sidebar —
 * a rail that may be collapsed to 56 px of glyphs, and one whose bottom slot is
 * the last place on the page anyone looks. "Sign in" is the single most
 * conventional thing in a header's top-right corner, and it is the one control
 * whose whole audience is people who have not learned this site's chrome yet.
 * Duplicating it in both places for signed-out readers is deliberate.
 *
 * ## ⚠ The first client render must match the server's
 *
 * The same hydration contract as `SidebarAccount`, and it is guarded by the
 * directory walk in `components/sidebar-account.test.ts`: the server has no
 * session and always renders the `Skeleton`, while on the client the session
 * can resolve from Better Auth's store *before* React hydrates. Returning a
 * different element type — or nothing — into that slot on the first client
 * render is React #418, which regenerates the tree and detaches `<head>`, and
 * costs the reader their next navigation. `mounted` is set from an effect, and
 * effects do not run until hydration has committed.
 */
export function HeaderSignIn({ className }: { className?: string }) {
  const { t } = useLocale()
  const { data: session, isPending } = authClient.useSession()

  // See the ⚠ above: a hydration guard, not a loading flag.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted || isPending) {
    // Sized as the button it becomes, so the control cluster does not shuffle
    // sideways when the session resolves. `hidden sm:inline-flex` is on the
    // skeleton too — see the note on the button below — or the placeholder
    // would crowd the phone that the button itself steps aside for.
    return <Skeleton className={cn("hidden h-7 w-20 rounded-lg sm:block", className)} />
  }

  // Signed in: the account lives in the rail and the drawer, and a second
  // control here would be the duplicate this component exists not to be.
  if (session) return null

  return (
    // `hidden sm:inline-flex` — the one breakpoint on this control, and it is
    // measured rather than cautious. At 390 px the bar already holds the brand
    // and three controls, and adding a 66 px button ("Anmelden" is wider still)
    // clipped the wordmark to "Bundestra…" — the truncation the brand's own
    // note describes as its last resort at 320 px, now firing on a common phone
    // for a control that is *already* in the drawer's footer two taps away.
    //
    // So this is additive where there is room and silent where there is not,
    // which keeps it from being the thing that squeezes the masthead. Nothing
    // is lost below `sm`: `components/nav-mobile.tsx` carries the same
    // signed-out sign-in at the foot of the drawer, pinned there and reachable
    // without scrolling.
    <Button asChild variant="outline" size="sm" className={cn("hidden sm:inline-flex", className)}>
      <Link href="/sign-in">{t("auth.signIn")}</Link>
    </Button>
  )
}
