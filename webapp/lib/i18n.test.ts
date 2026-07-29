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

/**
 * The privacy claim: what an account stores, said the same way everywhere.
 *
 * ## The bug
 *
 * `settings.signedOutBody` said an account stores "**genau zwei** Dinge" /
 * "**exactly two** things" and listed the weights and the follow list. That was
 * true when it was written and stopped being true on the same branch, which
 * gave `preferredLocale` a writer — so the page contradicted itself: its own
 * subtitle two lines up already named all three, and `/about`'s privacy note had
 * been corrected to three while this one was left behind.
 *
 * "Genau"/"exactly" is what makes it an enumeration rather than a summary, and
 * the item it omitted was the language — the one of the three that can *leave
 * the device*, in the sentence a signed-out reader is using to decide whether to
 * create an account. Found in review as F1.
 *
 * ## Why the test is written against the schema rather than against a wording
 *
 * A test asserting the strings contain "drei"/"three" would pass on the next
 * column too, which is precisely when the sentence becomes wrong again. The
 * defect is not a number in a string; it is a **claim about a table drifting
 * from the table**. So the fixture below is the reader-facing columns of
 * `userPreferences`, each paired with the words that name it in each locale, and
 * the assertion is that every stored value is named on both surfaces.
 *
 * Adding a column to `userPreferences` therefore means adding an entry here,
 * which fails until both privacy claims mention it. That is the property worth
 * holding: `convex/schema.ts` is the only place that knows what is stored, and
 * two pages tell readers about it.
 *
 * The `userId`, `createdAt` and `updatedAt` columns are deliberately not in the
 * fixture: they are bookkeeping the reader neither chooses nor can clear, and a
 * privacy note that enumerated them would be describing the row rather than the
 * choices.
 */
describe("what an account stores is stated consistently", () => {
  /**
   * The reader-facing columns of `userPreferences` (convex/schema.ts), and how
   * each is named in each locale.
   *
   * Patterns rather than fixed substrings, so a rewording that keeps the meaning
   * passes and only a *missing item* fails. German is why: the follow list is
   * "Abgeordneten, denen Sie **folgen**" on one surface and "die Liste der
   * **gefolgten** Abgeordneten" on the other, and a literal `"folgen"` matches
   * the first and not the second. Matching the stem covers both without
   * loosening into "any sentence mentioning members".
   */
  const STORED_VALUES = [
    { column: "customWeights", de: /Gewichtungen/i, en: /weightings/i },
    { column: "followedMpIds", de: /\bge?folgt|folgen\b/i, en: /follow/i },
    { column: "preferredLocale", de: /Sprache/i, en: /language/i },
  ] as const

  /** Both surfaces that tell a reader what an account holds. They are on
   * different pages and were written months apart, which is exactly how they
   * came to disagree. */
  const PRIVACY_CLAIMS = ["settings.signedOutBody", "about.privacy.account.body"] as const

  test("every stored value is named in both languages, on both surfaces", () => {
    for (const key of PRIVACY_CLAIMS) {
      for (const locale of LOCALES) {
        const text = dictionaries[locale][key]
        for (const value of STORED_VALUES) {
          expect({
            key,
            locale,
            column: value.column,
            named: value[locale].test(text),
          }).toEqual({ key, locale, column: value.column, named: true })
        }
      }
    }
  })

  test("neither claim counts fewer things than are stored", () => {
    // The exact wording that shipped, pinned so it cannot come back by way of a
    // rewrite that "simplifies" the sentence. A claim about what leaves the
    // device may summarise, but it may not undercount — and "genau"/"exactly"
    // turns a summary into a count.
    for (const key of PRIVACY_CLAIMS) {
      // Asserted on the string itself rather than on a labelled object: the
      // failure names the key through the message below, and `toMatch` takes a
      // string.
      expect(dictionaries.de[key], `de.${key} undercounts`).not.toMatch(/genau zwei/i)
      expect(dictionaries.en[key], `en.${key} undercounts`).not.toMatch(/exactly two/i)
    }
  })

  test("the settings page does not contradict its own subtitle", () => {
    // The subtitle names all three ("Ihre Gewichtungen, Ihre Sprache und die
    // Abgeordneten, denen Sie folgen"). The body beneath it claimed two. A page
    // that disagrees with itself is worse than either version alone, because a
    // reader cannot tell which sentence to believe.
    for (const locale of LOCALES) {
      const subtitle = dictionaries[locale]["settings.subtitle"]
      const body = dictionaries[locale]["settings.signedOutBody"]
      for (const value of STORED_VALUES) {
        expect({
          locale,
          column: value.column,
          inSubtitle: value[locale].test(subtitle),
          inBody: value[locale].test(body),
        }).toEqual({ locale, column: value.column, inSubtitle: true, inBody: true })
      }
    }
  })
})
