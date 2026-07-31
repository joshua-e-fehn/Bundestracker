import { describe, expect, test } from "bun:test"
import {
  ABGEORDNETENWATCH_URL,
  BUNDESTAG_MPS_URL,
  BUNDESTAG_OPEN_DATA_URL,
  BUNDESTAG_SWITCHBOARD,
  BUNDESTAG_SWITCHBOARD_TEL,
  DIP_URL,
  REPO_URL,
} from "./links"

/**
 * The outbound addresses, and one number.
 *
 * ## Why a phone number needs a test at all
 *
 * `BUNDESTAG_SWITCHBOARD` and `BUNDESTAG_SWITCHBOARD_TEL` are the same fact in
 * two notations — what a reader sees, and what a tap dials. They shipped
 * disagreeing: the URI was `tel:+493022770`, one `7` too many, which is local
 * `22770` and reads as extension `227-70` rather than the switchboard on `-0`.
 *
 * The reason nothing caught it is the interesting part, and it is what these
 * tests are shaped against. Every existing assertion pinned the URI **to the
 * constant** — `expect(hrefs).toEqual([BUNDESTAG_SWITCHBOARD_TEL])` — so the
 * pair was self-consistent and jointly wrong. A test that compares a value to
 * itself passes for any value.
 *
 * So the rule here **derives** the expected digits from the printed string and
 * never mentions either literal. It would have failed on the shipped typo, it
 * fails on a typo in either constant, and it keeps failing if someone "fixes"
 * one of them to match the other's mistake.
 */

/**
 * The digits a German printed number is actually dialled as, internationally.
 *
 * The trunk code is the whole subtlety. `+49 (0)30 227-0` writes Berlin's `030`
 * with its leading zero **in parentheses** precisely because that zero is a
 * domestic prefix: you dial it from inside Germany and you drop it when you
 * dial `+49`. Stripping all non-digits naively would keep it and produce
 * `+490302270`, which is not a number.
 *
 * Everything else — spaces, the hyphen before the extension — is grouping for
 * the eye and carries no dialling meaning. The `-0` is not punctuation: it is
 * the extension that means "switchboard", and it must survive.
 */
function dialableDigits(printed: string): string {
  const parenthesisedTrunk = /\((\d)\)/
  // `(0)` is the trunk code, spelled as optional by the source itself. Remove
  // the whole group, not just the parentheses.
  const withoutTrunk = printed.replace(parenthesisedTrunk, "")
  return withoutTrunk.replace(/\D/g, "")
}

describe("dialableDigits — the rule the switchboard check rests on", () => {
  // Pinned first, because a broken helper would make the assertions below pass
  // for the wrong reason. These are the Bundestag's own three published numbers
  // (bundestag.de/services/impressum, verified 2026-07-31) plus a second
  // federal imprint, so the convention is checked against more than one source.
  test("drops the parenthesised trunk code and every separator", () => {
    expect(dialableDigits("+49 (0)30 227-0")).toBe("49302270")
    expect(dialableDigits("+49 (0)30 227-35257")).toBe("493022735257")
    expect(dialableDigits("+49 (0)30 227-36878")).toBe("493022736878")
    // Bundeszentrale für politische Bildung — a different stem, same rule. Note
    // the trailing `-0` survives here too: `99515-0` is the switchboard of that
    // stem, so the digits end `…995150` rather than `…99515`.
    expect(dialableDigits("+49 (0)228 99515-0")).toBe("49228995150")
  })

  test("the stem is a number, not a prefix — the extension concatenates", () => {
    // `227-0` and `227-35257` share the stem `227`; the digits after the hyphen
    // are appended rather than replacing anything. This is the property that
    // makes the switchboard `…2270` and not `…227`.
    const switchboard = dialableDigits("+49 (0)30 227-0")
    const petitions = dialableDigits("+49 (0)30 227-35257")
    expect(switchboard.startsWith("4930227")).toBe(true)
    expect(petitions.startsWith("4930227")).toBe(true)
    expect(switchboard).toHaveLength("4930227".length + 1)
  })

  test("a number with no trunk in parentheses is left alone", () => {
    expect(dialableDigits("+493022770")).toBe("493022770")
  })
})

describe("the switchboard", () => {
  test("the tel: URI dials exactly the number the card prints", () => {
    // ⚠ The regression. Derived from `BUNDESTAG_SWITCHBOARD`, never compared
    // against `BUNDESTAG_SWITCHBOARD_TEL`'s own digits — that is the check that
    // was missing and the reason a wrong URI shipped.
    expect(BUNDESTAG_SWITCHBOARD_TEL).toBe(`tel:+${dialableDigits(BUNDESTAG_SWITCHBOARD)}`)
  })

  test("it is the switchboard, not an extension", () => {
    // Two independent statements of the same fact, so that "fixing" the printed
    // string to match a wrong URI fails here too. `-0` is what distinguishes the
    // switchboard from a direct dial, and losing it is the specific way this
    // number goes wrong: `227-70` looks plausible and reaches someone else.
    expect(BUNDESTAG_SWITCHBOARD).toMatch(/-0$/)
    expect(BUNDESTAG_SWITCHBOARD_TEL).toBe("tel:+49302270")
  })

  test("the printed form keeps the trunk zero a German reader dials", () => {
    // `(0)` is not noise: without it the printed string is wrong for anyone
    // dialling domestically, which is most readers of a German parliament site.
    expect(BUNDESTAG_SWITCHBOARD).toContain("(0)")
    expect(BUNDESTAG_SWITCHBOARD.startsWith("+49")).toBe(true)
  })

  test("the URI is a bare tel: with no formatting a dialler must strip", () => {
    // RFC 3966: a global number is `+` then digits. Spaces and hyphens are
    // tolerated by most diallers and by none reliably.
    expect(BUNDESTAG_SWITCHBOARD_TEL).toMatch(/^tel:\+\d+$/)
  })
})

describe("the outbound front doors", () => {
  // These are pages a reader opens, so the property worth holding is that they
  // are absolute https URLs — a relative or scheme-less one renders as a link
  // to nowhere. See the module header for what deliberately is *not* here.
  const PAGES = {
    BUNDESTAG_OPEN_DATA_URL,
    DIP_URL,
    BUNDESTAG_MPS_URL,
    ABGEORDNETENWATCH_URL,
    REPO_URL,
  }

  for (const [name, url] of Object.entries(PAGES)) {
    test(`${name} is an absolute https URL`, () => {
      expect(URL.canParse(url)).toBe(true)
      expect(new URL(url).protocol).toBe("https:")
    })
  }

  test("no page constant carries a trailing slash", () => {
    // They are concatenated nowhere, but they are compared in
    // `mp-contact.test.ts` by exact string, so a stray slash is a silent
    // mismatch rather than a broken link.
    for (const [name, url] of Object.entries(PAGES)) {
      expect(url.endsWith("/"), name).toBe(false)
    }
  })
})
