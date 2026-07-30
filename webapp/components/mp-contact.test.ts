import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Contact, type MPDoc } from "@/components/mp-profile"
import { LocaleProvider } from "@/components/providers/locale-provider"
import { dictionaries } from "@/lib/i18n"
import { BUNDESTAG_MPS_URL } from "@/lib/links"

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
    expect(html).not.toContain(de["mp.officialDirectory"])
    expect(html).not.toContain(de["mp.postalSubstitute"])
  })

  test("no fabricated mailto: or tel: link — the Bundestag publishes neither", () => {
    // `lib/i18n.test.ts` guards the dictionary against phone/email
    // literals; this guards the rendered HTML. GAP-004 documents that the
    // Bundestag publishes no per-MP email and no per-MP phone number, so
    // neither may ever appear in the page — even for a "populated" contact.
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
    expect(html).not.toMatch(/href="tel:/)
    expect(html).not.toMatch(/href="\+/)
    // The DE stub above has no `@` in the address; the check is on the
    // rendered attribute, so a `mailto:someone@example.com` would show up.
    expect(html).not.toMatch(/href="[^"]*@[^"]*"/)
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
