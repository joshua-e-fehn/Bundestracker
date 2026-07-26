/**
 * Fraktionen: recognising them across sources, and colouring them.
 *
 * ## Why this is not a lookup table
 *
 * The same parliamentary group reaches Bundestrack under several spellings.
 * §6.4 of docs/api-research.md is explicit that an explicit mapping is required:
 * MdB-Stammdaten writes the long legal form (`Fraktion der Christlich
 * Demokratischen Union/Christlich - Sozialen Union`), the named-vote XLSX writes
 * a short form (`CDU/CSU`, `BÜ90/GR`, `Die Linke`, `Fraktionslos`), and DIP
 * writes a third (`BÜNDNIS 90/DIE GRÜNEN`). §5.2 adds a trap of its own: the
 * protocol XML contains `'BÜNDNIS\xa090/ DIE GRÜNEN'` — a non-breaking space and
 * a stray space after the slash — so even an exact-match table over the known
 * spellings misses it.
 *
 * The pipeline normalises what it writes, so `mps.fraktion` should hold the
 * short form. `should` is doing real work in that sentence: the roster is
 * ingested from one source and the ballots from another, `partyAtVote` is
 * deliberately stored as printed rather than as normalised (convex/schema.ts),
 * and six WP21 MPs changed Fraktion mid-period. This module therefore matches
 * defensively rather than trusting the field, and everything that renders a
 * group name goes through it.
 *
 * ## Unknown groups are rendered, not dropped
 *
 * `UNKNOWN_PARTY` is the same decision as `bucketFor`'s `other` bucket in
 * lib/scoring.ts and `mpLabel`'s id fallback in convex/mps.ts: a value the code
 * does not recognise is displayed as itself in a neutral colour, never silently
 * discarded or coerced into a group it does not belong to. A new Fraktion after
 * the next election should look unstyled — a visible prompt to add it — rather
 * than quietly appear in some other party's colours, which is the failure mode
 * nobody notices until it is on a screenshot.
 */

/** The parties Bundestrack knows how to colour. `unknown` is a real member, not
 * an error case — see the header note. */
export const PARTY_KEYS = [
  "cdu-csu",
  "spd",
  "gruene",
  "fdp",
  "afd",
  "linke",
  "fraktionslos",
  "unknown",
] as const

export type PartyKey = (typeof PARTY_KEYS)[number]

export type Party = {
  key: PartyKey
  /** Short label for a badge — what the vote sheets print. */
  label: string
  /** The CSS custom property holding this party's colour, defined for both
   * themes in app/globals.css. A variable rather than a literal so the palette
   * has one home and dark/light can differ. */
  colorVar: string
}

/**
 * Display metadata per party.
 *
 * FDP is here although it holds no seats in WP21 (§9 counts CDU/CSU 209,
 * AfD 152, SPD 122, Grüne 88, Linke 67, fraktionslos 3). It costs one entry, and
 * `backfill --wp 20` loads a Bundestag in which the FDP sat — a historical page
 * rendering it as an unrecognised group would be a bug introduced to save a
 * line.
 */
const PARTIES: Record<PartyKey, Party> = {
  "cdu-csu": { key: "cdu-csu", label: "CDU/CSU", colorVar: "--party-cdu-csu" },
  spd: { key: "spd", label: "SPD", colorVar: "--party-spd" },
  gruene: { key: "gruene", label: "Grüne", colorVar: "--party-gruene" },
  fdp: { key: "fdp", label: "FDP", colorVar: "--party-fdp" },
  afd: { key: "afd", label: "AfD", colorVar: "--party-afd" },
  linke: { key: "linke", label: "Die Linke", colorVar: "--party-linke" },
  fraktionslos: {
    key: "fraktionslos",
    label: "Fraktionslos",
    colorVar: "--party-fraktionslos",
  },
  unknown: { key: "unknown", label: "—", colorVar: "--party-unknown" },
}

/**
 * Folds a Fraktion string to something matchable.
 *
 * The `\s` class covers the `\xa0` §5.2 found in the protocol XML, so the
 * non-breaking space needs no special case — but it is the reason whitespace is
 * collapsed rather than merely trimmed. Punctuation goes too: the long
 * Stammdaten form contains `Christlich - Sozialen` with spaced hyphens, and
 * `BÜNDNIS 90/DIE GRÜNEN` differs from `BÜNDNIS 90/ DIE GRÜNEN` only in a space
 * after the slash.
 *
 * Umlauts are folded as well, because `GRÜNEN` and `GRUENEN` both occur in the
 * wild and lowercasing does not bring them together.
 */
function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\s\-_.]+/g, "")
}

/**
 * Substring tests, in priority order.
 *
 * Ordered rather than a map, and the order carries meaning in two places:
 *
 *  - `csu` and `cdu` are checked before anything else, because the long form
 *    names both unions and either substring alone should reach the same group.
 *  - `linke` before `fraktionslos` would be wrong, and neither before `spd`
 *    matters — but `fraktionslos` must be checked before any party name, since
 *    an MP who left a Fraktion may still be recorded with a string mentioning
 *    the one they left.
 *
 * Substring matching rather than equality is what makes the long Stammdaten
 * form, the DIP form and the XLSX form all land on one key without enumerating
 * every spelling of each.
 */
const MATCHERS: ReadonlyArray<{ key: PartyKey; test: (folded: string) => boolean }> = [
  // First: an MP with no group. Checked ahead of the party names because the
  // source sometimes spells it out relative to a former group.
  { key: "fraktionslos", test: (f) => f.includes("fraktionslos") || f.includes("parteilos") },
  { key: "cdu-csu", test: (f) => f.includes("cdu") || f.includes("csu") || f.includes("union") },
  // "sozialdemokratischen" for the long form; "spd" for the short. Checked
  // after the union so "Christlich - Sozialen" cannot reach it.
  { key: "spd", test: (f) => f.includes("spd") || f.includes("sozialdemokrat") },
  {
    key: "gruene",
    test: (f) => f.includes("gruene") || f.includes("buendnis90") || f.includes("bue90"),
  },
  { key: "linke", test: (f) => f.includes("linke") || f.includes("pds") },
  { key: "afd", test: (f) => f.includes("afd") || f.includes("alternativefuer") },
  // `freie?n?` because the long form is inflected — Stammdaten writes "Fraktion
  // der *Freien* Demokratischen Partei", not "Freie". Matching the uninflected
  // form alone would recognise the short `FDP` and miss the legal name.
  { key: "fdp", test: (f) => f.includes("fdp") || /freien?demokrat/.test(f) },
]

/**
 * The party a Fraktion string denotes.
 *
 * Never throws and never returns null: an unrecognised or empty string yields
 * the `unknown` party, whose label the caller overrides with the raw string so
 * the reader sees what the record actually said. See `partyLabel`.
 */
export function partyFor(fraktion: string | null | undefined): Party {
  if (!fraktion) return PARTIES.unknown
  const folded = fold(fraktion)
  if (!folded) return PARTIES.unknown
  const matched = MATCHERS.find((matcher) => matcher.test(folded))
  return matched ? PARTIES[matched.key] : PARTIES.unknown
}

/**
 * What to print on a badge.
 *
 * A recognised group gets its canonical short form, so one MP does not read
 * `CDU/CSU` and the next `Fraktion der Christlich Demokratischen Union/…`. An
 * unrecognised one gets its own string back, trimmed — showing the raw value is
 * how a missing entry in `MATCHERS` becomes visible instead of everything
 * unfamiliar collapsing into a single anonymous dash.
 */
export function partyLabel(fraktion: string | null | undefined): string {
  const party = partyFor(fraktion)
  if (party.key !== "unknown") return party.label
  const raw = fraktion?.trim()
  return raw && raw.length > 0 ? raw : PARTIES.unknown.label
}

/** The CSS colour expression for a Fraktion, for an inline style. Returns a
 * `var(...)` reference rather than a literal so the value stays themable. */
export function partyColor(fraktion: string | null | undefined): string {
  return `var(${partyFor(fraktion).colorVar})`
}
