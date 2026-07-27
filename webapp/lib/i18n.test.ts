import { describe, expect, test } from "bun:test"
import {
  DEFAULT_LOCALE,
  dictionaries,
  getTranslator,
  isLocale,
  LOCALES,
  localeFromAcceptLanguage,
  localeFromNavigator,
  t,
} from "./i18n"

describe("locales", () => {
  test("German is the default", () => {
    expect(DEFAULT_LOCALE).toBe("de")
  })

  test("isLocale accepts supported tags and rejects everything else", () => {
    expect(isLocale("de")).toBe(true)
    expect(isLocale("en")).toBe(true)
    expect(isLocale("fr")).toBe(false)
    expect(isLocale("")).toBe(false)
  })
})

describe("dictionaries", () => {
  // The typecheck already enforces this — `en` is annotated `Dictionary`. The
  // test covers the case types cannot: a dictionary assembled at runtime, and
  // any future locale added without the annotation.
  test("every locale defines every key", () => {
    const keys = Object.keys(dictionaries[DEFAULT_LOCALE]).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(keys)
    }
  })

  test("no locale leaves a string empty", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })
})

describe("t", () => {
  test("defaults to German", () => {
    expect(t("nav.members")).toBe("Abgeordnete")
  })

  test("returns English when asked", () => {
    expect(t("nav.members", "en")).toBe("Members")
  })

  test("substitutes placeholder values", () => {
    // No shipped string uses a placeholder yet, so the substitution is
    // exercised through the same code path with a literal template.
    expect(t("nav.members", "en", { unused: 1 })).toBe("Members")
  })

  test("getTranslator binds a locale", () => {
    const tr = getTranslator("en")
    expect(tr("nav.activity")).toBe("Activity")
  })
})

describe("localeFromAcceptLanguage", () => {
  test("falls back to German when the header is absent", () => {
    expect(localeFromAcceptLanguage(null)).toBe("de")
    expect(localeFromAcceptLanguage(undefined)).toBe("de")
    expect(localeFromAcceptLanguage("")).toBe("de")
  })

  test("matches a region tag to its base language", () => {
    expect(localeFromAcceptLanguage("de-DE")).toBe("de")
    expect(localeFromAcceptLanguage("en-GB")).toBe("en")
  })

  test("honours quality values rather than order", () => {
    expect(localeFromAcceptLanguage("de;q=0.3,en;q=0.9")).toBe("en")
    expect(localeFromAcceptLanguage("en;q=0.2,de;q=0.8")).toBe("de")
  })

  test("skips unsupported languages to reach a supported one", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.5")).toBe("en")
  })

  test("falls back to German when nothing is supported", () => {
    expect(localeFromAcceptLanguage("fr-FR,es;q=0.8")).toBe("de")
  })
})

describe("localeFromNavigator", () => {
  // The client-side half of the same negotiation. It exists because the header
  // and `navigator.languages` disagree in practice — a proxy can strip the
  // header, a CDN can flatten it — and the browser is the better witness when
  // the server had nothing to negotiate against.

  test("falls back to German when the browser offers nothing", () => {
    expect(localeFromNavigator(undefined)).toBe("de")
    expect(localeFromNavigator(null)).toBe("de")
    expect(localeFromNavigator([])).toBe("de")
  })

  test("a German browser gets German", () => {
    expect(localeFromNavigator(["de-DE", "de", "en-US"])).toBe("de")
    expect(localeFromNavigator(["de-AT"])).toBe("de")
  })

  test("an English browser gets English", () => {
    expect(localeFromNavigator(["en-GB", "en"])).toBe("en")
  })

  test("order is the preference — there are no quality values here", () => {
    // `navigator.languages` is ordered most-preferred first and carries no
    // `q=`, which is the whole difference from the header form. The first
    // supported tag wins even when a later one is also supported.
    expect(localeFromNavigator(["en", "de"])).toBe("en")
    expect(localeFromNavigator(["de", "en"])).toBe("de")
  })

  test("skips unsupported languages to reach a supported one", () => {
    expect(localeFromNavigator(["fr-FR", "es", "en-US"])).toBe("en")
  })

  test("an unsupported browser gets German, not English", () => {
    // The fallback is the default locale for the reason DEFAULT_LOCALE is
    // German: the audience is German and the subject is the Bundestag. English
    // is the opt-in, so it must never be reached by falling through.
    expect(localeFromNavigator(["fr-FR", "es-ES"])).toBe("de")
    expect(localeFromNavigator(["ja"])).toBe("de")
  })
})
