"use client"

import { useTheme } from "next-themes"
import { useEffect } from "react"

/**
 * Keeps `<meta name="theme-color">` agreeing with the theme on screen.
 *
 * ## Two independent inputs, and nothing reconciled them
 *
 * `app/layout.tsx` declares two `theme-color` entries keyed on
 * `prefers-color-scheme`, which is the OS preference. The theme actually
 * rendered comes from next-themes — `defaultTheme="light"` plus whatever
 * localStorage holds. Those are different questions, so browser chrome and page
 * disagreed in **both** directions:
 *
 * | OS preference | stored theme | chrome    | page      |          |
 * |---------------|--------------|-----------|-----------|----------|
 * | dark          | none         | `#0d0c0a` | `#fafaf9` | mismatch |
 * | light         | dark         | `#fafaf9` | `#0d0c0a` | mismatch |
 *
 * The first row is the default state of every visitor whose OS is dark — the
 * app opens light for them by design (components/providers/theme-provider.tsx),
 * while the status bar went dark.
 *
 * ## Why a media query cannot be made to work
 *
 * The media-query form has no way to express "whatever next-themes resolved",
 * so the tag has to be *written* from the resolved theme. That is what this
 * does: one `<meta>` with no `media` attribute, updated whenever
 * `resolvedTheme` changes — which covers a reader picking a theme from the menu
 * and a reader on "system" whose OS flips, since next-themes re-resolves for
 * both.
 *
 * The static entries stay in `viewport` for the pre-hydration paint: they are
 * the best available answer before JavaScript runs, and correct for the two
 * rows of the table above that already agreed. This overwrites them on mount
 * rather than adding a third opinion — `media`-less entries win over
 * `media`-qualified ones only by being the *last* applicable match, so the
 * static tags are switched off rather than relied on to lose. Switched off by
 * rewriting their `media` attribute, *not* by removing them: see the ⚠ in the
 * effect below for the crash that taught us the difference.
 *
 * Renders nothing. It is a provider-shaped effect rather than a hook called from
 * the layout because the layout is a server component and this needs
 * `useTheme`.
 */

/**
 * The two backgrounds, as sRGB.
 *
 * ⚠ Duplicated from `app/globals.css`, where they are
 * `oklch(0.985 0.002 95)` and `oklch(0.155 0.004 95)`, and from the `viewport`
 * export in app/layout.tsx. A `<meta>` tag cannot hold a `var()`, so this is
 * unavoidable — changing either background means changing it in all three
 * places or the phone's status bar will be a different colour from the page
 * under it. app/layout.tsx carries the same warning.
 */
const THEME_COLORS = { light: "#fafaf9", dark: "#0d0c0a" } as const

/** A media query that is valid and matches nothing, used to switch off the
 * static tags without detaching them from the DOM React owns. */
const NEVER_MATCHES = "not all"

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    // Undefined until next-themes has read localStorage. Doing nothing leaves
    // the static media-query tags in place, which is the right pre-hydration
    // answer rather than a guess that would flash.
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return

    // The static pair from `viewport` has to stop applying, because a browser
    // picks the last tag whose `media` matches — an unqualified tag placed
    // before them would be overridden on exactly the machines this exists to
    // fix.
    //
    // ⚠ **They are neutralised, not removed.** `stale.remove()` was the first
    // implementation and it crashed the app on every client-side navigation:
    // those two tags are rendered by React (the `viewport` export in
    // app/layout.tsx), so React holds references to them and expects to own
    // their lifetime. Deleting them from under it means the next unmount of the
    // head calls `removeChild` on a parent that is already `null` —
    // "Cannot read properties of null (reading 'removeChild')", thrown on every
    // route change, which tears down the React tree and leaves any open overlay
    // stuck on screen over the new page. It was reproduced on a plain footer
    // link with no overlay involved at all, so the symptom was not obviously
    // about navigation chrome.
    //
    // Rewriting `media` to a query that can never match leaves the elements
    // where React put them while making the browser ignore them, which is the
    // whole of what this needs. `not all` is the standard "matches nothing"
    // query.
    for (const stale of document.querySelectorAll('meta[name="theme-color"][media]')) {
      if (stale.getAttribute("media") !== NEVER_MATCHES) stale.setAttribute("media", NEVER_MATCHES)
    }

    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    if (!meta) {
      meta = document.createElement("meta")
      meta.name = "theme-color"
      document.head.appendChild(meta)
    }
    meta.content = THEME_COLORS[resolvedTheme]
  }, [resolvedTheme])

  return null
}
