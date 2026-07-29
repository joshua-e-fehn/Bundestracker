"use client"

import { LogOutIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth-client"
import { initials } from "@/lib/format"

/**
 * Sign-in button, or the signed-in reader's avatar and menu.
 *
 * Signing in is optional on Bundestrack — every page is browsable without an
 * account, and an account only stores custom score weightings and a follow list
 * (see lib/auth-routes.ts). So this is a small affordance in the corner, not a
 * gate, and the signed-out state is the common one rather than the error one.
 *
 * ## Signed out, this is a link — it does not sign anyone in
 *
 * It used to call `authClient.signIn.social({ provider: "github" })` straight
 * from the click handler, so pressing "Anmelden" navigated the tab to
 * github.com with no intervening page. Two things were wrong with that: it
 * offered no choice between the two configured providers, and it handed the
 * reader to a third party before saying what an account is for — on a site
 * where the answer is *not* "to see the data", since all of it is public.
 *
 * So the button is now a link to `/sign-in`, and `components/sign-in-panel.tsx`
 * owns the OAuth call. One sign-in flow rather than two: a second `signIn`
 * call here is how the header ends up offering a provider the picker has
 * disabled (see lib/auth-providers.ts).
 *
 * ## ⚠ The first client render must be the skeleton, whatever the session says
 *
 * The server has no session, so `isPending` is always true there and the server
 * HTML always holds the `Skeleton` — a `<div>`. On the client the session can
 * resolve from Better Auth's own store *before* React hydrates, and then the
 * first client render returned the signed-out `Button` — an `<a>` — into the
 * same slot. A different **element type** at the same position is not a
 * recoverable difference: React throws
 *
 *   Hydration failed because the server rendered HTML didn't match the client
 *   (minified #418, args[]=HTML)
 *
 * and regenerates the tree from scratch, which in React 19 means detaching and
 * rebuilding the whole of `<head>`. Every hoisted `<meta>`/`<link>` React owns
 * is then a node whose `parentNode` is null, so the *next* commit — the first
 * client-side navigation the reader attempts — dies in the tag-26 unmount path:
 *
 *   Uncaught TypeError: Cannot read properties of null (reading 'removeChild')
 *
 * That is the production symptom this guard exists to prevent: on a cold load
 * the first click on any link did nothing at all. It is a race, so it only
 * appears when hydration is slow relative to the session resolving — measured
 * on www.bundestracker.de at 6× and 10× CPU throttling on every route, and
 * never at 1× or 4×, which is why it reads as "only on real phones" and never
 * reproduced on the machine it was written on.
 *
 * `mounted` is what makes the first client render unconditionally match the
 * server's: the skeleton renders until an effect has run, and effects do not
 * run until after hydration has committed. The same guard, for the same reason,
 * is in components/theme-toggle.tsx:42 — that one covers a differing *icon*,
 * this one a differing *element*, and only the latter is fatal.
 */
export function UserMenu({ className }: { className?: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  // See the ⚠ above: this is a hydration guard, not a loading flag. Effects run
  // only after hydration commits, so gating on it pins the first client render
  // to the branch the server took.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // A placeholder the same size as the button that replaces it, so the header
  // does not reflow when the session resolves.
  if (!mounted || isPending) {
    return <Skeleton className={`size-7 rounded-full ${className ?? ""}`} />
  }

  if (!session) {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link href="/sign-in">{t("auth.signIn")}</Link>
      </Button>
    )
  }

  const { user } = session
  // `image` is `string | null | undefined` — three states. AvatarImage with a
  // null src renders a broken image rather than falling through, so it is only
  // mounted when there is something to load.
  const image = user.image ?? undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label={t("auth.account")}>
          <Avatar size="sm">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate font-normal text-muted-foreground text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // `signOut` resolves to `{data, error}` and does not navigate, so
            // the refresh is ours to do — without it a page showing
            // signed-in-only state would keep showing it.
            void authClient.signOut().then(() => router.refresh())
          }}
        >
          <LogOutIcon />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
