import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { headers } from "next/headers"
import { AuthGuard } from "@/components/providers/auth-guard"
import { LocaleProvider } from "@/components/providers/locale-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { SiteNav } from "@/components/site-nav"
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

/**
 * Metadata is German — the default locale, and the language of both the
 * audience and the subject. It is static because `generateMetadata` cannot see
 * the client-side language toggle; a reader who switches to English gets
 * English page content and a German tab title.
 */
export const metadata: Metadata = {
  title: {
    default: t("app.name", DEFAULT_LOCALE),
    template: `${t("app.name", DEFAULT_LOCALE)} — %s`,
  },
  description: t("app.description", DEFAULT_LOCALE),
  applicationName: t("app.name", DEFAULT_LOCALE),
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
      <body className="font-sans">
        <AuthProvider initialToken={token}>
          <QueryProvider>
            <ThemeProvider>
              <LocaleProvider initialLocale={locale}>
                {/* Placeholder nav — see components/site-nav.tsx. The real one
                    belongs to the layout branch, which replaces this line. */}
                <SiteNav />
                <AuthGuard>{children}</AuthGuard>
              </LocaleProvider>
            </ThemeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
