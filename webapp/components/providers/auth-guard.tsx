"use client"

import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation"
import { useEffect } from "react"
import { authClient } from "@/lib/auth-client"
import { isPublicPath } from "@/lib/auth-routes"

/**
 * Client-side session gate.
 *
 * On Bundestrack every path is public today (see lib/auth-routes.ts), so this
 * renders children immediately and never redirects. It is wired into the root
 * layout anyway, because the day a private route is added the gate has to
 * already be in the tree — retrofitting it later means auditing every page.
 *
 * The session check is client-side rather than in middleware because with
 * cross-domain auth the cookie lives on the Convex site URL. This component is
 * also what notices a session expiring while the app is open.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()
  const pathname = usePathname()
  const isNotFound = useSelectedLayoutSegment() === "/_not-found"

  /**
   * A 404 is public, whatever its URL says.
   *
   * `isPublicPath` answers "may a signed-out reader see this *page*", and it
   * answers by matching the path against a list. An unmatched URL therefore
   * came back `false` — correct for a real private route, wrong for a route
   * that does not exist, because there is no page there to protect. The
   * consequence was visible and confusing: /this-does-not-exist returned a
   * genuine 404 from the server, rendered app/not-found.tsx, and was then
   * client-redirected to /sign-in a beat later. A reader who mistyped a URL
   * was asked to sign in, on a site whose whole content is public, and the
   * app-wide 404 that app/not-found.tsx exists to serve was unreachable.
   *
   * `useSelectedLayoutSegment` reports Next's internal `/_not-found` segment
   * when the router has matched nothing, which is the only signal available on
   * the client that distinguishes "no such route" from "a route not on the
   * list". Checking it here rather than adding a catch-all to `PUBLIC_PATHS`
   * keeps that list closed — it is gated-by-omission by design (see its
   * header), and a wildcard would defeat the check on the day a genuinely
   * private route arrives.
   */
  const isPublic = isNotFound || isPublicPath(pathname)

  useEffect(() => {
    if (!isPublic && !isPending && !session) {
      router.replace("/sign-in")
    }
  }, [isPublic, isPending, session, router])

  // Public paths render immediately without waiting on the session.
  if (isPublic) {
    return <>{children}</>
  }

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!session) {
    return null
  }

  return <>{children}</>
}
