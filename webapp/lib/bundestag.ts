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
 * Tailwind classes for a Fraktion badge, keyed by folded substrings.
 *
 * Colours are the parties' own, which no official dataset publishes — this is
 * the one place in Bundestrack where a value is not backed by a Bundestag
 * record, and it is a presentation choice rather than a claim about anyone.
 *
 * **Each group carries both spellings, because the sources disagree.** §6.4 is
 * explicit: Stammdaten writes `Fraktion der Christlich Demokratischen
 * Union/Christlich - Sozialen Union` where the vote sheets and DIP write
 * `CDU/CSU`. The abbreviation is *not a substring of the long form* — there is
 * no `cdu` in "Christlich Demokratischen Union" — so matching on the short form
 * alone silently renders every Stammdaten-spelled row in the neutral fallback,
 * which looks like a deliberate choice rather than a miss. The pipeline maps
 * one to the other before writing, but the schema does not enforce that, and a
 * badge is not the place to depend on it.
 *
 * Matched by substring rather than equality, and ordered, because one name can
 * contain another. Two orderings are load-bearing: `alternative für
 * deutschland` must be matched as a phrase rather than on `deutschland`, which
 * the SPD's long form also contains; and BSW is matched on `wagenknecht`
 * rather than `bündnis`, which belongs to the Greens' `BÜNDNIS 90/DIE GRÜNEN`.
 */
const CDU_CSU_STYLE =
  // Black is the CDU/CSU's colour and also the page's text colour, so the badge
  // uses the neutral foreground ramp rather than a literal black that would
  // vanish in dark mode.
  "border-foreground/25 bg-foreground/10 text-foreground"
const SPD_STYLE = "border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300"
const GREEN_STYLE = "border-green-600/30 bg-green-600/15 text-green-700 dark:text-green-300"
const AFD_STYLE = "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300"
const LINKE_STYLE = "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300"
const BSW_STYLE = "border-purple-500/30 bg-purple-500/15 text-purple-700 dark:text-purple-300"
const FDP_STYLE = "border-yellow-500/40 bg-yellow-500/20 text-yellow-800 dark:text-yellow-200"
const SSW_STYLE = "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-300"

const FRAKTION_STYLES: Array<{ match: string; className: string }> = [
  { match: "cdu", className: CDU_CSU_STYLE },
  { match: "csu", className: CDU_CSU_STYLE },
  { match: "christlich demokratischen", className: CDU_CSU_STYLE },
  { match: "christlich-demokratischen", className: CDU_CSU_STYLE },

  { match: "spd", className: SPD_STYLE },
  { match: "sozialdemokratischen", className: SPD_STYLE },

  { match: "grüne", className: GREEN_STYLE },

  // The phrase, not `deutschland` — "Sozialdemokratischen Partei Deutschlands"
  // contains that word too.
  { match: "afd", className: AFD_STYLE },
  { match: "alternative für deutschland", className: AFD_STYLE },

  { match: "linke", className: LINKE_STYLE },

  // `wagenknecht`, not `bündnis`: the Greens' long form opens with BÜNDNIS 90.
  { match: "bsw", className: BSW_STYLE },
  { match: "wagenknecht", className: BSW_STYLE },

  { match: "fdp", className: FDP_STYLE },
  { match: "freien demokratischen", className: FDP_STYLE },

  { match: "ssw", className: SSW_STYLE },
  { match: "südschleswig", className: SSW_STYLE },
]

/** Neutral, for a group with no colour of its own — `fraktionslos`, or a
 * spelling the list above has never seen. Falling through to this is the
 * intended behaviour, not a gap: a group is still legible without its colour,
 * and inventing one would assert a party identity the data does not carry. */
const FRAKTION_FALLBACK = "border-border bg-muted text-muted-foreground"

export function fraktionClassName(fraktion: string): string {
  const folded = fraktion.toLowerCase()
  return (
    FRAKTION_STYLES.find((style) => folded.includes(style.match))?.className ?? FRAKTION_FALLBACK
  )
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
