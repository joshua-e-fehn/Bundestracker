"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

/**
 * TanStack Query, for data that does not come from Convex.
 *
 * Convex has its own subscription-based cache — anything read with `useQuery`
 * from `convex/react` does not belong here. This covers the rest: chart
 * aggregations fetched from route handlers, and any Bundestag API call made
 * straight from the browser.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
          },
        },
      }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
