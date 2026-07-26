import { type ObjectType, v } from "convex/values"
import { internalMutation, type MutationCtx, query } from "./_generated/server"
import { assertBatchSize, emptyBatchResult, recordBatch, upsertRow, withId } from "./lib/ingest"
import { mpLabel, requireMandate } from "./mps"
import { seatingAssignmentInput } from "./schema"

/**
 * Synthetic hemicycle seating.
 *
 * ## ⚠ These are not real seats
 *
 * §9 of docs/api-research.md is definitive: **no official machine-readable
 * seating data exists** — checked and absent from the DIP spec, the Stammdaten
 * DTD, the protocol XML and its DTD, the bundestag.de plenary pages and
 * Wikidata. Only the seat *distribution* is derivable, by counting the roster
 * (`getFractionSizes` in convex/mps.ts), so these rows place the right-sized
 * blocs in conventional left-to-right order on a standard arc. Which position
 * within a bloc a named MP occupies is arbitrary.
 *
 * The table says `Assignments` and the field says `seatLabel`, so this comment
 * is what stops either reading as a claim about the real chamber. The UI must
 * not present a seat as an MP's actual place, and `generateSeating` is the only
 * writer — there is deliberately no path for a caller to assert a "real" seat,
 * because no source could justify one.
 */

// --- read models ----------------------------------------------------------

const seatingAssignmentDoc = v.object({
  id: v.id("seatingAssignments"),
  ...seatingAssignmentInput,
  createdAt: v.number(),
})

const toSeatDoc = withId<"seatingAssignments">

// --- ingestion ------------------------------------------------------------

async function upsertOne(
  ctx: MutationCtx,
  input: ObjectType<typeof seatingAssignmentInput>,
  now: number,
) {
  await requireMandate(ctx, input.mpInternalId, input.wahlperiode)
  const existing = await ctx.db
    .query("seatingAssignments")
    .withIndex("by_mpInternalId_and_wahlperiode", (q) =>
      q.eq("mpInternalId", input.mpInternalId).eq("wahlperiode", input.wahlperiode),
    )
    .unique()
  return await upsertRow(ctx, "seatingAssignments", existing, input, now)
}

export const upsertSeatingAssignment = internalMutation({
  args: seatingAssignmentInput,
  returns: v.object({ id: v.id("seatingAssignments"), created: v.boolean() }),
  handler: async (ctx, args) => await upsertOne(ctx, args, Date.now()),
})

export const upsertSeatingAssignments = internalMutation({
  args: { assignments: v.array(v.object(seatingAssignmentInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.assignments.length, "assignments")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const assignment of args.assignments) {
      const { created } = await upsertOne(ctx, assignment, now)
      recordBatch(result, created)
    }
    return result
  },
})

/**
 * Conventional left-to-right order of the blocs in the chamber.
 *
 * Political seating order, which is a real convention rather than a property of
 * the data — the Bundestag seats groups along a left-right axis and the
 * hemicycle would be unreadable in alphabetical or size order. Groups not named
 * here follow, by size; `Fraktionslos` members sit at the edges, which is why
 * they are placed last rather than left out.
 */
const FACTION_ORDER = [
  "Die Linke",
  "BÜNDNIS 90/DIE GRÜNEN",
  "SPD",
  "FDP",
  "CDU/CSU",
  "AfD",
  "Fraktionslos",
]

function factionRank(faction: string): number {
  const index = FACTION_ORDER.indexOf(faction)
  return index === -1 ? FACTION_ORDER.length : index
}

/**
 * Generates the arc for one period from the roster.
 *
 * Seats are laid out in concentric rows, each row wider than the last, filled
 * left to right in bloc order — the standard parliament-arc layout §9
 * recommends. Row widths grow linearly, which is what makes the outer rows
 * longer, as in the real chamber.
 *
 * Deterministic: the same roster produces the same arc, so re-running does not
 * shuffle everyone's seat between page loads. Within a bloc, MPs are ordered by
 * surname — arbitrary, but stable and inspectable, which "arbitrary" alone
 * would not be.
 */
export const generateSeating = internalMutation({
  args: { wahlperiode: v.number(), seatsPerFirstRow: v.optional(v.number()) },
  returns: v.object({ seated: v.number(), rows: v.number() }),
  handler: async (ctx, args) => {
    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    const ordered = [...roster].sort(
      (a, b) =>
        factionRank(a.fraktion) - factionRank(b.fraktion) ||
        a.fraktion.localeCompare(b.fraktion, "de") ||
        a.nachname.localeCompare(b.nachname, "de") ||
        a.vorname.localeCompare(b.vorname, "de"),
    )

    const firstRow = Math.max(1, Math.floor(args.seatsPerFirstRow ?? 20))
    const now = Date.now()
    let seated = 0
    let row = 0
    let column = 0
    let rowCapacity = firstRow

    for (const mp of ordered) {
      if (column >= rowCapacity) {
        row++
        column = 0
        // Each row out from the podium is wider — a linear growth is the
        // simplest shape that reads as an arc rather than a grid.
        rowCapacity = firstRow + row * 4
      }
      await upsertOne(
        ctx,
        {
          mpInternalId: mp.internalId,
          wahlperiode: args.wahlperiode,
          seatLabel: `R${row + 1}-S${column + 1}`,
          faction: mp.fraktion,
          row,
          column,
        },
        now,
      )
      seated++
      column++
    }
    return { seated, rows: ordered.length === 0 ? 0 : row + 1 }
  },
})

// --- public queries -------------------------------------------------------

/**
 * The arc for one period, optionally one bloc.
 *
 * Collects rather than pages: a hemicycle is drawn whole or not at all, and 630
 * rows is well inside the read limit. The MP's name and group ride along
 * because the alternative is 630 client queries to label the seats.
 */
export const getSeatingAssignments = query({
  args: { wahlperiode: v.number(), faction: v.optional(v.string()) },
  returns: v.array(
    v.object({
      seat: seatingAssignmentDoc,
      name: v.string(),
      photoUrl: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("seatingAssignments")
      .withIndex("by_wahlperiode_and_faction", (q) => {
        const scoped = q.eq("wahlperiode", args.wahlperiode)
        return args.faction === undefined ? scoped : scoped.eq("faction", args.faction)
      })
      .collect()

    const joined = []
    for (const row of rows) {
      const mp = await mpLabel(ctx, row.mpInternalId, args.wahlperiode)
      joined.push({
        seat: toSeatDoc(row),
        name: mp.name,
        photoUrl: mp.photoUrl,
      })
    }
    // Drawing order: row by row, left to right.
    return joined.sort(
      (a, b) =>
        (a.seat.row ?? 0) - (b.seat.row ?? 0) || (a.seat.column ?? 0) - (b.seat.column ?? 0),
    )
  },
})

export type SeatingAssignmentArgs = ObjectType<typeof seatingAssignmentInput>
