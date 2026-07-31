import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Contact, type MPDoc } from "@/components/mp-profile"
import { LocaleProvider } from "@/components/providers/locale-provider"
import { dictionaries } from "@/lib/i18n"
import { BUNDESTAG_MPS_URL, BUNDESTAG_SWITCHBOARD, BUNDESTAG_SWITCHBOARD_TEL } from "@/lib/links"

/**
 * Rendered-DOM assertions for the Contact card — Acceptance Criterion AC-6.
 *
 * ## What this catches that `mp-profile.test.ts` cannot
 *
 * The sibling suite is a source-order guard: it asserts that Contact renders
 * before Biography in the file, that the jump link points at the right
 * anchor, and that the empty-state copy is present as a *string* somewhere
 * near the card. That is enough for placement — the header order is a file
 * order — but not for behaviour. GAP-003's regression was a `return null`
 * in the empty branch, which passed every source-order check the profile
 * carried and shipped a page whose Contact section silently vanished for
 * every MP without a phone number. AC-6 asks that a rendered-DOM check pin
 * both branches together: an empty `contact` still renders the card, and a
 * populated `contact` still renders the empty-state fallback out.
 *
 * ## Why `renderToStaticMarkup`, not `@testing-library/react`
 *
 * The webapp has neither `@testing-library/react` nor `jsdom` / `happy-dom`
 * in its dev deps; the only DOM-adjacent tests in the tree are the source-
 * string ones (`app/page.test.ts`, `components/sidebar-account.test.ts`,
 * `components/providers/theme-color.test.ts`). `react-dom/server` is
 * already a transitive dep of the app itself, and `renderToStaticMarkup`
 * returns an HTML string that can be asserted against with `toContain` /
 * `toMatch`. That is exactly what AC-6 needs: presence and absence of
 * specific elements in specific branches, not interaction. Header comment
 * in `components/providers/theme-color.test.ts` documents the same trade
 * (source-string over DOM) for a neighbouring guard.
 *
 * ## Why the whole `<Contact mp={...} />` (not a `ContactView` shim)
 *
 * A pure `ContactView({ channels, t })` would be easier to test but would
 * decouple the DOM output from `contactChannels` — which is the helper the
 * card was actually built around and whose contract this is here to pin. So
 * the test wraps `Contact` in a real `LocaleProvider` (imported as-is) and
 * renders it: the whole hook chain runs, and a bug in either the helper or
 * the JSX surfaces here.
 */

const MP_STUB: MPDoc = {
  internalId: "bt-0001",
  name: "Muster Beispiel",
  fraktion: "SPD",
  party: "SPD",
  constituency: "Musterhausen",
  photoUrl: null,
  birthDate: null,
  electionMethod: null,
  datesInOffice: { start: "2025-03-25", end: null },
  bio: null,
  education: null,
  profession: null,
  occupation: null,
  photoCredit: null,
  contact: null,
}

function renderContact(mp: MPDoc): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      // `children` is a required prop even when React derives it from the
      // third argument to `createElement` — the type demands it explicitly
      // so this cast satisfies both the compile-time check and the actual
      // runtime shape, where the child is provided positionally below.
      { initialLocale: "de", children: null } as Parameters<typeof LocaleProvider>[0],
      createElement(Contact, { mp }),
    ),
  )
}

const de = dictionaries.de

/** A block with every channel the source publishes, for the branch where the
 * card is populated. The switchboard must render here too — it is a constant of
 * the institution, not a fallback for members the pipeline missed. */
const POPULATED = {
  formUrl: "https://bundestag.de/webarchiv/kontakt/muster",
  homepage: "https://muster-beispiel.de/",
  constituencyOffice: "Musterstraße 1\n12345 Musterhausen",
  socials: [{ platform: "Instagram", url: "https://www.instagram.com/muster/" }],
} as const

describe("Contact renders the card in both branches", () => {
  test("an MP with no contact block still gets the card, the anchor, and the empty-state copy", () => {
    // GAP-003 was a `return null` here. Every assertion below fails under
    // that regression, so this is the guard.
    const html = renderContact({ ...MP_STUB, contact: null })

    // The card and its anchor: the sticky-header jump depends on both.
    expect(html).toContain(`id="contact"`)
    expect(html).toContain(de["mp.contact"])

    // The empty-state prose that GAP-003 asked for.
    expect(html).toContain(de["mp.noContact"])
    expect(html).toContain(de["mp.noContactExplain"])
    // The Bundestag directory link — the last-resort substitute for the
    // one channel the Bundestag actually publishes for every member.
    expect(html).toContain(`href="${BUNDESTAG_MPS_URL}"`)
    expect(html).toContain(de["mp.officialDirectory"])
    // The postal fallback and its explanation sentence — the one the empty
    // branch adds and the populated branch does not.
    expect(html).toContain(de["mp.postalSubstitute"])
    expect(html).toContain(de["mp.berlinOffice"])
  })

  test("`contact: undefined` behaves the same as `contact: null` — three absences, one answer", () => {
    // `MPDoc.contact` is `?:` on top of `| null`, so a row that predates the
    // column arrives with the key missing. The rule this pins (from GAP-003's
    // fix and the lib/contact.ts header): three absences are one answer.
    // `contactChannels(undefined)` is `contactChannels(null)`, so the
    // rendered output has to match.
    const nullish = renderContact({ ...MP_STUB, contact: null })
    const missing = renderContact({ ...MP_STUB, contact: undefined as unknown as ContactPartial })
    expect(missing).toBe(nullish)
  })

  test("a populated contact renders every channel it holds and none it does not", () => {
    const html = renderContact({
      ...MP_STUB,
      contact: {
        formUrl: "https://bundestag.de/webarchiv/kontakt/muster",
        homepage: "https://muster-beispiel.de/",
        constituencyOffice: "Musterstraße 1\n12345 Musterhausen",
        socials: [
          { platform: "Mastodon", url: "https://social.bund.de/@muster" },
          { platform: "Bluesky", url: "https://bsky.app/profile/muster.example" },
        ],
      },
    })

    // Populated channels present.
    expect(html).toContain(`href="https://bundestag.de/webarchiv/kontakt/muster"`)
    expect(html).toContain(de["mp.contactForm"])
    expect(html).toContain(`href="https://muster-beispiel.de/"`)
    // The bare host, not the full URL: the file explicitly renders
    // `hostOf(homepage) ?? homepage` inside the link.
    expect(html).toContain("muster-beispiel.de")
    expect(html).toContain(de["mp.constituencyOffice"])
    expect(html).toContain("Musterstraße 1")
    expect(html).toContain(de["mp.socials"])
    expect(html).toContain("Mastodon")
    expect(html).toContain("Bluesky")

    // The empty-state copy must NOT appear when *any* channel is present —
    // the whole "three absences are one answer" rule breaks if a populated
    // MP still gets the fallback sentence.
    expect(html).not.toContain(de["mp.noContact"])
    expect(html).not.toContain(de["mp.noContactExplain"])
    expect(html).not.toContain(de["mp.postalSubstitute"])
    // The directory link, by its href rather than its label: the label is the
    // phrase "Abgeordnetenverzeichnis des Bundestages", which `mp.contactFormHint`
    // now also contains — naming the directory is how that sentence states
    // *which* source publishes no address. Asserting on the link is what the
    // test meant in the first place; asserting on the words made an honest
    // sentence look like a leaked fallback.
    expect(html).not.toContain(`href="${BUNDESTAG_MPS_URL}"`)
  })

  test("no fabricated mailto:, and the only tel: is the switchboard's", () => {
    // `lib/i18n.test.ts` guards the dictionary against phone/email literals;
    // this guards the rendered HTML. The member directory publishes no per-MP
    // address and no per-MP direct dial (110 pages audited 2026-07-31), so
    // neither may ever appear — even for a "populated" contact.
    //
    // ⚠ This assertion used to be `not.toMatch(/href="tel:/)`, i.e. *no* phone
    // link at all, on the premise that the Bundestag published no number
    // whatsoever. That premise was wrong: it prints its own switchboard on its
    // imprint. So the rule is now the one that was always meant — exactly one
    // number, the institution's, and never a member's.
    const html = renderContact({
      ...MP_STUB,
      contact: {
        formUrl: "https://bundestag.de/webarchiv/kontakt/muster",
        homepage: "https://muster-beispiel.de/",
        constituencyOffice: "Musterstraße 1\n12345 Musterhausen",
        socials: [],
      },
    })
    expect(html).not.toMatch(/mailto:/)
    expect(html.match(/href="tel:[^"]*"/g)).toEqual([`href="${BUNDESTAG_SWITCHBOARD_TEL}"`])
    expect(html).not.toMatch(/href="\+/)
    // The DE stub above has no `@` in the address; the check is on the
    // rendered attribute, so a `mailto:someone@example.com` would show up.
    expect(html).not.toMatch(/href="[^"]*@[^"]*"/)
  })

  test("the switchboard renders in both branches — it reaches every member", () => {
    // It is a constant of the institution, like the Berlin address beside it,
    // so it does not depend on what the pipeline resolved for this member. In
    // the empty state it is most of what the card has to offer, which is
    // exactly when it must not be missing.
    for (const contact of [null, POPULATED]) {
      const html = renderContact({ ...MP_STUB, contact })
      expect(html).toContain(BUNDESTAG_SWITCHBOARD)
      expect(html).toContain(`href="${BUNDESTAG_SWITCHBOARD_TEL}"`)
      // The number is labelled as the switchboard's rather than left to read as
      // this member's direct line.
      expect(html).toContain(de["mp.switchboardHint"])
    }
  })

  test("attacker-controlled mailto:/tel: URLs in socials[] are refused, not rendered", () => {
    // `socials[].url` is scraped from external HTML by
    // `pipeline/.../bio.py`, which means an operator who owns a
    // bundestag.de page — or a compromised source hop — could feed the
    // pipeline arbitrary strings. `isLinkableUrl` in lib/contact.ts is
    // the sole guard (`SAFE_SCHEMES = {http:, https:}`), and rejecting a
    // hostile URL there is what stops it reaching a rendered `href`. The
    // fabricated-mailto test above only covers well-formed input; this
    // one is the adversarial half — malicious inputs that would parse as
    // URLs but that the guard is meant to drop.
    //
    // The Contact card would render each of these as an `<a href>` if
    // the guard were lifted, so an attacker who got them past the
    // pipeline could put a live `mailto:` next to every MP name. The
    // assertions below say: not rendered, no matter how they were sent.
    const html = renderContact({
      ...MP_STUB,
      contact: {
        formUrl: null,
        homepage: null,
        constituencyOffice: null,
        socials: [
          // The classic mailto injection — a URL that parses fine and
          // whose scheme would open the reader's mail client.
          { platform: "Kontakt", url: "mailto:evil@example.com" },
          // Same shape, phone dialler.
          { platform: "Anrufen", url: "tel:+491234567890" },
          // `javascript:` — the reason `isLinkableUrl` needs the scheme
          // allowlist rather than a `URL.canParse` boolean.
          { platform: "Script", url: "javascript:alert('xss')" },
          // `data:` — another usable-in-href scheme the allowlist drops.
          { platform: "Data", url: "data:text/html,<script>alert(1)</script>" },
          // A well-formed https: link, to prove the row is dropped by
          // scheme rather than by "socials is empty".
          { platform: "Mastodon", url: "https://social.bund.de/@muster" },
        ],
      },
    })

    // None of the hostile schemes make it into a rendered attribute or
    // as visible text — the `<a href>` guard drops the row entirely, so
    // even the platform label ("Kontakt", "Anrufen") should be absent:
    // rendering the label without the link would make the row look
    // populated while offering no way to reach anybody.
    //
    // Regexes anchor on the scheme (`href="mailto:` etc) rather than on
    // bare substrings, because a legitimate Mastodon URL like
    // `https://social.bund.de/@muster` contains `@` and would false-
    // positive an "email in href" check. The point is to refuse the
    // *scheme*, not to reject every character mail addresses happen to
    // share with usernames.
    expect(html).not.toMatch(/href="mailto:/)
    // Exactly one phone link, and it is the constant from lib/links.ts — the
    // attacker's `tel:` is dropped, not merely outnumbered. Asserting the whole
    // set rather than "no tel: at all" is what lets the switchboard exist
    // without opening the door to a scraped number beside it.
    expect(html.match(/href="tel:[^"]*"/g)).toEqual([`href="${BUNDESTAG_SWITCHBOARD_TEL}"`])
    expect(html).not.toMatch(/href="javascript:/)
    expect(html).not.toMatch(/href="data:/)
    expect(html).not.toContain("evil@example.com")
    expect(html).not.toContain("+491234567890")
    // The one safe-scheme row survives — proof the drop is
    // per-scheme, not "socials is refused entirely".
    expect(html).toContain(`href="https://social.bund.de/@muster"`)
    expect(html).toContain("Mastodon")
  })

  test("a social with a blank `platform` still renders — falls back to the host", () => {
    // The platform is free text (the pipeline preserves what the Bundestag
    // sends), and a blank one must not silently drop the row: an
    // unrecognised platform must render as *itself*, and the host is a
    // stable fallback. This pins the loose behaviour rather than mandating
    // a specific fallback shape — anything visible in the HTML that names
    // the URL is fine.
    const html = renderContact({
      ...MP_STUB,
      contact: {
        formUrl: null,
        homepage: null,
        constituencyOffice: null,
        socials: [{ platform: "   ", url: "https://social.bund.de/@muster" }],
      },
    })
    expect(html).toContain(`href="https://social.bund.de/@muster"`)
    // Either the raw platform string (a `   `) or the URL text is fine —
    // the assertion is that the row was not dropped.
    expect(html).toContain("social.bund.de")
  })
})

/**
 * `contact: undefined` narrowing helper — `MPDoc.contact` is `?:` on top of
 * `ContactBlock | null`, and the test above passes `undefined` on purpose
 * to exercise the "key absent" arm. This local alias makes the intent
 * visible instead of relying on `as unknown as ...` casts.
 */
type ContactPartial = MPDoc["contact"]
