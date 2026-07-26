import type { NextConfig } from "next"

const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL

const nextConfig: NextConfig = {
  async rewrites() {
    if (!convexSiteUrl) return []
    return [
      {
        // Proxy Better Auth API calls to the Convex site URL.
        // The auth backend runs inside Convex, so /api/auth/* on the
        // Vercel domain needs to be forwarded there. This avoids CORS
        // entirely — the browser sees same-origin requests.
        source: "/api/auth/:path*",
        destination: `${convexSiteUrl}/api/auth/:path*`,
      },
    ]
  },
}

export default nextConfig
