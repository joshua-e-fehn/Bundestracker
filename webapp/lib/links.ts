/**
 * Addresses outside this app that the UI links to.
 *
 * Two of these began as private constants in components/site-footer.tsx, which
 * was fine while the footer was the only thing that linked out. `/about` names
 * the same sources again — the open-data portal in its source list, the
 * repository in its "something wrong?" section — and a second copy of a URL is
 * how the footer and the methodology page come to disagree about where the
 * source code lives.
 *
 * Only *stable front doors* belong here: pages a reader can open. The machine
 * endpoints the pipeline actually fetches from (`search.dip.bundestag.de/api/v1`,
 * the Stammdaten ZIP) are deliberately absent — they answer 401 or download a
 * 15 MB archive, so linking one from a methodology page would be citing a
 * source by handing the reader a broken door. Those live in the pipeline, next
 * to the code that calls them.
 *
 * Per-document URLs are not here either: a Drucksache and a protocol have a
 * deterministic address, so they are computed rather than stored — see
 * `drucksachePdfUrl` and `protocolPdfUrl` in lib/bundestag.ts.
 */

/** The Bundestag's open-data landing page. Linked rather than merely named: the
 * claim that every figure is backed by a Bundestag record is only checkable if
 * the reader can reach the records. */
export const BUNDESTAG_OPEN_DATA_URL = "https://www.bundestag.de/services/opendata"

/** DIP, the parliamentary documentation system — the browsable front end of the
 * API the pipeline reads. */
export const DIP_URL = "https://dip.bundestag.de"

/**
 * The Bundestag's own directory of members — the page every biography page and
 * every contact form hangs off.
 *
 * The profile's contact card falls back to this when the pipeline holds no
 * contact block for a member (12 of 635 in WP21). Deliberately the *listing*
 * and not a guessed per-MP URL: the per-MP page is keyed by bundestag.de's own
 * CMS id, a fourth MP id space the pipeline only ever learns by matching a name
 * (see `formUrl` in convex/schema.ts) — so for exactly the members that need
 * this fallback, there is no id to build one from. A link to a real listing the
 * reader can search beats a constructed link that 404s.
 */
export const BUNDESTAG_MPS_URL = "https://www.bundestag.de/abgeordnete"

/**
 * The Bundestag's central switchboard, as its own imprint publishes it.
 *
 * ## Why a phone number is here at all
 *
 * The rest of this app deliberately holds no telephone number, because none is
 * published *per member*: a 110-page audit of biography pages on 2026-07-31
 * found zero `tel:` links and zero printed numbers, and `MDB_STAMMDATEN.DTD`
 * declares no contact element (docs/api-research.md §6.6). This one is a
 * different kind of fact. It is the number of the *institution*, printed on
 * `bundestag.de/services/impressum`, and every member's direct dial is an
 * extension of it — the `030 227-xxxxx` numbers members publish on their own
 * websites all hang off this stem.
 *
 * So it is exactly the same character as `mp.berlinAddress`: one true constant
 * that reaches all 630, stored once in the dictionary rather than copied into
 * 630 rows. It is not personal data, it is not inferred, and it is not
 * attributed to any individual member.
 *
 * ## Two constants, and a test that makes them agree
 *
 * `-0` is how the Bundestag prints it and how a reader recognises a
 * switchboard; `tel:` wants an unpunctuated, fully-qualified number. They are
 * written out separately so the display string stays the source's, verbatim.
 *
 * ⚠ **An earlier version of this comment argued that writing both by hand meant
 * "neither is a regex away from being wrong". That was exactly backwards, and it
 * shipped a wrong number.** `BUNDESTAG_SWITCHBOARD_TEL` was `tel:+493022770` —
 * one `7` too many, i.e. local `22770`, which reads as extension `227-70` rather
 * than the switchboard. Nothing caught it, because every test that pinned the
 * URI pinned it *to this constant*: the pair was self-consistent and jointly
 * wrong. Two hand-written values with no rule tying them together are not two
 * independent facts, they are one fact and one opportunity for a typo.
 *
 * So `lib/links.test.ts` now derives the digits from the *printed* string and
 * compares — dropping the German trunk `0`, which is written `(0)` precisely
 * because it is omitted when dialling internationally. The printed form is the
 * source of truth because it is the one copied from the imprint; the URI has to
 * answer to it.
 *
 * ⚠ Note `lib/bundestag.ts`'s `safeExternalUrl` rejects `tel:` by design. That
 * is correct and stays: it guards URLs that arrived from a *scraped page*, and
 * this is a module constant that no source can influence. A caller with a
 * different need brings its own allowlist rather than widening that one — which
 * is what its own docstring asks for.
 */
export const BUNDESTAG_SWITCHBOARD = "+49 (0)30 227-0"

/**
 * The dialable form of {@link BUNDESTAG_SWITCHBOARD}.
 *
 * `+49` `30` `227` `0` — country code, Berlin area code without its trunk `0`,
 * the Bundestag stem, and the `-0` that reaches the switchboard rather than an
 * extension. The stem is a *number*, not a prefix pattern: the digits after the
 * hyphen concatenate onto it, which is why the imprint's petitions line
 * `+49 (0)30 227-35257` dials `+493022735257`.
 */
export const BUNDESTAG_SWITCHBOARD_TEL = "tel:+49302270"

/** abgeordnetenwatch, the non-profit whose CC0 data supplements the official
 * roster (§4.3, §10 of docs/api-research.md). */
export const ABGEORDNETENWATCH_URL = "https://www.abgeordnetenwatch.de"

/** This app's source. The scoring is an editorial weighting (lib/scoring.ts),
 * so "read the code" is part of the offer rather than a courtesy. */
export const REPO_URL = "https://github.com/joshua-e-fehn/Bundestracker"
