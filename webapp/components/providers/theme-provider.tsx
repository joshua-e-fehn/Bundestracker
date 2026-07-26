"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type * as React from "react"

/**
 * Theme state for the tree. Dark by default, with system still on offer.
 *
 * The two props look contradictory and are not. `enableSystem` supplies the
 * *fallback* for `defaultTheme` when that prop is omitted — in next-themes 0.4.6
 * the signature is `defaultTheme = enableSystem ? "system" : "light"`, a
 * destructuring default that fires only on `undefined`. Passing `"dark"`
 * explicitly therefore wins, in both the blocking pre-paint script and React
 * state, while `enableSystem` keeps `"system"` in the list `useTheme()` returns
 * so the toggle can still offer it. A first-time visitor gets dark; a visitor
 * who picks "system" keeps system, because that choice is what localStorage
 * holds from then on.
 *
 * `attribute="class"` is load-bearing rather than stylistic: the runtime default
 * is `data-theme`, and Tailwind's `@custom-variant dark (&:is(.dark *))` in
 * app/globals.css matches a *class*. Dropping it renders the site light-only
 * with no error anywhere.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
