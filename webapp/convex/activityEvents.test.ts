import { describe, expect, test } from "bun:test"
import type { Validator } from "convex/values"
import { activityEventDoc } from "./activityEvents"
import { feedItem } from "./feed"
import schema from "./schema"

/**
 * A read validator must describe every field the handler actually returns.
 *
 * `withId` (convex/lib/ingest.ts) returns the whole stored document minus
 * Convex's system fields. A `returns` validator that omits one of those fields
 * does not quietly drop it — it **fails the query**, and the browser gets a bare
 * "Server Error" naming neither the field nor the function:
 *
 * ```
 * [CONVEX Q(activityEvents:getChamberFeed)] [Request ID: …] Server Error
 * ```
 *
 * That is the outage this file exists for. `activityEventInput` deliberately
 * excludes `searchText`, because the field is derived on write and never posted
 * (convex/schema.ts). Both read validators were built by spreading that
 * *ingestion* shape, so the moment `withSearchText` began stamping the field
 * every row carried something the validators did not describe — and
 * `getActivityFeed`, `getChamberFeed` and `feed.getFeed` all 500ed in
 * production, for every Wahlperiode, until 2026-07-29.
 *
 * ## Why this is asserted against the schema, not a field list
 *
 * A test naming `searchText` would have caught this bug and nothing after it.
 * The failure is structural: *any* column added to `activityEvents` but not to
 * `activityEventInput` reproduces it exactly, silently, at runtime only —
 * neither `tsc --noEmit` nor `convex deploy` catches it, since the deploy
 * validates stored rows against the schema and both agree. So the assertion
 * reads the schema itself and demands the read models keep up. The next such
 * column fails here instead of in front of readers.
 */

/** An object validator's field names. Convex exposes `.fields` on the runtime
 * validator object for both `v.object(...)` and a table's own validator; the
 * casts are because neither surfaces it in its public type. */
function fieldsOf(validator: unknown): string[] {
  return Object.keys((validator as { fields: Record<string, Validator<unknown>> }).fields).sort()
}

/** The fields a stored `activityEvents` row has, according to the schema. */
function storedFields(): string[] {
  return fieldsOf(schema.tables.activityEvents.validator)
}

/** Stored fields the read validator fails to declare. Empty is the only
 * acceptable answer; anything in it is a query that 500s on every call. */
function undeclared(readValidator: unknown): string[] {
  const declared = new Set(fieldsOf(readValidator))
  return storedFields().filter((field) => !declared.has(field))
}

describe("activityEvents read validators", () => {
  test("the schema is the source of truth this is checked against", () => {
    // Guards the two helpers above rather than the validators: if a Convex
    // upgrade moved `.fields`, `undeclared()` would return `[]` for everything
    // and the two tests below would pass while checking nothing.
    expect(storedFields()).toContain("searchText")
    expect(storedFields().length).toBeGreaterThan(5)
  })

  test("activityEventDoc describes every stored field", () => {
    // The validator behind getChamberFeed and getActivityFeed.
    expect(undeclared(activityEventDoc)).toEqual([])
  })

  test("the feed row describes every stored field", () => {
    // The validator behind feed.getFeed, which joins the roster onto the same
    // stored document and so inherits the same obligation.
    expect(undeclared(feedItem)).toEqual([])
  })

  test("searchText specifically is declared, in both", () => {
    // Named on its own because it is the field that actually broke, and the one
    // a future refactor is likeliest to drop again: it is the only stored field
    // no reader renders, so nothing on screen goes missing when it is removed —
    // the query simply stops answering.
    expect(fieldsOf(activityEventDoc)).toContain("searchText")
    expect(fieldsOf(feedItem)).toContain("searchText")
  })
})
