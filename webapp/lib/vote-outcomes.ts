import type { TranslationKey } from "@/lib/i18n"

/**
 * Reading a ballot's published outcome — its colour, and its English rendering.
 *
 * `voteSheets.result` is DIP's `beschlusstenor`, which is a **string, not an
 * enum** (§3.2 of docs/api-research.md). There is no catalogue endpoint and no
 * published value list, so nothing here may be total: both functions below are
 * routing rules with a default, in the same spirit as `bucketFor` in
 * lib/scoring.ts and `EVENT_TYPE_PATTERNS` in the pipeline's transform.
 *
 * Extracted from components/vote-outcome-badge.tsx so the rules are testable
 * without rendering — the badge is now the caller, not the definition.
 */

// --- tone -----------------------------------------------------------------

/**
 * How a badge should be coloured.
 *
 * `neutral` is a real answer, not a fallback for failure: the sources carry
 * outcomes that are neither a pass nor a rejection — `Überweisung` (referred to
 * committee), `Erledigt`, `Zurückgezogen` — and forcing one of those into green
 * or red would assert something the chamber did not decide.
 */
export type OutcomeTone = "passed" | "rejected" | "pending" | "neutral"

/**
 * The tone for one published outcome.
 *
 * `pending` is tested **first**, before the substring rules, and that ordering
 * matters: an empty result is the absence of a decision, so it must never pick
 * up a colour. (It could not today — the empty string contains no needle — but
 * the rules below are substring matches over free text, and a later addition
 * that happened to match `""` would silently colour every unpublished ballot.)
 *
 * Matching is loose and on the German, because that is what the field contains
 * in both locales. It is only ever used to pick a colour; the wording shown to
 * the reader goes through `outcomeKey`, which is exact.
 */
export function outcomeTone(result: string): OutcomeTone {
  if (result.trim() === "") return "pending"

  const folded = result.toLowerCase()
  // Rejection is tested first because several real tenors name both sides —
  // "Ablehnung der Vorlage" arrives as "… (Annahme der Beschlussempfehlung auf
  // Ablehnung)", where the chamber adopted a recommendation *to reject*.
  if (folded.includes("ablehnung") || folded.includes("abgelehnt")) return "rejected"
  // `zustimmung` is a Bundesrat-facing approval and appears in WP21 on its own;
  // it is a pass by any reading, and was rendering neutral for want of the word.
  if (
    folded.includes("annahme") ||
    folded.includes("angenommen") ||
    folded.includes("zustimmung")
  ) {
    return "passed"
  }
  return "neutral"
}

// --- translation ----------------------------------------------------------

/**
 * Known tenors → their dictionary key.
 *
 * **Exact match, deliberately, where `outcomeTone` is a substring match.** The
 * two answer different questions and can afford different confidence: a colour
 * is a hint, a label is a claim. `Ablehnung der Vorlage in der Ausschussfassung`
 * shares a prefix with `Ablehnung der Vorlage` and means something narrower, so
 * a substring rule would print a translation that drops the qualifier — and the
 * one thing this file must not do is restate a vote's outcome as something the
 * Bundestag did not say.
 *
 * An unlisted tenor is not an error. `outcomeKey` returns null and the caller
 * prints the German verbatim, which is the honest rendering of an outcome no
 * translation has been agreed for. Adding an entry later is additive and needs
 * no migration: the stored value never changes.
 *
 * Typed `Record<string, TranslationKey>`, so an entry naming a key that is not
 * in the dictionary fails `pixi run typecheck` rather than rendering the key.
 */
const OUTCOME_KEYS: Record<string, TranslationKey> = {
  annahme: "votes.outcome.annahme",
  ablehnung: "votes.outcome.ablehnung",
  "annahme der vorlage": "votes.outcome.annahmeDerVorlage",
  "ablehnung der vorlage": "votes.outcome.ablehnungDerVorlage",
  "annahme in ausschussfassung": "votes.outcome.annahmeInAusschussfassung",
  // Both observed in WP21 once the outcomes were first ingested.
  zustimmung: "votes.outcome.zustimmung",
  "ablehnung des änderungsantrags": "votes.outcome.ablehnungDesAenderungsantrags",
  überweisung: "votes.outcome.ueberweisung",
  erledigt: "votes.outcome.erledigt",
  zurückgezogen: "votes.outcome.zurueckgezogen",
}

/** Every tenor this module can translate, for the round-trip test that keeps the
 * German dictionary values identical to the stored strings. */
export const TRANSLATABLE_OUTCOMES = Object.keys(OUTCOME_KEYS)

/**
 * The dictionary key for one published outcome, or null if there is none.
 *
 * Case and internal whitespace are normalised before the lookup — DIP embeds
 * literal line breaks in free-text fields (the pipeline's `clean_text` collapses
 * them at ingest, and this is the same tolerance applied at the far end), so a
 * re-export that changes one space should not silently stop translating.
 *
 * Null means "print the German". It is returned for an empty result too: that
 * case is `pending`, which the badge labels from its own key rather than from
 * an outcome that does not exist.
 */
export function outcomeKey(result: string): TranslationKey | null {
  const normalised = result.trim().split(/\s+/).join(" ").toLowerCase()
  return OUTCOME_KEYS[normalised] ?? null
}
