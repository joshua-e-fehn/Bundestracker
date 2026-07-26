import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

/**
 * Next.js middleware (named `proxy` since Next 16). Pass-through by design.
 *
 * Bundestrack is a public data dashboard — every path is browsable signed out,
 * so there is nothing here to gate. This is policy, not an omission: see
 * `lib/auth-routes.ts` for the route list, and add the check here if a
 * genuinely private route ever arrives.
 *
 * Even then this layer could not do the redirect alone. With cross-domain auth
 * (Convex backend, Vercel frontend), the session cookie lives on the Convex
 * site URL and is not readable from here. `components/providers/auth-guard.tsx`
 * performs the actual session check; middleware exists to let the request
 * through so the page can render and the guard can evaluate.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public files with extensions (.svg, .png, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
