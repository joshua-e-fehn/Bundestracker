import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs"

/**
 * Server-side auth helpers, bound to this deployment.
 *
 * The `!` assertions are why `style/noNonNullAssertion` is off in biome.json.
 * These two variables are not optional — without them there is no backend to
 * talk to, and every auth call fails at the first request. Asserting says that
 * out loud; the alternative (`?? ""`) would turn a missing deployment URL into
 * a confusing fetch error at runtime instead of a loud one at startup.
 */
export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
})
