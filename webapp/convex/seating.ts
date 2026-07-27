import { type ObjectType, v } from "convex/values"
// Relative, not "@/lib/...": convex/tsconfig.json defines no path aliases.
import { layoutHemicycle, seatingRank } from "../lib/seating"
import { internalMutation, type MutationCtx, query } from "./_generated/server"
import { assertBatchSize, emptyBatchResult, recordBatch, upsertRow, withId } from "./lib/ingest"
import { findMandate, mpLabel, requireMandate } from "./mps"
import { scoreBreakdown, seatingAssignmentInput } from "./schema"

/**
 * Synthetic hemicycle seating.
 *
 * ## ⚠ These are not real seats
 *
 * §9 is definitive: **no official machine-readable seating data exists** —
 * absent from the DIP spec, the Stammdaten DTD, the protocol XML and its DTD,
 * the bundestag.de plenary pages and Wikidata. Only the *distribution* is
 * derivable, by counting the roster (`getFractionSizes`), so these rows place
 * right-sized blocs in conventional left-to-right order on a standard arc;
 * position within a bloc is arbitrary.
 *
 * The table says `Assignments` and the field `seatLabel`, so this comment is
 * what stops either reading as a claim about the real chamber. The UI must not
 * present a seat as an MP's actual place — app/seating/page.tsx states that to
 * the reader rather than leaving it here.
 *
 * ## Only `generateSeating` is reachable
 *
 * `generateSeating` derives the whole arc from the roster and is the one seating
 * route convex/http.ts exposes (`seating/generate`). The two upserts below take
 * a caller-supplied `(row, column)` and are `internalMutation`s that nothing
 * routes to or calls — so no *reachable* path asserts a seat as real, which is
 * the property that matters, and it is not the same as there being no such
 * function. They are kept as the ingestion-shaped primitives every other module
 * here exposes; if a future route were ever added for them, this header is the
 * thing it would have to contradict first.
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
 * Generates the arc for one period from the roster.
 *
 * The geometry lives in lib/seating.ts, not here — `layoutHemicycle` returns the
 * seats already sorted **left to right across the whole bank**, and this walks
 * the roster in political order through that list. Assigning bloc by bloc down a
 * left-to-right list is what gives each Fraktion a contiguous *wedge* spanning
 * every row, which is how a parliament seats its groups.
 *
 * The obvious alternative — filling row by row, which this function used to do —
 * produces radial bands instead: the largest group takes the innermost rows
 * entirely and the smallest is left as an outer ring. That renders as a
 * perfectly plausible hemicycle while making a different claim about the
 * chamber, which is why the ordering is stated and tested in lib/seating.ts
 * rather than left to a loop here.
 *
 * Sharing that module with the component is also what lets the browser redraw
 * the arc without storing coordinates: both sides lay out the same seat count
 * and match on `(row, column)`. See the note on `layoutHemicycle`.
 *
 * Deterministic: the same roster produces the same arc, so re-running does not
 * shuffle everyone's seat between page loads. Within a bloc, MPs are ordered by
 * surname — arbitrary, as §9 requires it to be, but stable and inspectable,
 * which "arbitrary" alone would not be.
 */
export const generateSeating = internalMutation({
  args: { wahlperiode: v.number() },
  returns: v.object({ seated: v.number(), rows: v.number() }),
  handler: async (ctx, args) => {
    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    const ordered = [...roster].sort(
      (a, b) =>
        seatingRank(a.fraktion) - seatingRank(b.fraktion) ||
        // Two spellings folding to the same party keep a stable order between
        // themselves; `seatingRank` alone would leave them interleaved.
        a.fraktion.localeCompare(b.fraktion, "de") ||
        a.nachname.localeCompare(b.nachname, "de") ||
        a.vorname.localeCompare(b.vorname, "de"),
    )

    const { positions, rows } = layoutHemicycle(ordered.length)
    const now = Date.now()

    for (const [index, mp] of ordered.entries()) {
      const seat = positions[index]
      await upsertOne(
        ctx,
        {
          mpInternalId: mp.internalId,
          wahlperiode: args.wahlperiode,
          seatLabel: `R${seat.row + 1}-S${seat.column + 1}`,
          faction: mp.fraktion,
          row: seat.row,
          column: seat.column,
        },
        now,
      )
    }
    return { seated: ordered.length, rows }
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

/**
 * The whole chamber, with everything the map colours by — one read.
 *
 * The seating page offers five colour modes (party, coalition, activity,
 * attendance, committee work) and a tooltip per seat. Answering those from the
 * client would be 630 seats x four queries; this joins them server-side, in the
 * spirit of `mpLabel` and `getMPsWithScores`.
 *
 * Four reads per seat — the mandate, the period score, the committee count and
 * nothing else — over a 630-seat chamber is ~2 500 documents, comfortably inside
 * Convex's ~16 000-document transaction budget. `getFractionSizes` and
 * `getRankings` bound themselves the same way and for the same reason.
 *
 * ## Every colour input is nullable, and each null means something specific
 *
 * `score` is null when the nightly sweep has not scored that MP, **not** zero: an
 * unscored MP and an inactive one are different claims, and a 0 on a colour ramp
 * asserts the second. The map renders null as a distinct "no data" shade rather
 * than as the bottom of the scale — the same decision `getMPsWithScores` makes
 * for its sortable column.
 *
 * `committeeCount` is 0 rather than null for a real absence, but §6.4 warns that
 * committee membership is published **for the current Wahlperiode only**. So on
 * a historical period every seat reads 0, which is "not published" and not "sat
 * on no committees". The query cannot distinguish them, so the page states the
 * caveat on that mode rather than letting the colours imply an answer.
 *
 * `voteParticipationRate` is likewise 0 when no ballot fell in the period, which
 * the schema's note on `activityScoreInput` requires be read as "no ballots"
 * rather than "never turned up". It rides along inside `score`, so it inherits
 * the null-means-unscored distinction above.
 */
export const getSeatingWithMPs = query({
  args: { wahlperiode: v.number() },
  returns: v.array(
    v.object({
      seat: seatingAssignmentDoc,
      mpInternalId: v.string(),
      name: v.string(),
      /** The MP's group as the *roster* spells it, which is what the colour
       * modes key on. `seat.faction` is what it was when the arc was generated;
       * the two differ for an MP who changed group since (§6.4 records six in
       * WP21), and the roster is the current truth. */
      fraktion: v.string(),
      party: v.string(),
      constituency: v.union(v.null(), v.string()),
      /** `BERUF` from Stammdaten — free text, often absent. Carried so the
       * hover card can say who someone is rather than only how they score;
       * null where the record has none, which the card renders as an omitted
       * line rather than as an empty one. */
      profession: v.union(v.null(), v.string()),
      photoUrl: v.union(v.null(), v.string()),
      score: v.union(
        v.null(),
        v.object({
          totalScore: v.number(),
          voteParticipationRate: v.number(),
          scoreBreakdown,
        }),
      ),
      committeeCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const seats = await ctx.db
      .query("seatingAssignments")
      .withIndex("by_wahlperiode_and_faction", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    const joined = []
    for (const seat of seats) {
      const mp = await findMandate(ctx, seat.mpInternalId, args.wahlperiode)
      const score = await ctx.db
        .query("activityScores")
        .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
          q
            .eq("mpInternalId", seat.mpInternalId)
            .eq("wahlperiode", args.wahlperiode)
            .eq("month", null),
        )
        .unique()
      const committees = await ctx.db
        .query("committeeMemberships")
        .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
          q.eq("mpInternalId", seat.mpInternalId).eq("wahlperiode", args.wahlperiode),
        )
        .collect()

      joined.push({
        seat: toSeatDoc(seat),
        mpInternalId: seat.mpInternalId,
        // Falls back to the id, as `mpLabel` does: a seat whose mandate is
        // missing (§7.3's Stammdaten lag) shows the gap rather than an
        // anonymous dot.
        name: mp?.name ?? seat.mpInternalId,
        fraktion: mp?.fraktion ?? seat.faction,
        party: mp?.party ?? "",
        constituency: mp?.constituency ?? null,
        profession: mp?.profession ?? null,
        photoUrl: mp?.photoUrl ?? null,
        score: score
          ? {
              totalScore: score.totalScore,
              voteParticipationRate: score.voteParticipationRate,
              scoreBreakdown: score.scoreBreakdown,
            }
          : null,
        committeeCount: committees.length,
      })
    }

    // Drawing order, matching `getSeatingAssignments`: row by row, left to
    // right. The component matches each row to a laid-out position by
    // `(row, column)` rather than by array index, so this is for the reader's
    // benefit — a stable DOM order is also the tab order.
    return joined.sort(
      (a, b) =>
        (a.seat.row ?? 0) - (b.seat.row ?? 0) || (a.seat.column ?? 0) - (b.seat.column ?? 0),
    )
  },
})
