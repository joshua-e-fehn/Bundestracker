"use client"

import { LogOutIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
 */
export function UserMenu({ className }: { className?: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  // A placeholder the same size as the button that replaces it, so the header
  // does not reflow when the session resolves.
  if (isPending) {
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
