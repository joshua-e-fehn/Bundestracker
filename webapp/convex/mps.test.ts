import { describe, expect, test } from "bun:test"
import type { Validator } from "convex/values"
import { mpDoc } from "./mps"
import schema, { mpInput } from "./schema"

/**
 * The write shape and the read shape of an `mps` row want opposite things, and
 * getting either backwards has already taken production down once.
 *
 * ## Why the stored column is optional
 *
 * Every ingestion mutation is a `ctx.db.patch` over exactly the keys present
 * (convex/lib/ingest.ts). So for a column fed by a source a given run may not
 * have reached, the three states are not two:
 *
 * | payload | effect on the stored row |
 * |---|---|
 * | `photoUrl: "https://…"` | set it |
 * | `photoUrl: null` | **erase what an earlier run stored** |
 * | key absent | leave it alone |
 *
 * The pipeline used to emit null for "this run resolved no portrait", which is
 * the middle row when it meant the last. Because stage 1 builds its payload
 * from a resolver that holds no enrichment yet, *every* run opened by
 * re-posting the whole roster with those nulls. On 2026-07-29 that took 633
 * stored portraits and 623 contact blocks to zero in a single batch write, and
 * https://www.bundestracker.de/mps rendered initials for all 635 members with
 * no console error and no failing query — the data was simply gone.
 *
 * So `photoUrl` is `v.optional` in `mpInput`, and the pipeline omits what it
 * did not resolve (`pipeline/.../transform.py:mp_payload`).
 *
 * ## Why the read shape is not
 *
 * An optional column read straight back out yields `undefined`, and a
 * `returns:` validator that does not allow it **fails the whole query** with a
 * bare "Server Error" naming neither field nor function — the same class of
 * outage `activityEvents.test.ts` documents. Rather than push a third state
 * meaning exactly what `null` already means out to the eight components that
 * render portraits, `toMpDoc` normalises it and `mpDoc` declares it total.
 *
 * Both halves are asserted here because each is invisible on its own: the
 * write half fails as silent data loss, the read half as a runtime 500, and
 * neither `tsc --noEmit` nor `convex deploy` catches either.
 */

/** The per-field validators of either shape this file compares.
 *
 * `mpInput` is a plain record of validators — it is spread into `v.object(...)`
 * and into `defineTable(...)` rather than being one itself — while `mpDoc` and
 * a table's own validator nest theirs under `.fields`. Normalising here keeps
 * the assertions readable and is why they can name a schema constant and a
 * built validator in the same breath. The casts are because Convex surfaces
 * neither `.fields` nor `.isOptional` in its public types. */
function validatorsOf(validator: unknown): Record<string, { isOptional?: string }> {
  const nested = (validator as { fields?: Record<string, Validator<unknown>> }).fields
  return (nested ?? validator) as Record<string, { isOptional?: string }>
}

/** An object validator's field names. */
function fieldsOf(validator: unknown): string[] {
  return Object.keys(validatorsOf(validator)).sort()
}

/** Whether a validator's field is optional, as the runtime reports it. */
function isOptional(validator: unknown, field: string): boolean {
  return validatorsOf(validator)[field]?.isOptional === "optional"
}

/** The columns written only by the enrich stage, which reads sources a given
 * run may skip: the portrait listing, abgeordnetenwatch, and the biography
 * pages behind a 30-day TTL. Each must be omissible on the way in. */
const ENRICHMENT_COLUMNS = ["photoUrl", "photoCredit", "education", "occupation", "contact"]

describe("the mps write shape", () => {
  test("every enrichment column is optional, so a run can omit what it lacks", () => {
    // The fix for the 2026-07-29 blanking. A required column here forces the
    // pipeline to send *something* for an MP it could not enrich, and the only
    // something available is null — which erases the stored value.
    for (const column of ENRICHMENT_COLUMNS) {
      expect(isOptional(mpInput, column)).toBe(true)
    }
  })

  test("the Stammdaten columns stay required", () => {
    // The other half of the rule, and the reason this is not "make everything
    // optional": Stammdaten is re-read in full on every run, so these are
    // always present and always authoritative. Making them omissible would
    // turn a genuinely dropped field into a row that silently keeps a stale
    // value, which is the failure `transform.py`'s convention #1 exists to
    // prevent.
    for (const column of ["internalId", "name", "fraktion", "party", "wahlperiode"]) {
      expect(isOptional(mpInput, column)).toBe(false)
    }
  })
})

describe("the mps read shape", () => {
  test("mpDoc describes every stored field", () => {
    // Structural, not a field list: any column added to the table but not to
    // this read model 500s `getMP`, `getMPs` and `getMPMandates` at runtime
    // only. The next such column fails here instead of in front of readers.
    const stored = fieldsOf(schema.tables.mps.validator)
    const declared = new Set(fieldsOf(mpDoc))
    expect(stored.filter((field) => !declared.has(field))).toEqual([])
  })

  test("photoUrl is total on the way out even though it is optional on the way in", () => {
    // The asymmetry itself. If a refactor "tidies" this by spreading mpInput
    // unchanged, every consumer silently gains an `undefined` case: MPPhoto
    // tolerates it, but the eight callers typed `string | null` do not, and
    // `getMPs` would start rejecting its own response for un-enriched rows.
    expect(isOptional(mpInput, "photoUrl")).toBe(true)
    expect(isOptional(mpDoc, "photoUrl")).toBe(false)
  })

  test("the schema is the source of truth this is checked against", () => {
    // Guards the helpers rather than the validators: if a Convex upgrade moved
    // `.fields` or renamed `isOptional`, every assertion above would pass while
    // checking nothing at all.
    expect(fieldsOf(schema.tables.mps.validator)).toContain("photoUrl")
    expect(fieldsOf(mpInput)).toContain("photoUrl")
    expect(fieldsOf(mpDoc).length).toBeGreaterThan(5)
  })
})
