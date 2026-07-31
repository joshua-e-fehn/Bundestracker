/**
 * What "how to reach this MP" amounts to, once the source has been read.
 *
 * ⚠ **There is no per-member email address and no direct dial, for anyone.**
 * That is a fact about the source rather than a gap in the pipeline:
 * `MDB_STAMMDATEN.DTD` declares no contact elements at all, and 110 biography
 * pages audited on 2026-07-31 carry zero addresses and zero numbers. The
 * Bundestag publishes a web *form* instead, which is what `formUrl` holds. See
 * the note on `contact` in convex/schema.ts.
 *
 * ⚠ The card does print one telephone number — the Bundestag's own switchboard,
 * from `lib/links.ts`. It is not a member's and is not stored here: it is a
 * constant of the institution, exactly like the Berlin address, and it is
 * therefore deliberately **not** counted by `any` below. Counting it would make
 * every member look populated, which is the bug this module exists to prevent.
 *
 * ## Why this is a module and not four `Boolean(…)` calls in the card
 *
 * The card has two states — the source published channels, or it did not — and
 * for 12 of 635 WP21 members the second one is the truth rather than an outage.
 * Which state renders is therefore a claim about the record, and the audit of
 * 2026-07-29 (docs/implementation-gap-audit-2026-07-29.md, GAP-003) found the
 * old answer was to render *nothing at all*: a reader looking for how to write
 * to their MP could not tell an absent source from a broken pipeline, because
 * both looked like a profile with no contact section on it.
 *
 * Splitting the decision out means it can be tested against both states without
 * a DOM, which is the only way to hold a rule that has no visible failure — a
 * card that silently disappears looks exactly like a card that was never there.
 *
 * ## A channel that will not open is not a channel
 *
 * Every URL here was scraped from an HTML page (pipeline `api/mp_profiles.py`),
 * so it is free text that happens to usually be a URL. One that does not parse,
 * or that carries a scheme a browser will not navigate to, is filtered out
 * rather than rendered as a dead link — and, more to the point, is not counted
 * towards `any`. Counting it would put the profile in the populated state on
 * the strength of a link it cannot draw, which is the *silent* half of the same
 * bug: a card that says nothing while claiming to say something.
 */

/**
 * The fragment the profile header's jump link points at, and the id the contact
 * card carries.
 *
 * One constant rather than two string literals, exactly as `DATA_ANCHOR` in
 * lib/protokoll.ts is: the two are only useful as a pair, and the failure mode
 * of a typo is a link that scrolls nowhere and reports nothing.
 */
export const CONTACT_ANCHOR = "contact"

/** The stored block, exactly as convex/schema.ts declares it. Optional as well
 * as nullable — see the note on the enrichment fields in components/mp-profile.tsx
 * for why the key may be missing outright rather than merely null. */
export type ContactBlock =
  | {
      formUrl: string | null
      constituencyOffice: string | null
      homepage: string | null
      socials: ReadonlyArray<{ platform: string; url: string }>
    }
  | null
  | undefined

/** One social profile, after filtering. */
export type SocialLink = { platform: string; url: string }

/** What the card has to draw, and whether the source gave it anything. */
export type ContactChannels = {
  formUrl: string | null
  homepage: string | null
  /** Newline-separated as printed — an MP may list two offices in one string. */
  constituencyOffice: string | null
  socials: readonly SocialLink[]
  /**
   * Whether the source published *any* channel for this member.
   *
   * Deliberately excludes the Berlin office. That address is `Platz der
   * Republik 1` for all 630 members and is printed from the dictionary rather
   * than stored, so counting it would make every row look populated and this
   * flag would always be true.
   */
  any: boolean
}

/** Schemes a link may carry. Anything else — `javascript:`, `data:` — is a
 * string that arrived from a scraped page and is not a way to reach anybody. */
const SAFE_SCHEMES = new Set(["http:", "https:"])

/**
 * Whether a scraped string is a URL this app will link to.
 *
 * `URL.canParse` alone is not enough: `javascript:alert(1)` parses. The scheme
 * check is what makes this a safety property rather than a formatting one.
 */
export function isLinkableUrl(url: string | null | undefined): url is string {
  if (!url) return false
  const trimmed = url.trim()
  if (!URL.canParse(trimmed)) return false
  return SAFE_SCHEMES.has(new URL(trimmed).protocol)
}

/** The host of a URL, without `www.`, or null if it does not parse. Display
 * only: `https://www.sanaeabdi.de/` is wider than the card on a phone and says
 * nothing the host does not. */
export function hostOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  return new URL(url).host.replace(/^www\./, "")
}

/** Trimmed, or null if there was nothing but whitespace. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * The block as the card should read it: linkable URLs only, and an honest
 * answer to "did the source publish anything".
 *
 * Accepts a missing block as well as an empty one, because the three absences —
 * key absent, `null`, and a block whose every field is empty — mean the same
 * thing to a reader and must render the same way.
 */
export function contactChannels(contact: ContactBlock): ContactChannels {
  const formUrl = isLinkableUrl(contact?.formUrl) ? contact.formUrl.trim() : null
  const homepage = isLinkableUrl(contact?.homepage) ? contact.homepage.trim() : null
  const constituencyOffice = text(contact?.constituencyOffice)
  // `platform` is free text and the list is the Bundestag's — it grows — so an
  // unrecognised network must survive; only an unusable *URL* is dropped. A
  // platform with no name is labelled by its host rather than by an empty link.
  const socials: SocialLink[] = []
  for (const social of contact?.socials ?? []) {
    if (!isLinkableUrl(social.url)) continue
    const url = social.url.trim()
    socials.push({ platform: text(social.platform) ?? hostOf(url) ?? url, url })
  }

  return {
    formUrl,
    homepage,
    constituencyOffice,
    socials,
    any: Boolean(formUrl || homepage || constituencyOffice) || socials.length > 0,
  }
}
