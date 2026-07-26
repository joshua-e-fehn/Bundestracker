"use client"

import { usePathname, useRouter } from "next/navigation"
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

  const isPublic = isPublicPath(pathname)

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
