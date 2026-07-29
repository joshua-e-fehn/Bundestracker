import { describe, expect, test } from "bun:test"
import { CONTACT_ANCHOR, contactChannels, hostOf, isLinkableUrl } from "./contact"

/**
 * Tests for the contact card's reading of the source.
 *
 * The failure this guards is *silence*. Before this branch the card returned
 * `null` whenever `contact` was absent, so a member the Bundestag publishes
 * nothing for — 12 of 635 in WP21, and all 635 for the hours after a sync
 * blanks the enrichment columns — rendered as a profile with no contact section
 * at all. Nothing threw, nothing logged, and the page looked complete. A test
 * that asserts a card is *present* is the only kind that catches that, because
 * a missing card produces no error to assert against.
 *
 * So `any` is the property under test throughout: it is the flag the card
 * branches on, and the two states it selects between are "the source published
 * channels" and "the source published nothing, and here is what that means".
 */

/** A populated block in the shape the schema declares. */
const FULL = {
  formUrl: "https://www.bundestag.de/services/formular/contactform?mdbId=1043330",
  constituencyOffice: "Wahlkreisbüro Arnsberg\nZu den Werkstätten 2\n59759 Arnsberg",
  homepage: "https://www.friedrich-merz.de",
  socials: [
    { platform: "Instagram", url: "https://www.instagram.com/friedrichmerz/" },
    { platform: "X", url: "https://x.com/_FriedrichMerz" },
  ],
} as const

/** A block the source returned empty — a member with a biography page that
 * carries no contact aside at all. Distinct from `null`, and it must render the
 * same way: the reader cannot tell the two apart and should not have to. */
const EMPTY = {
  formUrl: null,
  constituencyOffice: null,
  homepage: null,
  socials: [],
} as const

describe("contactChannels — populated", () => {
  test("carries every channel the source published", () => {
    const channels = contactChannels(FULL)
    expect(channels.any).toBe(true)
    expect(channels.formUrl).toBe(FULL.formUrl)
    expect(channels.homepage).toBe(FULL.homepage)
    expect(channels.constituencyOffice).toBe(FULL.constituencyOffice)
    expect(channels.socials).toEqual([...FULL.socials])
  })

  test("the constituency office keeps its newlines", () => {
    // An MP may list two offices in one string — Sanae Abdi has Köln-Innenstadt
    // and Kalk — so the whitespace is content and collapsing it merges two
    // addresses into one that reaches neither.
    const channels = contactChannels(FULL)
    expect(channels.constituencyOffice?.split("\n")).toHaveLength(3)
  })

  test("a form link alone is enough to be populated", () => {
    // The most common real shape after the wipe-free state: 623 of 635 WP21
    // members had a `formUrl` and 543 a homepage, so a form-only member is an
    // ordinary row rather than an edge case.
    expect(contactChannels({ ...EMPTY, formUrl: FULL.formUrl }).any).toBe(true)
  })

  test("a social profile alone is enough to be populated", () => {
    expect(contactChannels({ ...EMPTY, socials: [...FULL.socials] }).any).toBe(true)
  })

  test("a constituency office alone is enough to be populated", () => {
    expect(contactChannels({ ...EMPTY, constituencyOffice: "Wahlkreisbüro Calw" }).any).toBe(true)
  })

  test("an unrecognised platform survives", () => {
    // `platform` is free text and the list is the Bundestag's — it grows. A
    // network matched against an enum of known ones would disappear the day the
    // Bundestag started printing a new one.
    const channels = contactChannels({
      ...EMPTY,
      socials: [{ platform: "Nebulos", url: "https://nebulos.example/mdb" }],
    })
    expect(channels.socials).toEqual([{ platform: "Nebulos", url: "https://nebulos.example/mdb" }])
  })

  test("a social link with no platform name is labelled by its host", () => {
    // Rather than rendering a link with no text, which is unreachable by
    // keyboard and unreadable by a screen reader.
    const channels = contactChannels({
      ...EMPTY,
      socials: [{ platform: "   ", url: "https://social.bund.de/@eskensaskia" }],
    })
    expect(channels.socials[0].platform).toBe("social.bund.de")
  })
})

describe("contactChannels — absent", () => {
  // All three absences mean the same thing to a reader, so all three must
  // produce the same state. The `undefined` case is not hypothetical: `contact`
  // is `v.optional` in convex/schema.ts, so a row written before the field
  // existed has no key at all — see the note on the enrichment fields in
  // components/mp-profile.tsx.
  test("a missing key is not populated", () => {
    expect(contactChannels(undefined).any).toBe(false)
  })

  test("an explicit null is not populated", () => {
    expect(contactChannels(null).any).toBe(false)
  })

  test("a block with nothing in it is not populated", () => {
    expect(contactChannels(EMPTY).any).toBe(false)
  })

  test("all three absences produce the same channels", () => {
    expect(contactChannels(null)).toEqual(contactChannels(undefined))
    expect(contactChannels(EMPTY)).toEqual(contactChannels(undefined))
  })

  test("whitespace is not a constituency office", () => {
    // A scraped page can yield a block of spaces where an address was expected.
    // Counting it would put the profile in the populated state and then render
    // a labelled blank — the silent half of the bug this module exists for.
    expect(contactChannels({ ...EMPTY, constituencyOffice: "  \n  " }).any).toBe(false)
  })

  test("the Berlin office does not make a member populated", () => {
    // It is printed from the dictionary for every member, so if it counted,
    // `any` would be true for all 635 rows and the empty state would be dead
    // code — which is exactly how the explanation went missing for the members
    // who needed it.
    expect(contactChannels(null).any).toBe(false)
  })
})

describe("contactChannels — links that will not open", () => {
  test("an unparseable URL is dropped rather than linked", () => {
    const channels = contactChannels({ ...EMPTY, homepage: "not a url" })
    expect(channels.homepage).toBeNull()
    // And it does not count towards `any`: a card in the populated state with
    // no drawable channel in it is the silent failure again.
    expect(channels.any).toBe(false)
  })

  test("a non-http scheme is dropped", () => {
    // These URLs come from scraped HTML, so the scheme is whatever the page
    // said. `URL.canParse` accepts `javascript:` quite happily.
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
      expect(isLinkableUrl(url), url).toBe(false)
      expect(contactChannels({ ...EMPTY, homepage: url }).any, url).toBe(false)
    }
  })

  test("a social link that will not open is dropped, and the rest survive", () => {
    const channels = contactChannels({
      ...EMPTY,
      socials: [
        { platform: "Broken", url: "javascript:void 0" },
        { platform: "Mastodon", url: "https://social.bund.de/@eskensaskia" },
      ],
    })
    expect(channels.socials).toEqual([
      { platform: "Mastodon", url: "https://social.bund.de/@eskensaskia" },
    ])
    expect(channels.any).toBe(true)
  })

  test("http and https both open", () => {
    expect(isLinkableUrl("http://example.de")).toBe(true)
    expect(isLinkableUrl("https://example.de")).toBe(true)
  })

  test("nothing is not a link", () => {
    expect(isLinkableUrl(null)).toBe(false)
    expect(isLinkableUrl(undefined)).toBe(false)
    expect(isLinkableUrl("")).toBe(false)
    expect(isLinkableUrl("   ")).toBe(false)
  })

  test("surrounding whitespace does not break a link", () => {
    // Trailing whitespace inside an `href` occurs in the source — the pipeline's
    // parser notes it (api/mp_profiles.py) — so it must not cost a member their
    // homepage.
    const channels = contactChannels({ ...EMPTY, homepage: "  https://example.de  " })
    expect(channels.homepage).toBe("https://example.de")
  })
})

describe("hostOf", () => {
  test("drops the scheme, the path and a leading www", () => {
    expect(hostOf("https://www.friedrich-merz.de/kontakt")).toBe("friedrich-merz.de")
  })

  test("keeps a subdomain that is not www", () => {
    expect(hostOf("https://social.bund.de/@eskensaskia")).toBe("social.bund.de")
  })

  test("returns null rather than a broken label", () => {
    expect(hostOf("not a url")).toBeNull()
  })
})

describe("CONTACT_ANCHOR", () => {
  test("is a bare fragment, with no leading hash", () => {
    // The link writes `#${CONTACT_ANCHOR}` and the card sets `id=`. A value
    // carrying its own `#` would produce `##contact` on one side and an id no
    // selector matches on the other, and neither throws.
    expect(CONTACT_ANCHOR.startsWith("#")).toBe(false)
    expect(CONTACT_ANCHOR).toMatch(/^[a-z][\w-]*$/)
  })
})
