import { describe, expect, test } from "bun:test"
import {
  DEFAULT_HERO_VARIANT,
  HERO_VARIANTS,
  heroVariantFromParam,
  isHeroVariant,
} from "./hero-animation"

/**
 * Tests for the hero crest's URL contract.
 *
 * Worth testing on its own because every way this can be wrong looks fine in
 * review and in the typecheck. The parameter arrives as an unvalidated `string |
 * null` from `useSearchParams`, and the three failures are silent: an
 * unrecognised value that renders nothing leaves a hole where the crest should
 * be; a value that falls through to the wrong branch shows the wrong variant to
 * someone who was sent a link to a specific one; and a guard that drifts from
 * `HERO_VARIANTS` accepts a variant the component has no case for. None of the
 * three throws, and the component itself is decoration, so nothing downstream
 * notices.
 *
 * The rendering is deliberately not tested. There is no DOM in `bun test` here —
 * no component in this repo has a render test — and what would be asserted is
 * CSS class names, which is a restatement of the source rather than a check on
 * it. The motion has to be looked at, and the reduced-motion behaviour is a
 * media query the browser resolves.
 */

describe("isHeroVariant", () => {
  test("accepts every declared variant", () => {
    for (const variant of HERO_VARIANTS) {
      expect(isHeroVariant(variant)).toBe(true)
    }
  })

  test("rejects anything else", () => {
    // `""` and `"Eagle"` are the two that would otherwise slip through a
    // truthiness check and a case-insensitive one respectively.
    for (const value of ["", " ", "Eagle", "eagle ", "bundesadler", "coins", "__proto__"]) {
      expect(isHeroVariant(value)).toBe(false)
    }
  })
})

describe("heroVariantFromParam", () => {
  test("returns the requested variant", () => {
    for (const variant of HERO_VARIANTS) {
      expect(heroVariantFromParam(variant)).toBe(variant)
    }
  })

  test("an absent parameter is the default", () => {
    // `useSearchParams().get` returns null for a key that is not in the URL,
    // which is the common case: nobody visiting the home page has one.
    expect(heroVariantFromParam(null)).toBe(DEFAULT_HERO_VARIANT)
  })

  test("an unrecognised or empty value falls back rather than blanking", () => {
    // `?hero=` with no value parses to "", not null — the case a null check
    // alone would miss.
    for (const value of ["", "Eagle", "adler", "flag2"]) {
      expect(heroVariantFromParam(value)).toBe(DEFAULT_HERO_VARIANT)
    }
  })

  test("the default is itself a variant the component can render", () => {
    // Guards against the default being renamed out from under the union — the
    // typecheck already forbids it, but this states the invariant the fallback
    // above relies on rather than leaving it implied.
    expect(HERO_VARIANTS).toContain(DEFAULT_HERO_VARIANT)
  })
})
