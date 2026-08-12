import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { cookies } from "next/headers"
import { AppShell } from "@/components/app-shell"
import { NavSidebar } from "@/components/nav-sidebar"
import { AuthGuard } from "@/components/providers/auth-guard"
import { FeedbackProvider } from "@/components/providers/feedback-provider"
import { LocaleProvider } from "@/components/providers/locale-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { SavedLocaleSync } from "@/components/providers/saved-locale"
import { SidebarProvider } from "@/components/providers/sidebar-provider"
import { ThemeColorSync } from "@/components/providers/theme-color"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getToken } from "@/lib/auth-server"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"
import { SIDEBAR_COOKIE, sidebarExpanded } from "@/lib/sidebar-state"
import { cn } from "@/lib/utils"
import { AuthProvider } from "@/providers/auth-provider"
import "./globals.css"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

/** Where the site is served from, for resolving social-image and canonical URLs.
 * Without it Next falls back to `localhost` in development and to Vercel's env
 * vars in production — fine there, silently wrong anywhere else. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

/** BCP 47 → Open Graph locale. The two spellings are not interchangeable —
 * OG wants underscores (`de_DE`), hreflang wants hyphens (`de-DE`). Kept
 * beside the metadata builder so the pair moves together. */
const OG_LOCALE = { de: "de_DE", en: "en_GB" } as const

/**
 * Metadata is negotiated per request rather than pinned to the default locale.
 *
 * The cookie the language toggle writes (`LOCALE_COOKIE` in lib/i18n.ts) is
 * what `generateMetadata` reads — via `resolveServerLocale` — so a reader who
 * switched to English on their last visit gets an English `<title>` and an
 * English social-share card on the next one, instead of the German tab title
 * they used to see above the English body. On a first visit with no cookie the
 * decision falls to `Accept-Language`; only when both are silent does it fall
 * to German.
 *
 * `alternates.languages` advertises both regardless of the chosen locale,
 * because that is a statement about the *page* rather than about the current
 * reader: one URL serves both, so both point at the same href.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  const appName = t("app.name", locale)
  const description = t("app.description", locale)
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: appName,
      template: `${appName} — %s`,
    },
    description,
    applicationName: appName,
    keywords: [
      "Bundestag",
      "Abgeordnete",
      "Open Data",
      "Parlament",
      "Transparenz",
      "German parliament",
    ],
    authors: [{ name: "Joshua Fehn" }],
    alternates: {
      canonical: "/",
      languages: { "de-DE": "/", "en-GB": "/" },
    },
    openGraph: {
      type: "website",
      siteName: appName,
      title: appName,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: locale === "de" ? [OG_LOCALE.en] : [OG_LOCALE.de],
      url: "/",
    },
    twitter: {
      card: "summary_large_image",
      title: appName,
      description,
    },
    robots: { index: true, follow: true },
  }
}

/**
 * Viewport is its own export, not a `Metadata` field.
 *
 * `themeColor` and `colorScheme` still typecheck inside `Metadata` in Next 16
 * but are deprecated there — the build warns and the tags do not render as
 * expected. `colorScheme: "light dark"` names light first, matching the app's
 * default (components/providers/theme-provider.tsx) and the `color-scheme`
 * declaration in app/globals.css, which is also what native form controls and
 * scrollbars read. All three must name light first or a first-time visitor
 * gets a dark scrollbar beside a light page.
 *
 * ## The two `themeColor` entries are the pre-hydration answer only
 *
 * They are keyed on `prefers-color-scheme` — the *OS* preference — while the
 * theme actually rendered comes from next-themes and localStorage. Those are
 * independent, so on their own they disagreed with the page in two of the four
 * combinations: an OS-dark visitor with no stored theme got dark chrome above a
 * light page, which is the default state for everyone whose machine is dark.
 *
 * `ThemeColorSync` (components/providers/theme-color.tsx) replaces them on
 * mount with a single unqualified tag written from `resolvedTheme`. These stay
 * because they are the best available answer for the first paint, before any
 * JavaScript has run, and they are correct for the two combinations that
 * already agreed.
 *
 * The two colours are the sRGB renderings of `--background` in each theme —
 * `oklch(0.985 0.002 95)` and `oklch(0.155 0.004 95)`. They are literals
 * because a `<meta>` tag cannot hold a `var()`, which makes them the one place
 * in the app where the palette is duplicated — now in three files, since
 * `ThemeColorSync` needs the same pair. Changing either background in
 * globals.css means changing it in both, or the phone's status bar will be a
 * different colour from the page under it.
 */
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0a" },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // All three are per-request, so this stays a server component and awaits
  // them. `getToken` returns null for the signed-out majority — expected, not a
  // failure. `resolveServerLocale` consults the locale cookie first and falls
  // back to `Accept-Language`, so a reader who pressed the toggle on a previous
  // visit gets their language on this one's first paint — see lib/i18n-server.ts.
  const [token, locale, cookieStore] = await Promise.all([
    getToken(),
    resolveServerLocale(),
    cookies(),
  ])
  // Read on the server so the shell's first paint is already the width the
  // reader chose. Doing this on the client instead would render the expanded
  // 16 rem shell, paint it, and snap to the 3.5 rem rail on hydration — with
  // every page's content column jumping 200 px as it did. See
  // lib/sidebar-state.ts for why this is a cookie and not localStorage.
  const expanded = sidebarExpanded(cookieStore.get(SIDEBAR_COOKIE)?.value)

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn("antialiased", fontSans.variable, fontMono.variable)}
    >
      {/* `flex min-h-svh flex-col` with the footer's `mt-auto` is what keeps
          the footer at the bottom of a short page without pinning it over a
          long one. */}
      <body className="flex min-h-svh flex-col font-sans">
        <AuthProvider initialToken={token}>
          <QueryProvider>
            <ThemeProvider>
              {/* Inside ThemeProvider — it reads `resolvedTheme` — and above
                  everything else, since it renders nothing and only writes a
                  tag into <head>. See components/providers/theme-color.tsx for
                  why the media-query entries in `viewport` cannot do this. */}
              <ThemeColorSync />
              <LocaleProvider initialLocale={locale}>
                {/* Applies a language saved on the reader's account, for a
                    signed-in reader who has not chosen one in this browser.
                    Renders nothing; inside `LocaleProvider` because it calls
                    into it, and inside `AuthProvider` because it subscribes to
                    Convex. See components/providers/saved-locale.tsx for why it
                    is not folded into the provider itself. */}
                <SavedLocaleSync />
                {/* Radix requires a `Tooltip` to have a provider above it, and
                    throws at *render* if it does not — which the typecheck
                    cannot see, so the page that forgot one blanks to the error
                    boundary. Both the seating map and the profile heatmap did.

                    Once, here, rather than per component: the alternative is
                    every consumer wrapping its own, which is both the bug
                    itself and a nest of providers whose `delayDuration` would
                    drift apart. */}
                <TooltipProvider>
                  {/* The app shell. `SidebarProvider` holds one boolean and
                      wraps everything because all three of its consumers are
                      here: the sidebar itself, the padded content column, and
                      the header's mobile drawer trigger.

                      Header, sidebar and footer sit inside LocaleProvider —
                      they are translated — but outside AuthGuard, so the chrome
                      stays on screen if a future private route redirects. */}
                  {/* Above the shell because all three of its consumers are
                      inside it and none is an ancestor of the others: the
                      sidebar's row, the mobile drawer's row, and the sheet
                      itself, which the footer mounts. One report sheet, three
                      controls that open it — see
                      components/providers/feedback-provider.tsx. */}
                  <FeedbackProvider>
                    <SidebarProvider defaultExpanded={expanded}>
                      {/* Full-width, above the sidebar rather than beside it —
                        see the note in components/app-shell.tsx. */}
                      <SiteHeader />

                      {/* The sidebar is a sibling of the column it makes room
                        for, not a child of it: it is `fixed` to the viewport's
                        left edge, and nesting it inside the element whose
                        padding exists to avoid it would be circular. */}
                      <NavSidebar />

                      <AppShell>
                        <AuthGuard>{children}</AuthGuard>
                        <SiteFooter />
                      </AppShell>
                    </SidebarProvider>
                  </FeedbackProvider>
                  <Toaster />
                </TooltipProvider>
              </LocaleProvider>
            </ThemeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
