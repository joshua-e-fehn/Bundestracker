import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CONTACT_ANCHOR } from "../lib/contact"
import { dictionaries, LOCALES } from "../lib/i18n"

/**
 * Guards on the contact surface's *placement* and its *unconditionality*.
 *
 * ## Why against the source text
 *
 * Same reason as components/nav-desktop.test.ts and
 * components/providers/theme-color.test.ts, which this follows: what is being
 * asserted is a rendered relationship — where a card sits in a column, and
 * whether it draws at all — and `bun test` has no DOM. The real verification is
 * the browser measurement in /tmp/contact-profile-visibility-report.md, which
 * reads the heading's offset out of a live layout at both viewports.
 *
 * What this buys is that the two edits which would silently undo that fix fail
 * here rather than in a reader's browser, because neither produces an error:
 *
 *  - Moving `<Contact/>` back below `<Biography/>` puts the heading ~1 450 px
 *    down the page again (GAP-002). The page still renders perfectly.
 *  - Reinstating an early `return null` for a member with no contact block
 *    restores the silence of GAP-003 — a profile with no contact section, which
 *    a reader reads as "this site has no contact details" rather than as "the
 *    Bundestag publishes none".
 *
 * Both are the kind of change that looks like tidying. The second one *was*
 * tidying: the original card returned null because the Berlin address alone
 * "would be four words of chrome pretending to be a record", which is a fair
 * reading of that address on its own and the wrong answer for the page.
 */

const source = readFileSync(new URL("./mp-profile.tsx", import.meta.url).pathname, "utf8")

/** The file with block and line comments stripped, so a rule *named* in the
 * prose above is not mistaken for the code implementing it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the contact card sits near the top of the profile", () => {
  test("Contact is rendered before Biography in the sidebar", () => {
    const contact = code.indexOf("<Contact ")
    const biography = code.indexOf("<Biography ")
    expect(contact).toBeGreaterThan(-1)
    expect(biography).toBeGreaterThan(-1)
    expect(contact).toBeLessThan(biography)
  })

  test("Contact is rendered before the committee panel", () => {
    // Committees were second in the original order's spirit — context about the
    // person. Contact must precede both context panels, not just one.
    expect(code.indexOf("<Contact ")).toBeLessThan(code.indexOf("<MPCommittees "))
  })

  test("the header carries a jump link to it", () => {
    // The measured half of GAP-002 was the offset; the other half was that
    // "nothing in the page header hints it exists".
    expect(code).toContain("<ContactJumpLink />")
    expect(code).toContain(`href={\`#\${CONTACT_ANCHOR}\`}`)
  })

  test("the card carries the id the jump link points at", () => {
    expect(code).toContain("id={CONTACT_ANCHOR}")
  })

  test("the card offsets itself from the sticky header", () => {
    // Without `scroll-mt` the jump lands with the heading underneath the bar —
    // the reader arrives at a card whose title they cannot see, which reads as
    // the link having gone to the wrong place.
    expect(code).toMatch(/id=\{CONTACT_ANCHOR\}[^>]*scroll-mt-/)
  })
})

/**
 * The jump link's accessible name.
 *
 * Raised as a low a11y finding in the review of PR #49: the label was the bare
 * word "Kontakt", which is `mp.contact` verbatim — the heading of the card it
 * points at. A screen-reader user listing the page's links heard the same word
 * twice, with nothing to distinguish the shortcut from the destination, and the
 * `ArrowDownIcon` that makes the direction obvious to a sighted reader is
 * `aria-hidden` and contributes nothing to the name.
 *
 * These are tests on the *strings* rather than on a rendered accessibility
 * tree, which `bun test` has no DOM for. What they buy is that a future edit
 * shortening the label back to the heading fails here — and that shortening is
 * a plausible tidy, since "Zu den Kontaktdaten" is four times the width of
 * "Kontakt" in a 320 px sidebar card.
 */
describe("the jump link is distinguishable from the card it points at", () => {
  for (const locale of LOCALES) {
    test(`${locale}: its name differs from the card heading`, () => {
      const jump = dictionaries[locale]["mp.jumpToContact"]
      const heading = dictionaries[locale]["mp.contact"]
      expect(jump, `${locale}.mp.jumpToContact`).not.toBe(heading)
      // Not merely different — different in a way a listener notices. A label
      // that only added punctuation would pass a `!==` and fail a reader.
      expect(jump.length, `${locale}.mp.jumpToContact`).toBeGreaterThan(heading.length)
    })

    test(`${locale}: it names the destination rather than repeating the heading`, () => {
      // The pattern `protokoll.skipToData` set on `/`: say where the link goes.
      // Asserted as "contains the heading word plus more" rather than against
      // the exact phrase, so rewording stays free while the property holds.
      const jump = dictionaries[locale]["mp.jumpToContact"].toLowerCase()
      const heading = dictionaries[locale]["mp.contact"].toLowerCase()
      expect(jump.includes(heading.slice(0, 6)), `${locale}: "${jump}"`).toBe(true)
      expect(jump.split(/\s+/).length, `${locale}: "${jump}"`).toBeGreaterThan(1)
    })
  }

  test("the visible text carries the whole accessible name", () => {
    // No `aria-label` and no `sr-only` on this link, deliberately. A spoken
    // name longer than the visible one breaks WCAG 2.5.3 (Label in Name) and
    // voice control with it: "click Kontakt" stops matching the control it
    // names. Asserted over the component's own body so an `aria-label`
    // elsewhere in the file does not mask it.
    const body = code.slice(code.indexOf("function ContactJumpLink("))
    const end = body.indexOf("\nfunction ")
    const fn = body.slice(0, end === -1 ? undefined : end)
    expect(fn).toContain('t("mp.jumpToContact")')
    expect(fn).not.toContain("aria-label")
    expect(fn).not.toContain("sr-only")
  })

  test("the arrow stays out of the accessible name", () => {
    // It is decoration: the label already says the link goes somewhere. An
    // unhidden icon would append its own name to the link's.
    const body = code.slice(code.indexOf("function ContactJumpLink("))
    const end = body.indexOf("\nfunction ")
    expect(body.slice(0, end === -1 ? undefined : end)).toMatch(/ArrowDownIcon[^>]*aria-hidden/)
  })
})

describe("the contact card always renders", () => {
  test("the Contact component has no early return", () => {
    // The two `return null` lines this replaced are what made 12 members — and
    // every member during an enrichment outage — silent.
    const body = code.slice(code.indexOf("function Contact("))
    const end = body.indexOf("\nfunction ")
    expect(body.slice(0, end === -1 ? undefined : end)).not.toContain("return null")
  })

  test("the jump link is not conditional on contact data", () => {
    // A link that appeared only for populated members would reintroduce the
    // silence on exactly the members who need the explanation most.
    const body = code.slice(code.indexOf("function ContactJumpLink("))
    const end = body.indexOf("\nfunction ")
    expect(body.slice(0, end === -1 ? undefined : end)).not.toContain("mp.contact")
  })
})

describe("the empty state is honest and invents nothing", () => {
  test("it explains what the Bundestag does not publish", () => {
    expect(code).toContain('t("mp.noContact")')
    expect(code).toContain('t("mp.noContactExplain")')
  })

  test("it offers the official substitutes rather than a fabricated address", () => {
    // The Berlin office reaches every member and is a constant of the
    // institution; the directory is where the member's own page can be found by
    // hand. Both are real; neither is per-member data invented to fill a blank.
    expect(code).toContain('t("mp.postalSubstitute")')
    expect(code).toContain("BUNDESTAG_MPS_URL")
  })

  test("no email address or phone number is constructed anywhere", () => {
    // Neither exists in any source (`MDB_STAMMDATEN.DTD` declares no contact
    // elements; the biography pages carry zero `mailto:` and zero `tel:`), so a
    // link of either kind on this page could only have been invented.
    expect(code).not.toContain("mailto:")
    expect(code).not.toContain("tel:")
  })

  test("every outbound href comes from the data or from lib/links.ts", () => {
    // No literal `https://…` in the component: an MP's homepage and socials are
    // the source's, and the one constant is imported. A hardcoded URL here
    // would be this file asserting a fact about a member.
    expect(code).not.toMatch(/https?:\/\//)
  })
})

describe("both locales carry the contact strings", () => {
  // lib/i18n.test.ts already asserts the dictionaries have identical key sets,
  // which the typecheck also enforces. What is checked here is the narrower
  // claim the acceptance criteria make: the *empty state* is bilingual, so a
  // German reader and an English one both get the explanation rather than one
  // of them getting a key name.
  const KEYS = [
    "mp.contact",
    "mp.contactForm",
    "mp.contactFormHint",
    "mp.noContact",
    "mp.noContactExplain",
    "mp.postalSubstitute",
    "mp.officialDirectory",
    "mp.jumpToContact",
    "mp.berlinOffice",
    "mp.berlinAddress",
  ] as const

  for (const locale of LOCALES) {
    test(`${locale} defines every contact string, non-empty`, () => {
      for (const key of KEYS) {
        expect(dictionaries[locale][key]?.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    })
  }

  test("the two locales say different things", () => {
    // A copied German string in the English dictionary passes every key-set
    // check there is. The Berlin address is the deliberate exception: a postal
    // address is not translated.
    const untranslated = KEYS.filter(
      (key) => key !== "mp.berlinAddress" && dictionaries.de[key] === dictionaries.en[key],
    )
    expect(untranslated).toEqual([])
  })

  test("neither locale promises an email address or a phone number", () => {
    // The strings are where this promise would most plausibly creep back in —
    // a label is cheaper to write than a pipeline stage. `E-Mail`/`email` may
    // appear only in the sentences that say the Bundestag publishes none.
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        const value = dictionaries[locale][key]
        expect(value, `${locale}.${key}`).not.toMatch(/@/)
        expect(value, `${locale}.${key}`).not.toMatch(/\+49|tel:|mailto:/)
      }
    }
  })
})

describe("the anchor pair", () => {
  test("the fragment and the id are the same constant", () => {
    // Two literals would be two places to typo, and a link that scrolls nowhere
    // throws nothing and logs nothing.
    expect(code).toContain("CONTACT_ANCHOR")
    expect(CONTACT_ANCHOR).toBe("contact")
  })
})
