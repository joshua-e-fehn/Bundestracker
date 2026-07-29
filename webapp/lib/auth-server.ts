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

export const {
  handler,
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
