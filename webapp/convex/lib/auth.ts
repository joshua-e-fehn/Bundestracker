import type { GenericCtx } from "@convex-dev/better-auth/utils"
import type { DataModel } from "../_generated/dataModel"
import { authComponent } from "../betterAuth/auth"

/**
 * Who a request is allowed to act as.
 *
 * Two callers reach this deployment and authenticate differently: a browser
 * with a Better Auth session, and the Python pipeline with a shared key in an
 * `Authorization: Bearer` header. This file decides the first, convex/http.ts
 * the second, and neither should be re-derived per module.
 *
 * Bundestracker is a public dashboard, so almost nothing needs either: the
 * parliamentary data is public record and every query over it is unauthenticated
 * by design. `userPreferences` is the exception, and the only caller of
 * `requireUserId`.
 */

/**
 * The signed-in user's id, or a thrown error.
 *
 * Returns the id rather than the user document because that is all any caller
 * needs: it is the `userId` written to `userPreferences`. Taking it from the
 * session is the point — a `userId` argument would let any signed-in user read
 * or rewrite anyone else's preferences by supplying their id.
 */
export async function requireUserId(ctx: GenericCtx<DataModel>): Promise<string> {
  const user = await authComponent.safeGetAuthUser(ctx)
  if (!user) {
    throw new Error("Not authenticated")
  }
  return user._id
}

/**
 * The signed-in user's id, or null.
 *
 * For reads that have a signed-out rendering — the preferences query returns
 * defaults to an anonymous visitor rather than an error, because every page is
 * browsable without an account and a thrown error would be a bug in the UI's
 * loading state rather than useful information.
 */
export async function getUserId(ctx: GenericCtx<DataModel>): Promise<string | null> {
  const user = await authComponent.safeGetAuthUser(ctx)
  return user?._id ?? null
}
