import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { cookies, headers } from "next/headers"
import { AppShell } from "@/components/app-shell"
import { NavSidebar } from "@/components/nav-sidebar"
import { AuthGuard } from "@/components/providers/auth-guard"
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
import { DEFAULT_LOCALE, localeFromAcceptLanguage, t } from "@/lib/i18n"
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

/**
 * Metadata is German — the default locale, and the language of both the
 * audience and the subject. It is static because `generateMetadata` cannot see
 * the client-side language toggle; a reader who switches to English gets
 * English page content and a German tab title.
 *
 * `alternates.languages` still advertises both, because that is a statement
 * about the *page* rather than about the current reader: one URL serves both
 * languages, so both point at the same href. Note the two locale spellings are
 * not interchangeable — Open Graph wants `de_DE` and hreflang wants `de-DE`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: t("app.name", DEFAULT_LOCALE),
    template: `${t("app.name", DEFAULT_LOCALE)} — %s`,
  },
  description: t("app.description", DEFAULT_LOCALE),
  applicationName: t("app.name", DEFAULT_LOCALE),
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
    siteName: t("app.name", DEFAULT_LOCALE),
    title: t("app.name", DEFAULT_LOCALE),
    description: t("app.description", DEFAULT_LOCALE),
    locale: "de_DE",
    alternateLocale: ["en_GB"],
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: t("app.name", DEFAULT_LOCALE),
    description: t("app.description", DEFAULT_LOCALE),
  },
  robots: { index: true, follow: true },
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
  // failure. Negotiating the locale here means the first paint is already in
  // the reader's language rather than flashing German at an English reader.
  const [token, requestHeaders, cookieStore] = await Promise.all([getToken(), headers(), cookies()])
  const locale = localeFromAcceptLanguage(requestHeaders.get("accept-language"))
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
