import { describe, expect, test } from "bun:test"
import { t } from "./i18n"
import { outcomeKey, outcomeTone, TRANSLATABLE_OUTCOMES } from "./vote-outcomes"

/**
 * The two rules that read a ballot's published outcome.
 *
 * Both can fail silently in the same way: by producing a *plausible* answer for
 * an outcome the sources spell out and this code does not recognise. A tenor
 * coloured green because it happens to contain "Annahme", or translated to
 * "Rejected" because it starts like "Ablehnung der Vorlage", is a claim about a
 * vote that nothing errors on. That is what these tests are for.
 */

describe("outcomeTone", () => {
  test("an unpublished outcome is pending, and never coloured", () => {
    // The pipeline stores `""` between ingesting a ballot and learning its
    // outcome from DIP, so this is the common state, not an edge case.
    expect(outcomeTone("")).toBe("pending")
    expect(outcomeTone("   ")).toBe("pending")
  })

  test("the live WP21 tenors keep the colours they had", () => {
    // Observed on the deployment: these four are what the corpus actually
    // contains, so a refactor that changes any of them is visible here.
    expect(outcomeTone("Ablehnung der Vorlage")).toBe("rejected")
    expect(outcomeTone("Annahme der Vorlage")).toBe("passed")
    expect(outcomeTone("Annahme in Ausschussfassung")).toBe("passed")
    expect(outcomeTone("Überweisung")).toBe("neutral")
  })

  test("an outcome that is neither a pass nor a rejection stays neutral", () => {
    // §3.2: `beschlusstenor` is free text, and the sources carry outcomes that
    // decide nothing either way. Forcing one into green or red would assert
    // something the chamber did not.
    expect(outcomeTone("Erledigt")).toBe("neutral")
    expect(outcomeTone("Zurückgezogen")).toBe("neutral")
    expect(outcomeTone("Kenntnisnahme")).toBe("neutral")
  })

  test("matching is case-insensitive, as the sources are inconsistent", () => {
    expect(outcomeTone("ANGENOMMEN")).toBe("passed")
    expect(outcomeTone("abgelehnt")).toBe("rejected")
  })
})

describe("outcomeKey", () => {
  test("known tenors resolve to a key", () => {
    expect(outcomeKey("Annahme der Vorlage")).toBe("votes.outcome.annahmeDerVorlage")
    expect(outcomeKey("Annahme in Ausschussfassung")).toBe(
      "votes.outcome.annahmeInAusschussfassung",
    )
    expect(outcomeKey("Überweisung")).toBe("votes.outcome.ueberweisung")
  })

  test("case and collapsed whitespace do not break the lookup", () => {
    // DIP embeds literal line breaks in free-text fields; the pipeline collapses
    // them at ingest, and this is the same tolerance applied at the far end.
    expect(outcomeKey("  annahme   der    vorlage ")).toBe("votes.outcome.annahmeDerVorlage")
    expect(outcomeKey("ANNAHME\nDER VORLAGE")).toBe("votes.outcome.annahmeDerVorlage")
  })

  test("an unrecognised tenor has no key, so the German is printed verbatim", () => {
    // The point of the null, not a gap in the map. A closed translation of an
    // open field would round a real outcome to the nearest familiar one.
    expect(outcomeKey("Kenntnisnahme")).toBeNull()
    expect(outcomeKey("Annahme der Beschlussempfehlung auf Kenntnisnahme")).toBeNull()
  })

  test("a longer tenor sharing a prefix is not translated as the shorter one", () => {
    // The reason the lookup is exact where `outcomeTone` is a substring match:
    // this one means something narrower, and "Motion rejected" would drop it.
    expect(outcomeKey("Ablehnung der Vorlage in der Ausschussfassung")).toBeNull()
    // …while still colouring correctly, which is all the loose rule claims.
    expect(outcomeTone("Ablehnung der Vorlage in der Ausschussfassung")).toBe("rejected")
  })

  test("an empty result has no key — pending is labelled from its own", () => {
    expect(outcomeKey("")).toBeNull()
  })
})

describe("the German dictionary values are the stored strings", () => {
  // The load-bearing invariant of this module. `getVoteSheetsPage` builds the
  // /votes result filter by grouping on the *stored* tenor and matching the
  // reader's selection against it exactly (convex/votes.ts), so if a German
  // value here were ever "tidied" — a stray space, a different dash — the badge
  // would render one string while the dropdown selected another, and nothing
  // would error. This is what stops that edit.
  test("t(key, 'de') round-trips to the tenor it was keyed by", () => {
    for (const tenor of TRANSLATABLE_OUTCOMES) {
      const key = outcomeKey(tenor)
      expect(key, tenor).not.toBeNull()
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      expect(t(key!, "de").toLowerCase(), tenor).toBe(tenor)
    }
  })

  test("every known tenor has an English rendering that differs from the German", () => {
    for (const tenor of TRANSLATABLE_OUTCOMES) {
      // biome-ignore lint/style/noNonNullAssertion: covered by the test above
      const key = outcomeKey(tenor)!
      expect(t(key, "en").length, tenor).toBeGreaterThan(0)
      expect(t(key, "en"), tenor).not.toBe(t(key, "de"))
    }
  })
})
