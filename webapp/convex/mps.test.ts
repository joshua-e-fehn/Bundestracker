import { describe, expect, test } from "bun:test"
import type { Validator } from "convex/values"
import { listPeriods, mpDoc, photoFields } from "./mps"
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

  test("the other four enrichment columns stay optional on the way out too", () => {
    // Not an oversight, and asserted so that it reads as a decision rather than
    // as one column having been normalised and the rest forgotten.
    //
    // `photoUrl` is normalised because its consumers are typed `string | null`
    // and rendering a portrait is the one thing that goes visibly wrong. The
    // other four are modelled `?:` all the way out to `MPDoc`
    // (components/mp-profile.tsx) and every use narrows on truthiness, which
    // handles all three states — so widening them here would buy nothing and
    // cost a normalisation pass over every row.
    //
    // The load-bearing part is that this is checked at all: an optional column
    // read back yields `undefined`, so any *new* consumer that declares one of
    // these total in its own `returns` validator 500s the query for exactly the
    // rows the pipeline chose to stay silent about. `photoFields` below is the
    // precedent — it declares `photoCredit` total, which is safe only because
    // its consumers feed it through `mpLabel`.
    for (const column of ["photoCredit", "education", "occupation", "contact"]) {
      expect(isOptional(mpDoc, column)).toBe(true)
    }
  })

  test("photoFields is total, so its consumers must normalise", () => {
    // `photoFields` (mps.ts) declares both columns `v.union(v.null(), …)` with
    // no `v.optional`, and five queries return it. That is a live constraint
    // rather than a style choice: a query spreading a raw `Doc<"mps">` into
    // this validator fails at runtime for any row whose key is absent, with a
    // bare "Server Error" naming neither the field nor the function.
    //
    // The rule that keeps it safe is that every consumer resolves the pair
    // through `mpLabel` (which applies `?? null`) or guards with an explicit
    // `?? null`. This test pins the premise; if `photoFields` ever becomes
    // optional, the guards are redundant and this comment is stale.
    for (const column of ["photoUrl", "photoCredit"]) {
      expect(isOptional(photoFields, column)).toBe(false)
    }
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

/**
 * `federalState` is optional in storage for a *different* reason from the
 * enrichment columns above, and the distinction is worth pinning because the
 * two look identical in the validator.
 *
 * The enrichment columns are optional so the pipeline can **omit** what a run
 * did not resolve — a null there would erase a stored value, which is the
 * 2026-07-29 outage. `federalState` comes from Stammdaten, which every run
 * reads in full, so the pipeline always sends the key and sends `null` when
 * the source is empty. Optional here buys exactly one thing: rows written
 * before the column existed have no key, and a required column would fail
 * `convex deploy` against a populated `mps` table rather than at typecheck.
 *
 * So the three states mean: absent → written by an older pipeline; null → the
 * source states no Land for this mandate (21 of WP21's 635); a string → the
 * code as published. The first two both read as unknown, and a roster re-post
 * converts the first into the second.
 */
describe("the federal state column", () => {
  test("is optional in storage, so a deploy over existing rows succeeds", () => {
    // The backward-compatibility requirement, and the one thing `tsc --noEmit`
    // cannot check: a new *required* field on a populated table is rejected at
    // deploy time by Convex's schema validation, taking every other change in
    // the same push down with it.
    expect(isOptional(mpInput, "federalState")).toBe(true)
  })

  test("is readable, so a query returning it cannot 500 on an older row", () => {
    // `mpDoc` keeps it optional rather than normalising it the way `photoUrl`
    // is. That is safe *because* it is optional: an absent key reads back as
    // `undefined`, and a total validator would reject exactly the rows the
    // pipeline has not rewritten yet — the failure mode `photoFields` above
    // documents, with a bare "Server Error" naming neither field nor function.
    // Every consumer goes through `stateOf` (lib/bundestag.ts), which folds
    // `undefined` and `null` together.
    expect(isOptional(mpDoc, "federalState")).toBe(true)
  })

  test("is a nullable string, not a closed union of sixteen Länder", () => {
    // ⚠ Deliberate. The `WKR_LAND` codes are period-scoped — 35 distinct
    // values across the corpus for 16 Länder, because WP1–17 write `NDS`/`THÜ`
    // where WP18–21 write `NI`/`TH` (§6.2) — and several historical ones name
    // entities that no longer exist (`WBB`, Württemberg-Baden). A literal
    // union would reject a valid historical backfill at ingest, one row at a
    // time, for being correctly spelled.
    const validator = (
      schema.tables.mps.validator as unknown as {
        fields: Record<string, { kind?: string; members?: Array<{ kind?: string }> }>
      }
    ).fields.federalState
    const members = validator.members ?? []
    expect(validator.kind).toBe("union")
    expect(members.map((member) => member.kind).sort()).toEqual(["null", "string"])
  })
})

/**
 * `listPeriods` — the query the period selector is built on.
 *
 * Asserted at the validator level, like everything else in this file, because
 * that is the level where this class of defect lands: a `returns:` validator
 * that omits a field the handler returns **fails the whole query** with a bare
 * "Server Error" naming neither field nor function (convex/schema.ts:210, and
 * the outage `activityEvents.test.ts` records). `tsc --noEmit` does not catch
 * it and `convex deploy` reports "Schema validation complete".
 *
 * That matters more here than for most queries: this one is called by the
 * header chip and by every period-scoped page, so a validator defect takes the
 * whole site's chrome down rather than one route.
 */
describe("listPeriods", () => {
  /**
   * The declared shape of a `query({ returns })`, as the runtime reports it.
   *
   * Convex serialises an object validator's fields as
   * `{ fieldName: { fieldType, optional } }` rather than as the field's own
   * validator — so a field's type is one level deeper than it reads. `field`
   * below is what unwraps it; going without produced assertions that passed on
   * `undefined`.
   */
  function returnsOf(fn: unknown): ExportedValidator {
    const validator = (fn as { exportReturns?: () => string }).exportReturns?.()
    return validator === undefined ? {} : JSON.parse(validator)
  }

  type ExportedValidator = {
    type?: string
    value?: unknown
  }

  /** One field of an exported object validator, unwrapped from its
   * `{ fieldType, optional }` envelope. */
  function field(validator: ExportedValidator, name: string): ExportedValidator {
    const fields = (validator.value ?? {}) as Record<string, { fieldType?: ExportedValidator }>
    return fields[name]?.fieldType ?? {}
  }

  test("declares a return validator at all", () => {
    // Convex allows omitting `returns:`, and an omitted one is the shape that
    // cannot be checked. AGENTS.md's Convex guidance asks for both validators
    // on every function; this is that rule with a test behind it.
    expect(Object.keys(returnsOf(listPeriods)).length).toBeGreaterThan(0)
  })

  test("answers with the periods and which of them is current", () => {
    // The three things the selector needs, in one round-trip. `current` is
    // nullable because a fresh deployment has no roster — which is a state, not
    // a failure, and the UI renders it as "no data" rather than as period zero.
    const returns = returnsOf(listPeriods)
    expect(returns.type).toBe("object")
    expect(Object.keys((returns.value ?? {}) as object).sort()).toEqual(["current", "periods"])
    expect(field(returns, "periods").type).toBe("array")

    const current = field(returns, "current")
    expect(current.type).toBe("union")
    expect((current.value as Array<{ type: string }>).map((member) => member.type).sort()).toEqual([
      "null",
      "number",
    ])
  })

  test("each period carries its size and whether it has been scored", () => {
    // `scored` is the field that separates "backfilled but unswept" from "this
    // chamber did nothing". `docs/historical-coverage.md` records the first as
    // the *normal* state of a fresh backfill — the nightly sweep only touches
    // the current calendar month — so dropping this field would make every
    // newly-loaded period read as an idle parliament.
    const entry = field(returnsOf(listPeriods), "periods").value as ExportedValidator
    expect(entry.type).toBe("object")
    expect(Object.keys((entry.value ?? {}) as object).sort()).toEqual([
      "mandates",
      "scored",
      "wahlperiode",
    ])
  })
})

/**
 * `getMPMandates` — every period one person sat in.
 *
 * Documented in this module as "the profile page's period switcher" since it
 * was written, and called by nothing until now: the audit of 2026-07-29 counted
 * it among 19 public Convex functions with no caller (GAP-012), and
 * `docs/historical-coverage.md` names it specifically as the backend for
 * browsing history that no front end used.
 *
 * `components/mp-profile-scope.tsx` is that front end. The test is here rather
 * than there because the property it needs is a property of the query: the
 * profile's period control offers exactly these rows, so a shape change here is
 * a control offering pages that do not exist.
 */
describe("getMPMandates", () => {
  test("returns full mandate rows, which is what the switcher needs", () => {
    // Not a bare list of period numbers. The "did not sit in this period"
    // screen names the person — "Martin Hohmann held no mandate in WP21" beats
    // an unnamed shrug — and it can only do that because these rows carry
    // `name`. A projection to `number[]` would be smaller and would take that
    // sentence away.
    const declared = new Set(fieldsOf(mpDoc))
    expect(declared.has("wahlperiode")).toBe(true)
    expect(declared.has("name")).toBe(true)
    expect(declared.has("internalId")).toBe(true)
  })
})
