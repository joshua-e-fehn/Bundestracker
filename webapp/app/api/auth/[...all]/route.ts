import { convexAuthRouteHandlers } from "@/lib/auth-forwarded-headers"
import { convexSiteUrl } from "@/lib/auth-server"

/**
 * `/api/auth/*` on this origin, proxied to Better Auth inside Convex.
 *
 * This filesystem route is what serves these paths — but only because
 * `next.config.ts` no longer rewrites them. Measured on Next 16.2.12, an
 * `afterFiles` rewrite matching a path that also has a filesystem route *wins*,
 * and this handler is never invoked. That is what the production outage was:
 * the rewrite ran, and Next's proxy sets an `x-forwarded-host` that Convex's
 * edge router rejects. See the ⚠ in next.config.ts before adding one back.
 *
 * The hop is `lib/auth-forwarded-headers.ts` rather than the library's own
 * `handler`, because the library sends an `x-forwarded-host` naming the public
 * origin and Convex's edge router reads that as a deployment it does not host —
 * rejecting every auth request at ingress with a bare 404. That file has the
 * measurements and says why this is a reimplementation rather than a wrapper.
 */
export const { GET, POST } = convexAuthRouteHandlers(convexSiteUrl)
