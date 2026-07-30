import { describe, expect, test } from "bun:test"
import { getCommitteeMembers, getCommittees, getCommitteesByMP } from "./committees"

/**
 * Structural guards on the three public committee queries.
 *
 * ## What this file pins
 *
 * The failure class every test here is aimed at is the one
 * `convex/mps.test.ts` documents at length: a `returns:` validator that omits
 * a field the handler returns **fails the whole query** with a bare "Server
 * Error" that names neither field nor function, and neither `tsc --noEmit`
 * nor `bunx convex deploy` catches it. `activityEvents.test.ts` records the
 * outage the pattern exists to prevent.
 *
 * The three public queries here are load-bearing for the new
 * `/committees` and `/committees/[id]` routes. `getCommittees` also drives
 * the directory list on the current-period page; `getCommitteeMembers` is
 * the sole reader of the committee detail; `getCommitteesByMP` is the MP
 * profile's card. A defect in any of the three takes one of those pages
 * down and shows the reader an empty state that is a lie about the data.
 *
 * ## What this does NOT test
 *
 * Handler behaviour — the reduction over rows, the sort order, the empty
 * case — is exercised in `lib/committees.test.ts`, where the pure
 * `summarizeCommittees` helper is unit-testable without a Convex runtime.
 * The queries are tested here only at the validator level; the rest is
 * split into `lib/committees.ts` for exactly this reason.
 */

/**
 * The declared shape of a `query({ returns })`, as the runtime reports it.
 *
 * Copied verbatim from `mps.test.ts:245-260` so the two files answer the
 * same question the same way. Convex serialises an object validator's
 * fields as `{ fieldName: { fieldType, optional } }`, so a field's type is
 * one level deeper than it reads.
 */
type ExportedValidator = {
  type?: string
  value?: unknown
}

function returnsOf(fn: unknown): ExportedValidator {
  const validator = (fn as { exportReturns?: () => string }).exportReturns?.()
  return validator === undefined ? {} : JSON.parse(validator)
}

function argsOf(fn: unknown): ExportedValidator {
  const validator = (fn as { exportArgs?: () => string }).exportArgs?.()
  return validator === undefined ? {} : JSON.parse(validator)
}

function field(validator: ExportedValidator, name: string): ExportedValidator {
  const fields = (validator.value ?? {}) as Record<string, { fieldType?: ExportedValidator }>
  return fields[name]?.fieldType ?? {}
}

function fieldNames(validator: ExportedValidator): string[] {
  return Object.keys((validator.value ?? {}) as object).sort()
}

describe("getCommittees", () => {
  test("declares an args validator on wahlperiode", () => {
    // A missing args validator would let a bogus `wahlperiode` reach the
    // index scan — `.eq("wahlperiode", undefined)` returns nothing, so the
    // directory would silently render as empty for the caller.
    const args = argsOf(getCommittees)
    expect(fieldNames(args)).toEqual(["wahlperiode"])
    expect(field(args, "wahlperiode").type).toBe("number")
  })

  test("declares a returns validator, so a schema drift 500s here", () => {
    // The whole point of this file. See the header, and mps.test.ts's
    // extended note.
    const returns = returnsOf(getCommittees)
    expect(returns.type).toBe("array")
  })

  test("each row carries committeeName and memberCount, both required", () => {
    // The two fields the UI reads. `committeeName` is the URL segment the
    // detail page joins on; `memberCount` is the seat count the row prints.
    // A validator that dropped either would render the directory blank.
    const returns = returnsOf(getCommittees)
    const row = returns.value as ExportedValidator
    expect(row.type).toBe("object")
    expect(fieldNames(row)).toEqual(["committeeName", "memberCount"])
    expect(field(row, "committeeName").type).toBe("string")
    expect(field(row, "memberCount").type).toBe("number")
  })
})

describe("getCommitteeMembers", () => {
  test("declares args on wahlperiode and committeeName", () => {
    const args = argsOf(getCommitteeMembers)
    expect(fieldNames(args)).toEqual(["committeeName", "wahlperiode"])
    expect(field(args, "wahlperiode").type).toBe("number")
    expect(field(args, "committeeName").type).toBe("string")
  })

  test("declares a returns validator", () => {
    const returns = returnsOf(getCommitteeMembers)
    expect(returns.type).toBe("array")
  })

  test("each member carries mpInternalId, name, fraktion — and role, which is nullable", () => {
    // `mpInternalId` is what the profile link joins on. `name` is what the
    // reader sees. `fraktion` reaches `PartyBadge` to be folded into a
    // party colour. `role` must be a nullable string — the source writes
    // no role for a plain member, and the UI needs to distinguish "no role
    // recorded" from "Ordentliches Mitglied" (which is *also* what the
    // source writes when it wants to say full member).
    const returns = returnsOf(getCommitteeMembers)
    const row = returns.value as ExportedValidator
    expect(row.type).toBe("object")
    expect(fieldNames(row)).toEqual(["fraktion", "mpInternalId", "name", "role"])
    expect(field(row, "mpInternalId").type).toBe("string")
    expect(field(row, "name").type).toBe("string")
    expect(field(row, "fraktion").type).toBe("string")

    const role = field(row, "role")
    expect(role.type).toBe("union")
    expect((role.value as Array<{ type: string }>).map((m) => m.type).sort()).toEqual([
      "null",
      "string",
    ])
  })
})

describe("getCommitteesByMP", () => {
  test("declares args on mpInternalId and wahlperiode", () => {
    const args = argsOf(getCommitteesByMP)
    expect(fieldNames(args)).toEqual(["mpInternalId", "wahlperiode"])
  })

  test("declares a returns validator", () => {
    // The MP profile card reads this — a missing `returns` here would
    // 500 the profile query on the committees card the moment the schema
    // shifts.
    const returns = returnsOf(getCommitteesByMP)
    expect(returns.type).toBe("array")
  })
})
