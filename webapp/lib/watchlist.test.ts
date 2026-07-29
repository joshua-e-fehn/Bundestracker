import { describe, expect, test } from "bun:test"
import { dictionaries, LOCALES } from "./i18n"
import { watchlistGap } from "./watchlist"

/**
 * The note that keeps the watchlist honest about its own length.
 *
 * `getFollowedMPs` resolves stored ids against one Wahlperiode and skips
 * anyone with no mandate row in it, so a reader following twelve members can
 * see ten cards. Ten cards look exactly like ten follows — the gap is
 * invisible unless something says so, which is what this decides.
 *
 * Every case below has a plausible wrong implementation that renders a
 * confident sentence instead of nothing, or nothing instead of a sentence. None
 * of them throws.
 */

describe("watchlistGap", () => {
  test("says nothing when every followed member is shown", () => {
    expect(watchlistGap(3, 3)).toEqual({ kind: "none" })
    expect(watchlistGap(0, 0)).toEqual({ kind: "none" })
  })

  test("names one missing member in the singular", () => {
    expect(watchlistGap(4, 3)).toEqual({
      kind: "one",
      key: "settings.watchlist.notSittingOne",
    })
  })

  test("counts more than one", () => {
    expect(watchlistGap(12, 10)).toEqual({
      kind: "many",
      key: "settings.watchlist.notSitting",
      count: 2,
    })
  })

  test("an in-flight count is not a count of zero", () => {
    // The bug this guards: `followedIds ?? 0` typechecks, and for the length of
    // the preference round-trip the page would claim every card on it is a
    // follow that went missing — on the surface whose whole job is to show what
    // you follow.
    expect(watchlistGap(undefined, 0)).toEqual({ kind: "none" })
    expect(watchlistGap(undefined, 7)).toEqual({ kind: "none" })
  })

  test("more cards than ids reports nothing rather than a negative", () => {
    // Not hypothetical: `findMandate` falls back to `dipPersonId`, so two
    // stored ids can resolve to one mandate row — and the inverse arrangement
    // can leave the resolved list longer than the id list. Subtracting and
    // rendering would print "-1 gefolgte Personen", which reads as a bug
    // because it is one.
    expect(watchlistGap(2, 3)).toEqual({ kind: "none" })
  })

  test("every key it can return exists in both languages", () => {
    // The keys are returned as data rather than written at the call site, so a
    // typo here would render as the key's own name — visible only on the branch
    // that produced it, which is the rare one.
    const keys = [watchlistGap(4, 3), watchlistGap(12, 10)].flatMap((gap) =>
      gap.kind === "none" ? [] : [gap.key],
    )
    expect(keys.length).toBe(2)

    for (const locale of LOCALES) {
      for (const key of keys) {
        expect({ key, locale, ok: (dictionaries[locale][key]?.length ?? 0) > 0 }).toEqual({
          key,
          locale,
          ok: true,
        })
      }
    }
  })

  test("both strings interpolate the period, and the plural one the count", () => {
    // The note names the Wahlperiode it is talking about, because "does not sit
    // in the electoral period" without saying *which* is not a fact a reader
    // can act on. Asserted against the dictionary rather than trusted, since a
    // placeholder dropped in one language renders as a sentence missing a
    // number rather than as an error.
    for (const locale of LOCALES) {
      expect(dictionaries[locale]["settings.watchlist.notSittingOne"]).toContain("{wahlperiode}")
      expect(dictionaries[locale]["settings.watchlist.notSitting"]).toContain("{wahlperiode}")
      expect(dictionaries[locale]["settings.watchlist.notSitting"]).toContain("{count}")
      // And the singular must *not* take a count — it has no number to put
      // there, so a `{count}` would render literally.
      expect(dictionaries[locale]["settings.watchlist.notSittingOne"]).not.toContain("{count}")
    }
  })
})
