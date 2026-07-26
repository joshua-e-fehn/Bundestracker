import { convexClient } from "@convex-dev/better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

// No baseURL: the auth client calls same-origin /api/auth/* which Next.js
// rewrites to the Convex site URL (see next.config.ts). This avoids CORS
// entirely since the browser sees same-origin requests.
export const authClient = createAuthClient({
  plugins: [convexClient()],
})
