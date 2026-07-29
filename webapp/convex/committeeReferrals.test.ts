import { describe, expect, test } from "bun:test"
import type { Validator } from "convex/values"
import schema, { committeeMembershipInput, committeeReferralInput } from "./schema"

/**
 * Referrals and memberships are different claims, and the whole risk here is
 * that they stop looking like it.
 *
 * A `committeeMemberships` row says *this member sits on this committee*. A
 * `committeeReferrals` row says *this bill was sent to this committee*. The
 * first is about a person, the second is about a document, and only the first
 * can produce a per-MP metric.
 *
 * That distinction is load-bearing because of a specific tempting misreading:
 * §6.4 records that committee **membership** is published for the current
 * Wahlperiode alone, so WP14–20 have none — and `Ueberweisung` *is* available
 * for WP18–21. Someone reaching for the historical committee gap will find
 * referral rows sitting right there. Merging the two tables, or giving
 * referrals a per-MP index, would make a period look as though its membership
 * had been recovered when what was recovered answers a different question.
 *
 * The tests below assert the boundary structurally rather than by convention:
 * a referral row must carry no member, and the table must offer no way to ask
 * for one.
 */

/** An object validator's field names. Convex exposes `.fields` on the runtime
 * validator for both `v.object(...)` and a table's own validator; the casts are
 * because neither surfaces it in its public type. */
function fieldsOf(validator: unknown): string[] {
  return Object.keys((validator as { fields: Record<string, Validator<unknown>> }).fields).sort()
}

/** A table's declared indexes, as `name -> columns`.
 *
 * `indexes` is a property on the table definition rather than a method, and it
 * is not in Convex's public types — hence the cast. */
function indexesOf(table: unknown): Record<string, string[]> {
  const declared = (table as { indexes: { indexDescriptor: string; fields: string[] }[] }).indexes
  return Object.fromEntries(declared.map((index) => [index.indexDescriptor, index.fields]))
}

describe("a referral is about a bill, never about a member", () => {
  test("no referral column names an MP", () => {
    // `mpInternalId` is how every per-person table in this schema references a
    // member. Its absence here is the claim boundary, and adding it would be
    // the first step of the merge this file exists to prevent.
    expect(Object.keys(committeeReferralInput)).not.toContain("mpInternalId")
    expect(fieldsOf(schema.tables.committeeReferrals.validator)).not.toContain("mpInternalId")
  })

  test("no index offers a per-MP read", () => {
    // Not merely "there is no query for it": without an index there is no
    // affordance to write one against, so a future per-MP referral count has
    // to add an index and answer for it rather than falling out of what is
    // already there.
    const indexed = Object.values(indexesOf(schema.tables.committeeReferrals)).flat()
    expect(indexed).not.toContain("mpInternalId")
  })

  test("the two tables share no natural key", () => {
    // If a referral could be keyed the way a membership is, the two would be
    // one table with a nullable member — which is exactly the shape that reads
    // as recovered membership.
    const membership = new Set(Object.keys(committeeMembershipInput))
    const referral = new Set(Object.keys(committeeReferralInput))
    const shared = [...referral].filter((field) => membership.has(field))

    // `committeeName` and `wahlperiode` overlap by necessity — both name a
    // committee in a period. Nothing else may.
    expect(shared.sort()).toEqual(["committeeName", "wahlperiode"])
  })
})

describe("the natural key survives a re-ingest", () => {
  test("a step and a committee together identify a row", () => {
    // A step refers a bill to three or four committees at once, so the step id
    // alone is not unique — keying on it would keep whichever committee was
    // written last, and the lead is not reliably first in the source array.
    const indexes = indexesOf(schema.tables.committeeReferrals)
    expect(indexes.by_dipVorgangspositionId_and_committeeName).toEqual([
      "dipVorgangspositionId",
      "committeeName",
    ])
  })

  test("the period leads the coverage index", () => {
    // Period-scoped in the index rather than filtered after a `.take()`, for
    // the reason `voteSheets` gives: taking N by date and dropping the wrong
    // period returns short pages that read as a quieter parliament.
    const indexes = indexesOf(schema.tables.committeeReferrals)
    expect(indexes.by_wahlperiode_and_committeeName_and_date[0]).toBe("wahlperiode")
  })
})

describe("what the source does not say is not filled in", () => {
  test("the lead flag and the referral type are nullable", () => {
    // `ueberweisungsart` was empty on all 754 referrals sampled across WP14–21
    // and `federfuehrung` can be absent. "Not stated" and "not the lead" are
    // different claims; a non-nullable column would force the transform to
    // pick one and assert it.
    const nullable = (field: unknown) =>
      ((field as { kind?: string; members?: { kind: string }[] }).members ?? []).some(
        (member) => member.kind === "null",
      )

    expect(nullable(committeeReferralInput.leadCommittee)).toBe(true)
    expect(nullable(committeeReferralInput.referralType)).toBe(true)
  })
})
