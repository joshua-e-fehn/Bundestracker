/**
 * Länder: turning a `WKR_LAND` code into a name a reader recognises.
 *
 * `mps.federalState` stores Stammdaten's code verbatim (`NW`, `NDS`, `THÜ`) —
 * see the field comment in convex/schema.ts for why it is not normalised at
 * ingest. That is the right thing to *store* and the wrong thing to *show*: no
 * reader outside the Bundestag's own data team knows that `SWH` is
 * Schleswig-Holstein, and a filter offering "SWH (11)" is a filter nobody uses.
 *
 * This module is the display layer for that column, and nothing else. It is
 * kept apart from lib/bundestag.ts, where `stateOf` lives, because the two
 * answer different questions: `stateOf` answers *which state is this mandate's*
 * — the value a filter compares on — and this answers *what do we call it*.
 * Mixing them is how a label ends up used as a filter key.
 *
 * ## The vocabularies are disjoint in time, which is what makes this possible
 *
 * Measured across the whole dump (4 614 MDBs, 13 046 mandate rows): **35
 * distinct codes for 16 Länder**, and — the load-bearing part — **no code is
 * used in both eras**. WP1–17 write `NRW`/`NDS`/`BWG`/`THÜ`; WP18–21 write
 * `NW`/`NI`/`BW`/`TH`. Nothing overlaps, so one flat table is unambiguous and
 * the mapping needs no Wahlperiode argument to be correct. That is a fact about
 * this source, not a design choice, and it is asserted in lib/laender.test.ts
 * so a future period that reuses an old code fails there rather than silently
 * relabelling a historical mandate.
 *
 * Each code's period range independently matches German constitutional history,
 * which is the strongest evidence available that the table is right:
 *
 *  - `BAD`, `WBB`, `WBH` appear in **WP1 only**; `BWG` appears from **WP2**.
 *    Baden, Württemberg-Baden and Württemberg-Hohenzollern merged into
 *    Baden-Württemberg in 1952, between those two periods.
 *  - `SLD` appears from **WP3**. The Saarland acceded to the Federal Republic
 *    in 1957.
 *  - `BLN`, `BRA`, `MBV`, `SAA`, `SAC`, `THÜ` appear from **WP12**, the first
 *    all-German Bundestag after reunification.
 *
 * ## An unrecognised code is shown as itself
 *
 * The same rule `parties.ts` states for an unknown Fraktion and `mpLabel` for a
 * missing mandate: a value this table does not know is rendered verbatim, never
 * dropped and never coerced. A new code — a future period, or a spelling this
 * table missed — should look like a raw code, which is a visible prompt to add
 * it, rather than vanishing from a dropdown or appearing under some other
 * Land's name. `landNameFor` therefore always returns something printable.
 */

import type { Locale } from "./i18n"

/**
 * Code → name, per locale.
 *
 * A table rather than a function, because there is no rule to apply: these are
 * proper nouns and abbreviations chosen by the Bundestag, not something
 * derivable from the code.
 *
 * **Only the German name differs from the English one where the Land's own name
 * differs in English.** Most do not — `Nordrhein-Westfalen` has an English
 * exonym (`North Rhine-Westphalia`) but `Hessen`, `Bremen` and `Hamburg` do
 * not, so `en` repeats them rather than inventing a translation. Both locales
 * are spelled out in full rather than one falling back to the other: a fallback
 * would make a missing English name invisible, and this is exactly the kind of
 * table where one entry gets forgotten.
 */
const LAND_NAMES: Record<string, Record<Locale, string>> = {
  // --- WP18–21: the ISO-style codes in use today -------------------------
  BW: { de: "Baden-Württemberg", en: "Baden-Württemberg" },
  BY: { de: "Bayern", en: "Bavaria" },
  BE: { de: "Berlin", en: "Berlin" },
  BB: { de: "Brandenburg", en: "Brandenburg" },
  HB: { de: "Bremen", en: "Bremen" },
  HH: { de: "Hamburg", en: "Hamburg" },
  HE: { de: "Hessen", en: "Hesse" },
  MV: { de: "Mecklenburg-Vorpommern", en: "Mecklenburg-Western Pomerania" },
  NI: { de: "Niedersachsen", en: "Lower Saxony" },
  NW: { de: "Nordrhein-Westfalen", en: "North Rhine-Westphalia" },
  RP: { de: "Rheinland-Pfalz", en: "Rhineland-Palatinate" },
  SL: { de: "Saarland", en: "Saarland" },
  SN: { de: "Sachsen", en: "Saxony" },
  ST: { de: "Sachsen-Anhalt", en: "Saxony-Anhalt" },
  SH: { de: "Schleswig-Holstein", en: "Schleswig-Holstein" },
  TH: { de: "Thüringen", en: "Thuringia" },

  // --- WP1–17: the same sixteen Länder under the older codes -------------
  // Deliberately *not* collapsed into the modern codes. A WP12 mandate was won
  // in `NRW` as the source spells it, and rewriting that to `NW` would make the
  // stored value and the displayed one disagree about which period they came
  // from. The name is the same because the Land is the same; the code is not.
  BWG: { de: "Baden-Württemberg", en: "Baden-Württemberg" },
  BAY: { de: "Bayern", en: "Bavaria" },
  BLN: { de: "Berlin", en: "Berlin" },
  BRA: { de: "Brandenburg", en: "Brandenburg" },
  BRE: { de: "Bremen", en: "Bremen" },
  HBG: { de: "Hamburg", en: "Hamburg" },
  HES: { de: "Hessen", en: "Hesse" },
  MBV: { de: "Mecklenburg-Vorpommern", en: "Mecklenburg-Western Pomerania" },
  NDS: { de: "Niedersachsen", en: "Lower Saxony" },
  NRW: { de: "Nordrhein-Westfalen", en: "North Rhine-Westphalia" },
  RPF: { de: "Rheinland-Pfalz", en: "Rhineland-Palatinate" },
  SLD: { de: "Saarland", en: "Saarland" },
  SAC: { de: "Sachsen", en: "Saxony" },
  SAA: { de: "Sachsen-Anhalt", en: "Saxony-Anhalt" },
  SWH: { de: "Schleswig-Holstein", en: "Schleswig-Holstein" },
  THÜ: { de: "Thüringen", en: "Thuringia" },

  // --- WP1 only: the three states that became Baden-Württemberg in 1952 ---
  // Not aliases of `BWG`. These name states that genuinely existed and elected
  // their own members to the first Bundestag, and calling a 1949 Württemberg-
  // Baden mandate "Baden-Württemberg" would assert a Land that did not yet
  // exist. The data agrees: all three appear in WP1 and nowhere else.
  BAD: { de: "Baden", en: "Baden" },
  WBB: { de: "Württemberg-Baden", en: "Württemberg-Baden" },
  WBH: { de: "Württemberg-Hohenzollern", en: "Württemberg-Hohenzollern" },
}

/** Every code this module can name. Exported for the tests, which assert it
 * against the codes actually present in the corpus — the table drifting behind
 * the source is the one failure mode a type cannot catch. */
export const LAND_CODES = Object.keys(LAND_NAMES)

/**
 * The Land a `WKR_LAND` code names, in the reader's language.
 *
 * Returns the code itself for anything unrecognised — see the header. Callers
 * therefore never have to handle a null, which is what keeps a dropdown option
 * from rendering blank.
 *
 * ⚠ Takes the **code**, not a mandate, and returns a *label*. The raw code
 * stays the filter value everywhere: a label is locale-dependent, so filtering
 * on one would make a shared URL mean different things to a German and an
 * English reader, and would break the moment a translation was reworded.
 */
export function landNameFor(code: string, locale: Locale): string {
  return LAND_NAMES[code]?.[locale] ?? code
}

/**
 * The same, for a stored column that may be absent.
 *
 * `null` in, `null` out — the caller decides how to render "the source does not
 * say", because the answer differs by surface: a filter dropdown omits the
 * option entirely, where a profile line might print an em dash. Folding that
 * decision in here would force one of those to be wrong.
 */
export function landNameOrNull(code: string | null | undefined, locale: Locale): string | null {
  const trimmed = code?.trim()
  return trimmed ? landNameFor(trimmed, locale) : null
}
