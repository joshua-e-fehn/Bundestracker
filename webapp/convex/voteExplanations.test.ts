import { describe, expect, test } from "bun:test"
import type { Validator } from "convex/values"
import schema, { voteExplanationInput, voteSheetInput } from "./schema"

/**
 * A vote's *subject* and a member's *reason* are different things, and only one
 * of them may ever be written by Bundestrack.
 *
 * `voteSheets.title` is the subject: what the chamber decided. A reason exists
 * for exactly one reader-visible case — §31 GO-BT, under which a member may put
 * on the record why they voted as they did — and DIP publishes it as an
 * activity carrying the member's `person_id`, the procedure it concerns, and a
 * page-anchored link into the protocol PDF. It does **not** publish the prose
 * as a field.
 *
 * So a row here is a pointer plus provenance, and the failure mode this file
 * guards against is a column appearing that could hold generated text. A
 * `reason`, `summary` or `explanation` field would be an invitation to fill it,
 * and a filled one would be Bundestrack asserting a named person's motives on
 * their behalf — the one thing the feature must never do.
 *
 * The second guard is the source string. This repo recorded the activity kind
 * as `Schriftliche Erklärung gem. § 31 GO BT`; DIP returns `§ 31
 * Geschäftsordnung BT`. An exact match against the wrong literal is a filter
 * that silently selects nothing, so the value is stored verbatim rather than
 * assumed, and the pipeline keys on `§ 31` alone.
 */

function fieldsOf(validator: unknown): string[] {
  return Object.keys((validator as { fields: Record<string, Validator<unknown>> }).fields).sort()
}

function indexesOf(table: unknown): Record<string, string[]> {
  const declared = (table as { indexes: { indexDescriptor: string; fields: string[] }[] }).indexes
  return Object.fromEntries(declared.map((index) => [index.indexDescriptor, index.fields]))
}

describe("nothing here can hold a generated reason", () => {
  test("no column invites free text about why a member voted", () => {
    // `subject` is the *procedure's* title, copied from DIP. Everything else is
    // an id, a date, a period or a URL. A column named for the reasoning would
    // be the affordance; there is deliberately none.
    const stored = fieldsOf(schema.tables.voteExplanations.validator)

    for (const forbidden of ["reason", "summary", "explanation", "rationale", "text", "body"]) {
      expect(stored).not.toContain(forbidden)
    }
  })

  test("the only route to the member's words is the official source link", () => {
    // `sourceUrl` is the page-anchored protocol PDF. It is what a reader
    // follows to find out what was actually said, and its presence is what
    // makes storing no prose an honest omission rather than a missing feature.
    expect(Object.keys(voteExplanationInput)).toContain("sourceUrl")
    expect(Object.keys(voteExplanationInput)).toContain("protocolNumber")
  })

  test("the subject is named so it cannot be mistaken for the reason", () => {
    // Deliberately not `title`: `voteSheets` already has one of those, and a
    // shared name is how a ballot's subject ends up rendered as a member's
    // explanation.
    expect(Object.keys(voteExplanationInput)).toContain("subject")
    expect(Object.keys(voteExplanationInput)).not.toContain("title")
    expect(Object.keys(voteSheetInput)).toContain("title")
  })
})

describe("the link to the ballot runs through the procedure", () => {
  test("a declaration carries the Vorgang it concerns", () => {
    // The XLSX vote sheet has no id column at all (§4.1, §7), so a ballot
    // cannot be referenced directly. The declaration names the procedure, and
    // that is the join.
    expect(Object.keys(voteExplanationInput)).toContain("dipVorgangId")
  })

  test("the ballot-side index is scoped by period", () => {
    // A Vorgang id is unique, but the query that reaches it knows the ballot's
    // period and should not read outside it — the same rule every other
    // period-bound index in this schema follows.
    const indexes = indexesOf(schema.tables.voteExplanations)
    expect(indexes.by_wahlperiode_and_dipVorgangId).toEqual(["wahlperiode", "dipVorgangId"])
  })

  test("the DIP activity id is the natural key", () => {
    // DIP emits one record per member per declaration, which is already the
    // grain — so a re-sync is an upsert rather than a second copy.
    expect(indexesOf(schema.tables.voteExplanations).by_dipAktivitaetId).toEqual([
      "dipAktivitaetId",
    ])
  })
})

describe("the activity kind is stored, not assumed", () => {
  test("the column exists so a drifted literal is visible in the data", () => {
    // The string has already been wrong in this repo once. Storing it means a
    // future change to the Bundestag's wording shows up as a value nobody
    // expected rather than as a filter that quietly matches nothing.
    expect(Object.keys(voteExplanationInput)).toContain("aktivitaetsart")
  })
})
