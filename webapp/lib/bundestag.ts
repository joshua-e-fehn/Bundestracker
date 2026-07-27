/**
 * Bundestag facts the UI needs and the database does not store.
 *
 * Three kinds of thing live here, and they are together because they share one
 * property: they are constants of the institution rather than of a row.
 *
 *  - **Which Wahlperiode "now" means.** Every profile and list read is scoped to
 *    a period, and a page that hard-coded 21 in six places would need six edits
 *    at the next election.
 *  - **Document URLs.** A Drucksache and a plenary protocol both have a
 *    deterministic address on `dserver.bundestag.de` (§8 of docs/api-research.md,
 *    verified against all 86 WP21 protocols). Storing them per row would be
 *    storing a formula 80 000 times.
 *  - **Fraktion identity.** Party colours are not published anywhere machine-
 *    readable, and `fraktion` is free text — see the mapping note in §6.4 — so
 *    the lookup is defensive by design and falls through to neutral rather than
 *    guessing.
 *
 * Formatting helpers sit here too because they take the reader's locale, and
 * dates in this codebase are ISO strings by convention (see the header of
 * convex/schema.ts) — turning one into "12. Juni 2026" is a display decision,
 * not a data one.
 */

import type { Locale } from "./i18n"
import { type PartyKey, partyFor } from "./parties"

/**
 * The Wahlperiode the site shows by default.
 *
 * Mirrors `CURRENT_ELECTORAL_PERIOD` in pipeline/src/bundestrack/cli.py:32 —
 * the pipeline decides what gets *fetched*, this decides what gets *shown*, and
 * showing a period the pipeline has not loaded is an empty page rather than an
 * error. They are two files because they are two processes; keeping the number
 * in one named place on each side is what makes the next election a two-line
 * change.
 */
export const CURRENT_WAHLPERIODE = 21

/**
 * The federal state a constituency name implies, or null.
 *
 * Not a stored field. §6.2 records `WKR_LAND` in the Stammdaten constituency
 * block, but the roster schema keeps only the constituency *name*, so the state
 * is recoverable only where the pipeline spelled it into that name. It does not
 * today, which is why this returns null far more often than a state — and why
 * every state filter on the site builds its options from the data rather than
 * from a hardcoded list of sixteen Länder that would offer fifteen empty ones.
 *
 * Reading the trailing parenthetical is the one thing that works without a
 * schema change: `Ludwigsburg (BW)` yields `BW`. A name with no parenthetical
 * yields null rather than a guess.
 *
 * Here rather than in convex/rankings.ts, where it began, because two surfaces
 * now need it: the rankings' state filter runs server-side over `Doc<"mps">`,
 * and the roster table's runs in the browser over rows already loaded. Two
 * copies would be two answers to "which state is this MP from", and they would
 * disagree the day either one's regex was tightened. It takes the constituency
 * string rather than a document so both can call it — convex/ may import from
 * lib/, but not the other way around.
 *
 * ⚠ This is the honest ceiling on every "by federal state" filter until the
 * pipeline stores `WKR_LAND` as its own field. Each is wired end to end so that
 * adding the field is a one-line change here.
 */
export function stateOf(constituency: string | null | undefined): string | null {
  if (!constituency) return null
  const match = /\(([^)]+)\)\s*$/.exec(constituency)
  if (!match) return null
  const code = match[1].trim()
  // Two-letter Land codes (`BW`, `NW`) and nothing else: the same parenthetical
  // slot carries a disambiguator in `Brand (Fulda)`, and a town is not a state.
  return /^[A-ZÄÖÜ]{2}$/.test(code) ? code : null
}

/**
 * What an MP does, from the two sources that answer it differently.
 *
 * `occupation` is abgeordnetenwatch's answer — what they do *now*, which for a
 * sitting member is often `MdB` — and covers 88.1 % of WP21. `profession` is
 * Stammdaten's `BERUF`, the trade practised *before* the mandate, and covers
 * 94.3 %. Neither is a superset of the other, so this prefers the current
 * answer and falls back to the former one.
 *
 * One function rather than the same `??` chain in the table, the tooltip and
 * the profile: they must agree on what "occupation" shows, or the same MP reads
 * as a lawyer in one place and an MdB in another.
 *
 * Takes the two fields rather than a document so that `convex/` and the browser
 * can both call it — convex/ may import from lib/, but not the other way
 * around, exactly as `stateOf` above.
 */
export function occupationOf(mp: {
  occupation?: string | null
  profession?: string | null
}): string | null {
  return mp.occupation?.trim() || mp.profession?.trim() || null
}

// --- document URLs --------------------------------------------------------

const DOCUMENT_SERVER = "https://dserver.bundestag.de"

/**
 * The PDF of a printed paper, from its `21/7327`-style number.
 *
 * `btd/<wp>/<nr//100:03d>/<wp><nr:05d>.pdf` (§8). Mirrors `drucksache_pdf` in
 * the research doc; the pipeline has no equivalent because it never links out.
 *
 * Returns null rather than a broken link for anything that does not parse.
 * `drucksacheNr` is nullable in the schema and §5.1 warns that Bundesrat papers
 * carry a bare running number with no `wp/` prefix — those would silently
 * produce a URL pointing at the wrong document, which is worse than no link.
 */
export function drucksachePdfUrl(drucksacheNr: string | null): string | null {
  if (!drucksacheNr) return null
  const match = /^(\d{1,2})\/(\d{1,5})$/.exec(drucksacheNr.trim())
  if (!match) return null
  const wahlperiode = Number(match[1])
  const number = Number(match[2])
  const block = String(Math.floor(number / 100)).padStart(3, "0")
  return `${DOCUMENT_SERVER}/btd/${wahlperiode}/${block}/${wahlperiode}${String(number).padStart(5, "0")}.pdf`
}

/**
 * The PDF of one plenary sitting's protocol.
 *
 * `btp/<wp>/<wp><sitzung:03d>.pdf` — the same formula
 * `protocol_xml_url` uses in pipeline/src/bundestrack/api/protocols.py:101,
 * with the PDF extension because a reader wants the document, not the source
 * the parser ate. §5.1 verified the pattern against all 86 WP21 protocols.
 */
export function protocolPdfUrl(wahlperiode: number, sitzungnr: number): string {
  return `${DOCUMENT_SERVER}/btp/${wahlperiode}/${wahlperiode}${String(sitzungnr).padStart(3, "0")}.pdf`
}

// --- Fraktion identity ----------------------------------------------------

/**
 * Tailwind classes for a Fraktion badge.
 *
 * ## This used to be a second party palette, and that was the bug
 *
 * Until the brand palette landed, this module carried its own table of seven
 * `border-…/30 bg-…/15 text-…-700 dark:text-…-300` triples keyed by folded
 * substrings, while `lib/parties.ts` carried a *different* set of colours for
 * the same seven groups as `--party-*` custom properties. Both were live:
 * `FraktionBadge` (the roster table and the profile header) read this one,
 * `PartyBadge` (the cards, the feed, the vote table, the rankings, the seating
 * legend) read the other. So one MP's AfD badge was Tailwind `sky` on
 * `/mps` and `--party-afd` on `/rankings` — two blues for one party, on two
 * pages a reader moves between by clicking a row.
 *
 * Rather than translating this table into brand tokens and leaving two tables
 * to drift again, the matching and the colours now live in `lib/parties.ts`
 * alone and this function composes classes from `partyFor`. That module already
 * did the harder half of the job: its `fold` handles the non-breaking space
 * §5.2 found in the protocol XML and the umlaut spellings, which the plain
 * `toLowerCase().includes()` here did not.
 *
 * ## What was kept
 *
 * The two shapes this delegates to are `parties.ts`' concern now, and its
 * matcher list preserves every ordering constraint this one documented — see
 * the header of `MATCHERS` there for `fraktionslos` before the party names, the
 * union before "Christlich - Sozialen", and the AfD matched as a phrase rather
 * than on `deutschland`.
 *
 * BSW and SSW are the one behavioural loss, and it is deliberate. Neither sits
 * in WP21 (§9 counts CDU/CSU, AfD, SPD, Grüne, Linke and three fraktionslos
 * members), neither is in `PARTY_KEYS`, and a group `parties.ts` does not
 * recognise is *meant* to render neutral — that is the visible prompt to add
 * it, stated in that module's header. Colouring them here and not there would
 * reintroduce exactly the split this change removes. Adding them belongs in
 * `PARTY_KEYS` and `--party-*`, in one place, on the day either wins seats.
 */
const NEUTRAL_STYLE = "border-border bg-muted text-muted-foreground"

/**
 * The class string per party.
 *
 * **Spelled out rather than composed.** `bg-party-${key}/15` would be tidier
 * and would not work: Tailwind v4 finds classes by scanning source text, so a
 * name assembled at runtime is never in the generated stylesheet and the badge
 * renders with no background at all. A `Record<PartyKey, …>` also means a party
 * added to `PARTY_KEYS` is a type error here rather than a silently unstyled
 * badge.
 *
 * The tokens are the same custom properties `partyColor` returns, reached
 * through the `@theme inline` block in app/globals.css — so the badge, the seat
 * dot and the legend swatch are one colour resolved three ways. Each `--party-*`
 * is solved for 4.5:1 against the page background in *both* themes, which is
 * why none of these carries a `dark:` variant.
 */
const PARTY_STYLES: Record<PartyKey, string> = {
  // CDU/CSU is black by convention, which is also the page's text colour — so
  // it takes the neutral foreground ramp rather than `--party-cdu-csu`, whose
  // near-black is a *seat dot* colour and would be unreadable as badge text on
  // this badge's own light tint.
  "cdu-csu": "border-foreground/25 bg-foreground/10 text-foreground",
  spd: "border-transparent bg-party-spd/15 text-party-spd",
  gruene: "border-transparent bg-party-gruene/15 text-party-gruene",
  fdp: "border-transparent bg-party-fdp/15 text-party-fdp",
  afd: "border-transparent bg-party-afd/15 text-party-afd",
  linke: "border-transparent bg-party-linke/15 text-party-linke",
  // Neutral, both of them: a group with no colour of its own, and a spelling
  // `parties.ts` has never seen. Falling through to this is intended — a group
  // is legible without its colour, and inventing one would assert a party
  // identity the data does not carry.
  fraktionslos: NEUTRAL_STYLE,
  unknown: NEUTRAL_STYLE,
}

export function fraktionClassName(fraktion: string): string {
  return PARTY_STYLES[partyFor(fraktion).key]
}

/**
 * Two letters for an MP with no portrait.
 *
 * The fallback is load-bearing rather than decorative: §6.5 measured Wikimedia
 * Commons coverage at **36.5 %** of WP21, so roughly two in three MPs render as
 * initials and this is what most of the grid actually looks like.
 *
 * Three kinds of word are dropped before the first and last letters are taken,
 * each because the sources put something in the display name that is not part
 * of anyone's name:
 *
 *  - **Academic titles** — `Dr. Hülya Düber` is `HD`, not `DH`. Stammdaten
 *    carries them inline and an initial of "Dr" is an initial of nobody.
 *  - **Name particles** — §4.1 files `von`/`van`/`de` under a column headed
 *    `Titel`, which does not hold academic titles. Without this, half the
 *    aristocracy would share the initials "V".
 *  - **The parenthesised ortsZusatz** — §6.2 spells it inline, as in
 *    `Brand (Fulda)`, to tell two MPs of the same name apart.
 *
 * ## This is the only implementation
 *
 * Four existed: this one, a near-copy in lib/format.ts, and two private ones in
 * components/rankings-table.tsx and components/activity-feed-item.tsx. The two
 * private ones split on whitespace alone, so `Michael Brand (Fulda)` rendered as
 * the avatar `M(` on the rankings and the feed while the roster beside them said
 * `MB` — the same person, two labels, because the logic had four homes and only
 * two of them knew about §6.2. A browser sweep found it on screen; no test could
 * have, since each copy was consistent with itself.
 */
const TITLE_WORDS = new Set(["dr", "prof", "dr.", "prof.", "h.c.", "hc", "med", "jur", "rer"])

/** Lowercased, so the membership test folds case at the call site. */
const NAME_PARTICLES = new Set([
  "von",
  "van",
  "de",
  "der",
  "den",
  "dem",
  "du",
  "di",
  "da",
  "zu",
  "zur",
  "la",
  "le",
])

export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, " ") // the `(Fulda)` disambiguator, not part of a name
    // Hyphens split too: `Strack-Zimmermann` is one surname of two parts, and
    // the last of them is the letter a reader expects to see.
    .split(/[\s.-]+/)
    .filter((word) => {
      if (word.length === 0) return false
      const folded = word.toLowerCase()
      return !TITLE_WORDS.has(folded) && !NAME_PARTICLES.has(folded)
    })
  if (words.length === 0) return "?"
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ""
  return (first + last).toUpperCase()
}

// --- formatting -----------------------------------------------------------

/**
 * An ISO `YYYY-MM-DD` as a reader's date.
 *
 * `timeZone: "UTC"` is not optional here. The stored dates are calendar days
 * with no time, so `new Date("2026-06-12")` is midnight UTC — rendering that in
 * a browser west of Greenwich moves every date in the app back by one day, and
 * it would do so only for some readers, which is the hardest kind of bug to be
 * told about.
 */
export function formatDate(iso: string, locale: Locale): string {
  const parsed = parseIsoDate(iso)
  if (!parsed) return iso
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed)
}

/** The same, abbreviated — for a table cell or a tooltip, where the full month
 * name costs more width than it earns. */
export function formatDateShort(iso: string, locale: Locale): string {
  const parsed = parseIsoDate(iso)
  if (!parsed) return iso
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed)
}

/** A `YYYY-MM` month, as a heatmap column label. */
export function formatMonth(month: string, locale: Locale): string {
  const parsed = parseIsoDate(`${month}-01`)
  if (!parsed) return month
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(parsed)
}

/**
 * Returns the date an ISO string names, or null if it does not name one.
 *
 * Validated by round-trip rather than by `Number.isNaN(date.getTime())`, because
 * `Date.UTC(2026, 1, 31)` is not NaN — it is the 3rd of March. A source typo of
 * `2026-02-31` would otherwise render as a real date in a different month.
 */
function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  if (date.getUTCDate() !== day) return null
  return date
}

/** A score or a count, grouped the way the reader's locale groups numbers. */
export function formatNumber(value: number, locale: Locale, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** A 0…1 rate as a percentage. `voteParticipationRate` is stored that way; see
 * the note on it in convex/schema.ts for why a 0 needs the caveat beside it. */
export function formatPercent(rate: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(rate)
}
