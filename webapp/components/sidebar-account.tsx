"use client"

import { LogOutIcon, UserIcon } from "lucide-react"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { authClient } from "@/lib/auth-client"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The reader's account, at the foot of the sidebar.
 *
 * The rail's bottom slot used to hold the collapse control. That control is now
 * the first thing in the header (`components/sidebar-toggle.tsx` explains why),
 * and this takes the space it left — the position every app-shell puts the
 * account in, and the one place on this site where a signed-in reader's own
 * identity can sit without competing with the site's brand for the top-left
 * corner.
 *
 * ## It is the same menu, moved — not a second one
 *
 * `components/user-menu.tsx` is gone from the header rather than left beside
 * this: two account controls on one screen is exactly the "second way to do
 * something that already exists" the protocol rules out, and it is worse than
 * the usual case because the two would show the same avatar in two places and a
 * reader would have to learn which one signs them out. So the header's
 * `<UserMenu />` is deleted, this is where the account lives at `lg` and up, and
 * `components/nav-mobile.tsx` carries it in the drawer below that — the same
 * split the navigation itself already uses.
 *
 * The *contents* are unchanged and still real: the signed-in menu shows the
 * name and email Better Auth returns and signs out through `authClient`; the
 * signed-out state links to `/sign-in`, the page that owns the OAuth call. No
 * new routes are invented here — there is no settings page on this site yet, so
 * there is no entry pointing at one.
 *
 * ## ⚠ The first client render must match the server's
 *
 * The same hydration contract as `UserMenu`, and for the same reason spelled
 * out at length there: the server has no session, so the server HTML always
 * holds the `Skeleton`; on the client the session can resolve from Better
 * Auth's store *before* React hydrates, and returning a different **element
 * type** into that slot makes React throw #418, regenerate the tree, and detach
 * `<head>` — which kills the reader's next navigation with a null `removeChild`.
 * `mounted` is set from an effect, and effects do not run until hydration has
 * committed, so the first client render is pinned to the server's branch.
 *
 * That is guarded by `components/user-menu.test.ts`, which reads every file
 * that branches on `authClient.useSession()`.
 */
export function SidebarAccount({ expanded }: { expanded: boolean }) {
  const { t } = useLocale()
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  // See the ⚠ above: a hydration guard, not a loading flag.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted || isPending) {
    // Sized as the row it becomes, so the rail's foot does not jump when the
    // session resolves.
    return <Skeleton className={cn("h-9 rounded-md", expanded ? "w-full" : "mx-auto w-9")} />
  }

  if (!session) {
    const label = t("auth.signIn")
    const button = (
      <Button
        asChild
        variant="outline"
        size="sm"
        className={cn("h-9", expanded ? "w-full justify-start gap-2.5 px-2.5" : "w-9 px-0")}
      >
        {/* `aria-label` only when the text is not rendered — otherwise it would
            be the same string twice, and `aria-label` overrides content rather
            than adding to it. */}
        <Link href="/sign-in" aria-label={expanded ? undefined : label}>
          <UserIcon aria-hidden className="size-4 shrink-0" />
          {expanded && <span className="truncate">{label}</span>}
        </Link>
      </Button>
    )

    if (expanded) return button
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  const { user } = session
  // Three states — `string | null | undefined`. `AvatarImage` with a null src
  // renders a broken image rather than falling through to the fallback, so it
  // is only mounted when there is something to load.
  const image = user.image ?? undefined
  const name = user.name || user.email

  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        // Marks this row as an account surface, which the feedback
        // screenshot blacks out before rasterising — it renders a signed-in
        // reader's display name and their avatar. See lib/screenshot.ts.
        data-feedback-account=""
        // The rail's own hover colours rather than the button's default `muted`,
        // so the row reads as part of the sidebar it sits in.
        className={cn(
          "h-9 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          expanded ? "w-full justify-start gap-2.5 px-2" : "w-9 justify-center px-0",
        )}
        aria-label={t("auth.account")}
      >
        <Avatar size="sm">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        {/* The name beside the avatar when the rail has room for it. `min-w-0`
            on the grid so `truncate` engages — a flex item's `min-width: auto`
            floor is otherwise its content's full length, and a long display
            name would push the avatar out of a 16 rem rail. The same pairing
            the nav rows use; see components/nav-sidebar.tsx. */}
        {expanded && (
          <span className="grid min-w-0 flex-1 text-left">
            <span className="truncate font-medium text-sm">{name}</span>
          </span>
        )}
      </Button>
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu>
      {expanded ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {name}
          </TooltipContent>
        </Tooltip>
      )}

      {/* `side="top"` and `align="start"`: the menu opens from the bottom of a
          rail pinned to the bottom of the viewport, so the default `bottom`
          placement would have Radix flip it every time anyway. */}
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        {/* The reader's name and email address — the single most sensitive
            thing this app puts on screen, and the reason `data-feedback-account`
            exists. An open account menu at the moment a screenshot is taken
            would otherwise publish an address. */}
        <DropdownMenuLabel className="grid gap-0.5" data-feedback-account="">
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
