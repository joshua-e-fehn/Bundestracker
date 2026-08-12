import { convexClient } from "@convex-dev/better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

// No baseURL: the auth client calls same-origin /api/auth/*, which the route
// handler at app/api/auth/[...all]/route.ts forwards to the Convex site URL.
// This avoids CORS entirely since the browser sees same-origin requests.
//
// It used to say "which Next.js rewrites" — that rewrite is gone, and it is
// what caused the production 404. See next.config.ts.
export const authClient = createAuthClient({
  plugins: [convexClient()],
})
