import { v } from "convex/values"
import { query } from "./_generated/server"
import { authComponent } from "./betterAuth/auth"

/**
 * The signed-in user's profile, or null when there is no session.
 *
 * Null is an ordinary answer here, not an error: Bundestrack is browsable
 * signed out, so every consumer of this query has a signed-out rendering.
 * Returns the Better Auth user document (name, email, image) rather than the
 * raw identity token — the profile UI needs the stored fields.
 */
export const getCurrentUser = query({
  args: {},
  // `id` is v.string(), not v.id("user"): the user table lives in the Better Auth
  // component's schema, not this deployment's, so there is no local table to name.
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
      image: v.union(v.null(), v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return null
    return {
      id: user._id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      createdAt: user.createdAt,
    }
  },
})
