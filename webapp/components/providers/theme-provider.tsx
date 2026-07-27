"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type * as React from "react"

/**
 * Theme state for the tree. Light by default, with system still on offer.
 *
 * ## Why light rather than dark
 *
 * The brand palette (app/globals.css) is designed light-first: the light theme
 * is the one whose contrast ratios were solved against a paper-white
 * background, and the gold ramp runs dim-to-*dark* there because on paper more
 * means darker. It is also the register a civic transparency site should
 * open in — bundesregierung.de, bundestag.de and gov.de are all light, and a
 * dark-by-default page of official parliamentary data reads as a developer
 * tool rather than as a public record. Dark remains a first-class theme, not a
 * fallback; it is simply no longer what a first-time visitor gets.
 *
 * ## Why the two props are not contradictory
 *
 * `enableSystem` supplies the *fallback* for `defaultTheme` when that prop is
 * omitted — in next-themes 0.4.6 the signature is
 * `defaultTheme = enableSystem ? "system" : "light"`, a destructuring default
 * that fires only on `undefined`. Passing `"light"` explicitly therefore wins,
 * in both the blocking pre-paint script and React state, while `enableSystem`
 * keeps `"system"` in the list `useTheme()` returns so the toggle can still
 * offer it. A first-time visitor gets light; a visitor who picks "system"
 * keeps system, because that choice is what localStorage holds from then on.
 *
 * Note this is a *default*, not a lock: a returning reader who chose dark keeps
 * dark, since next-themes reads `localStorage` before it reads this prop.
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
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
