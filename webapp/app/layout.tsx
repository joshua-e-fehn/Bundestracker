import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { headers } from "next/headers"
import { AuthGuard } from "@/components/providers/auth-guard"
import { LocaleProvider } from "@/components/providers/locale-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
<<<<<<< HEAD
import { SiteNav } from "@/components/site-nav"
=======
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { Toaster } from "@/components/ui/sonner"
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
import { getToken } from "@/lib/auth-server"
import { DEFAULT_LOCALE, localeFromAcceptLanguage, t } from "@/lib/i18n"
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
 * expected. Two `themeColor` entries so the browser chrome follows the active
 * theme; `colorScheme: "dark light"` names dark first, matching the app's
 * default, which is also what native form controls and scrollbars read.
 */
export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0e14" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Both are per-request, so this stays a server component and awaits them.
  // `getToken` returns null for the signed-out majority — expected, not a
  // failure. Negotiating the locale here means the first paint is already in
  // the reader's language rather than flashing German at an English reader.
  const [token, requestHeaders] = await Promise.all([getToken(), headers()])
  const locale = localeFromAcceptLanguage(requestHeaders.get("accept-language"))

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
              <LocaleProvider initialLocale={locale}>
<<<<<<< HEAD
                {/* Placeholder nav — see components/site-nav.tsx. The real one
                    belongs to the layout branch, which replaces this line. */}
                <SiteNav />
=======
                {/* Header and footer sit inside LocaleProvider — they are
                    translated — but outside AuthGuard, so the chrome stays on
                    screen if a future private route redirects. */}
                <SiteHeader />
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
                <AuthGuard>{children}</AuthGuard>
                <SiteFooter />
                <Toaster />
              </LocaleProvider>
            </ThemeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
