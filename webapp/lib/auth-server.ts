import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs"
import { requireConvexUrls } from "@/lib/convex-url"

/**
 * Server-side auth helpers, bound to this deployment.
 *
 * `requireConvexUrls` replaces the `!` assertions this used to carry. They made
 * the right claim — these two variables are not optional, and a missing one
 * should fail loudly at startup rather than as a confusing fetch error later —
 * but a non-null assertion only rules out `undefined`. The failure this build
 * actually had was a *defined* value naming the wrong deployment, which no `!`
 * can catch and which fails silently rather than loudly. See lib/convex-url.ts.
 *
 * This module is imported during `next build`'s page-data collection, so the
 * check runs at build time: a misconfigured deploy fails before it can serve.
 */
// Named one at a time rather than passing `process.env`: Next inlines
// `NEXT_PUBLIC_*` by matching the literal member expression in the source, so
// spreading the object would leave both values `undefined` in the browser
// bundle — the check would pass at build time and the client would get nothing.
const { cloudUrl, siteUrl } = requireConvexUrls({
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
})

/**
 * The Convex site URL this build proxies auth to, validated above.
 *
 * Exported so `app/api/auth/[...all]/route.ts` can bind its hop to the same
 * checked value rather than reading `process.env` a second time — the check is
 * what makes it trustworthy, and a second read would skip it.
 */
export const convexSiteUrl = siteUrl

// `handler` is deliberately not re-exported. It is the library's own
// `/api/auth/*` forwarder, and it is the thing that caused the production 404:
// it sets `x-forwarded-host` to the public origin, which Convex's edge router
// rejects at ingress. The route handler uses `lib/auth-forwarded-headers.ts`
// instead. Leaving the export in place would leave a one-import path back to
// the outage. The rest of this object is still the library's.
export const {
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl: cloudUrl,
  convexSiteUrl: siteUrl,
})
