import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { DEFAULT_LOCALE, LOCALE_COOKIE } from "./i18n"

/**
 * `resolveServerLocale`'s three-source precedence, exercised through the same
 * `next/headers` boundary the pages call it through.
 *
 * The mock has to sit above the `import` because `bun:test`'s `mock.module`
 * replaces the module in the loader, and the helper's own `import { cookies,
 * headers } from "next/headers"` at the top of lib/i18n-server.ts is the only
 * consumer that matters. `beforeEach` sets a fresh headers/cookies pair; each
 * test overrides the values it cares about.
 */

let cookieValue: string | undefined
let acceptLanguageHeader: string | null

mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === LOCALE_COOKIE && cookieValue !== undefined ? { value: cookieValue } : undefined),
  }),
  headers: async () => ({
    get: (name: string) => (name.toLowerCase() === "accept-language" ? acceptLanguageHeader : null),
  }),
}))

// The import happens after the mock is registered, so the module resolves
// against the fake `next/headers` above rather than the real one.
const { resolveServerLocale } = await import("./i18n-server")

beforeEach(() => {
  cookieValue = undefined
  acceptLanguageHeader = null
})

afterEach(() => {
  cookieValue = undefined
  acceptLanguageHeader = null
})

describe("resolveServerLocale", () => {
  test("the cookie wins over the header", async () => {
    // The whole reason the cookie exists: the reader pressed the toggle on
    // their last visit. `Accept-Language` is what the browser was configured
    // to send, which is not the same claim.
    cookieValue = "en"
    acceptLanguageHeader = "de,fr;q=0.5"
    expect(await resolveServerLocale()).toBe("en")

    cookieValue = "de"
    acceptLanguageHeader = "en-GB,en;q=0.9"
    expect(await resolveServerLocale()).toBe("de")
  })

  test("Accept-Language decides when the cookie is absent (first visit)", async () => {
    acceptLanguageHeader = "en-US,en;q=0.9,de;q=0.4"
    expect(await resolveServerLocale()).toBe("en")

    acceptLanguageHeader = "de-DE,de;q=0.9,en;q=0.6"
    expect(await resolveServerLocale()).toBe("de")
  })

  test("an unrecognised cookie value falls through to the header", async () => {
    // Defence in depth: a malformed cookie (rotated key, dev leftover, hand
    // edit) must not pin the reader to the fallback silently. `isLocale`
    // filters out garbage and the header decides.
    cookieValue = "fr"
    acceptLanguageHeader = "en-GB,en;q=0.9"
    expect(await resolveServerLocale()).toBe("en")

    cookieValue = ""
    acceptLanguageHeader = "en-GB,en;q=0.9"
    expect(await resolveServerLocale()).toBe("en")
  })

  test("falls back to German when both are silent", async () => {
    // First visit, no header (a bare curl, an old proxy stripping it, a CDN
    // normalising to one tag). The fallback is `DEFAULT_LOCALE` — the note in
    // lib/i18n.ts is emphatic about *why*: the audience is German and the
    // subject is the Bundestag; an unknown-source reader gets German, not
    // English.
    expect(await resolveServerLocale()).toBe(DEFAULT_LOCALE)
    expect(await resolveServerLocale()).toBe("de")
  })

  test("an English cookie survives an unrelated `Accept-Language: fr`", async () => {
    // The failure mode this pins: a stored English preference silently
    // downgraded to German because the browser's own header names French,
    // which does not translate. The cookie is the reader's explicit choice
    // and the header is a hint; the cookie wins even when the hint is silent.
    cookieValue = "en"
    acceptLanguageHeader = "fr-FR,fr;q=0.9"
    expect(await resolveServerLocale()).toBe("en")
  })
})
