import { v } from "convex/values"
import { computeScore, DEFAULT_WEIGHTS } from "../lib/scoring"
import { EVENT_TYPES } from "../lib/taxonomy"
import { internalMutation } from "./_generated/server"

/**
 * Synthetic data for a local deployment.
 *
 * ⚠ **Development only.** Nothing here is a Bundestag record, and every figure
 * it writes is invented — which is precisely the thing Bundestrack promises
 * never to display. It is an `internalMutation`, so no browser can reach it,
 * and it refuses to run against a deployment that already holds ingested rows
 * (see `assertEmpty`) so it cannot overwrite real data.
 *
 * It exists because the rankings and feed pages cannot be verified without
 * data, and the real pipeline needs a Bundestag API key and hours of sequential
 * fetching behind a WAF that IP-blocks on concurrency (§2.6). Running the
 * pages against an empty database only ever exercises the empty states.
 *
 * Deterministic: a fixed seed, so two runs produce the same chamber and a
 * screenshot is reproducible. `Math.random()` would make every run a different
 * leaderboard and defeat the purpose.
 */

/** Mulberry32 — small, fast, and deterministic from an integer seed. */
function rng(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FRAKTIONEN = [
  { fraktion: "CDU/CSU", party: "CDU", seats: 40 },
  { fraktion: "AfD", party: "AfD", seats: 28 },
  { fraktion: "SPD", party: "SPD", seats: 24 },
  { fraktion: "BÜNDNIS 90/DIE GRÜNEN", party: "GRÜNE", seats: 18 },
  { fraktion: "Die Linke", party: "DIE LINKE", seats: 13 },
  { fraktion: "Fraktionslos", party: "fraktionslos", seats: 2 },
]

/** WP21's own `WKR_LAND` codes, so the seeded state filter offers what a real
 * roster would. Not all sixteen: the point of a seed is the distribution, and
 * the smallest Länder send a handful of members each. */
const STATES = ["BW", "BY", "BE", "HE", "NW", "NI", "SN", "SH"]
const FORENAMES = [
  "Anna",
  "Jonas",
  "Mehmet",
  "Katrin",
  "Lukas",
  "Fatima",
  "Stefan",
  "Julia",
  "Hendrik",
  "Aylin",
  "Markus",
  "Sabine",
  "Tobias",
  "Nadia",
  "Christoph",
  "Elena",
]
const SURNAMES = [
  "Bauer",
  "Schneider",
  "Yilmaz",
  "Hoffmann",
  "Weber",
  "Nowak",
  "Krüger",
  "Lange",
  "Fischer",
  "Özdemir",
  "Klein",
  "Wolf",
  "Richter",
  "Sommer",
  "Zimmermann",
  "Brandt",
]

const WAHLPERIODE = 21
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07"]

export const seedDev = internalMutation({
  args: { force: v.optional(v.boolean()) },
  returns: v.object({
    mps: v.number(),
    scores: v.number(),
    events: v.number(),
    ballots: v.number(),
    /** Rows written to `voteExplanations` — the input the §31 disclosure on
     * the vote detail page reads. Zero when the roster was too small. */
    explanations: v.number(),
    /** Rows written to `motions` — enough for `/motions` to show the referrals
     * disclosure against both "with referrals" and "without" rows. */
    motions: v.number(),
    /** Rows written to `committeeReferrals`. */
    referrals: v.number(),
  }),
  handler: async (ctx, args) => {
    // Refuses to touch a deployment that already holds data, unless told
    // explicitly. Synthetic figures landing on top of ingested ones would be
    // indistinguishable from them afterwards — the one failure mode that
    // matters for a tool that writes invented numbers.
    const existing = await ctx.db.query("mps").first()
    if (existing && args.force !== true) {
      throw new Error(
        "Deployment already holds MPs. seedDev writes synthetic data and refuses " +
          "to run over real rows; pass force: true only on a throwaway deployment.",
      )
    }

    const random = rng(20260726)
    const now = Date.now()

    // --- roster ---
    const roster: { internalId: string; fraktion: string }[] = []
    let index = 0
    for (const group of FRAKTIONEN) {
      for (let seat = 0; seat < group.seats; seat++) {
        const internalId = `bt-${String(index + 1).padStart(4, "0")}`
        const vorname = FORENAMES[index % FORENAMES.length]
        const nachname = SURNAMES[(index * 7) % SURNAMES.length]
        const state = STATES[index % STATES.length]
        // Ages spread across every bracket so the age filter has something to
        // select in each.
        const birthYear = 1948 + Math.floor(random() * 55)
        await ctx.db.insert("mps", {
          internalId,
          stammdatenId: `1100${String(4000 + index)}`,
          dipPersonId: String(1000 + index),
          name: `${vorname} ${nachname}`,
          vorname,
          nachname,
          ortsZusatz: null,
          praefix: null,
          party: group.party,
          fraktion: group.fraktion,
          constituency: index % 3 === 0 ? null : `Wahlkreis ${index + 1}`,
          // Stammdaten's own shape, which is not "list MP ⇒ no state": most
          // list members do carry a `WKR_LAND`, and only those with no
          // constituency block at all leave it empty — 21 of WP21's 635. Every
          // ninth row here is that case, so the seeded roster exercises the
          // unknown arm of the filter rather than only the populated one.
          federalState: index % 9 === 0 ? null : state,
          wahlperiode: WAHLPERIODE,
          bio: null,
          photoUrl: null,
          photoCredit: null,
          birthDate: `${birthYear}-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-14`,
          education: null,
          profession: null,
          occupation: null,
          contact: null,
          electionMethod: index % 3 === 0 ? "Landesliste" : "Direktwahl",
          datesInOffice: { start: "2025-03-25", end: null },
          createdAt: now,
          updatedAt: now,
        })
        roster.push({ internalId, fraktion: group.fraktion })
        index++
      }
    }

    // --- scores: one row per (MP, month) plus the period total ---
    let scores = 0
    for (const mp of roster) {
      const perMonth = MONTHS.map(() => ({
        motions: Math.floor(random() * 6),
        speeches: Math.floor(random() * 4000),
        questions: Math.floor(random() * 9),
        reports: Math.floor(random() * 3),
        voteParticipation: 0.6 + random() * 0.4,
        committees: Math.floor(random() * 4),
        billSponsorships: Math.floor(random() * 4),
      }))

      for (const [monthIndex, month] of MONTHS.entries()) {
        const inputs = perMonth[monthIndex]
        const { totalScore, breakdown } = computeScore(inputs, DEFAULT_WEIGHTS)
        await ctx.db.insert("activityScores", {
          mpInternalId: mp.internalId,
          wahlperiode: WAHLPERIODE,
          month,
          motionCount: inputs.motions,
          speechCount: Math.ceil(inputs.speeches / 500),
          speechWordCount: inputs.speeches,
          questionCount: inputs.questions,
          reportCount: inputs.reports,
          voteParticipationRate: inputs.voteParticipation,
          committeeCount: inputs.committees,
          billSponsorshipCount: inputs.billSponsorships,
          totalScore,
          scoreBreakdown: breakdown,
          createdAt: now,
          updatedAt: now,
        })
        scores++
      }

      // The period total: the months summed, except participation, which is a
      // rate and averages rather than adds.
      const total = perMonth.reduce(
        (acc, month) => ({
          motions: acc.motions + month.motions,
          speeches: acc.speeches + month.speeches,
          questions: acc.questions + month.questions,
          reports: acc.reports + month.reports,
          voteParticipation: acc.voteParticipation + month.voteParticipation / MONTHS.length,
          committees: Math.max(acc.committees, month.committees),
          billSponsorships: acc.billSponsorships + month.billSponsorships,
        }),
        {
          motions: 0,
          speeches: 0,
          questions: 0,
          reports: 0,
          voteParticipation: 0,
          committees: 0,
          billSponsorships: 0,
        },
      )
      const { totalScore, breakdown } = computeScore(total, DEFAULT_WEIGHTS)
      await ctx.db.insert("activityScores", {
        mpInternalId: mp.internalId,
        wahlperiode: WAHLPERIODE,
        month: null,
        motionCount: total.motions,
        speechCount: Math.ceil(total.speeches / 500),
        speechWordCount: total.speeches,
        questionCount: total.questions,
        reportCount: total.reports,
        voteParticipationRate: total.voteParticipation,
        committeeCount: total.committees,
        billSponsorshipCount: total.billSponsorships,
        totalScore,
        scoreBreakdown: breakdown,
        createdAt: now,
        updatedAt: now,
      })
      scores++
    }

    // --- ballots, so the cross-party board has something to compute over ---
    //
    // Six synthetic sheets: half linked to a synthetic DIP Vorgang, half
    // unlinked. The linked ones are the input the §31 disclosure needs to
    // exercise its populated arm; the unlinked ones exercise the "linkage
    // missing" arm, which is the third state `voteSheets.dipVorgangId`
    // stores (schema note). Without at least one of each, the disclosure's
    // three branches — populated, empty, unlinked — cannot all be seen on a
    // local dashboard run.
    let ballots = 0
    let linkedSheetVorgangId: string | null = null
    for (let sitting = 1; sitting <= 6; sitting++) {
      const sheetDate = `2026-07-${String(sitting * 3).padStart(2, "0")}`
      // Every other sheet is linked. `seed-vorgang-` prefix keeps the id
      // recognisably synthetic — a real DIP id is a bare integer.
      const isLinked = sitting % 2 === 1
      const dipVorgangId = isLinked ? `seed-vorgang-${sitting}` : null
      const sheetId = await ctx.db.insert("voteSheets", {
        wahlperiode: WAHLPERIODE,
        sitzungnr: 80 + sitting,
        abstimmnr: 1,
        title: `Namentliche Abstimmung ${sitting} (Testdaten)`,
        date: sheetDate,
        result: "Annahme der Vorlage",
        yesCount: 0,
        noCount: 0,
        abstainCount: 0,
        invalidCount: 0,
        absentCount: 0,
        totalEligible: roster.length,
        sourceUrl: null,
        dipVorgangId,
        createdAt: now,
      })
      if (linkedSheetVorgangId === null && dipVorgangId !== null) {
        // Remember the first linked sheet's Vorgang so the §31 rows below
        // attach to a real page a reader can navigate to.
        linkedSheetVorgangId = dipVorgangId
      }
      for (const mp of roster) {
        // Most members follow the group line; a small share defect, so the
        // cross-party board is not uniformly zero.
        const roll = random()
        const vote = roll < 0.06 ? "no" : roll < 0.1 ? "abstain" : roll < 0.16 ? "absent" : "yes"
        await ctx.db.insert("voteRecords", {
          mpInternalId: mp.internalId,
          voteSheetId: sheetId,
          vote,
          partyAtVote: mp.fraktion,
          remark: null,
          // The ballot's period and date, as `upsertVoteRecords` writes them.
          // Omitting them would seed rows that are invisible to every
          // period-scoped read — a local deployment where votes silently do not
          // count, which reads as a bug in the query rather than in the seed.
          wahlperiode: WAHLPERIODE,
          date: sheetDate,
          createdAt: now,
        })
      }
      ballots++
    }

    // --- §31 declarations against the first linked ballot -----------------
    //
    // Two rows so the disclosure has more than a single-item edge case, and
    // both attributed to synthetic MPs so the per-MP traversal in
    // convex/purgeSeed.ts reaches them (an added reader there covers the
    // voteExplanations table). Deliberately attached to only *one* of the
    // linked ballots — the other linked sheets exercise the "linked, none
    // filed" state so the disclosure's `emptyNoneFiled` arm is visible on a
    // dashboard.
    let explanations = 0
    if (linkedSheetVorgangId !== null && roster.length >= 2) {
      for (const [index, mp] of roster.slice(0, 2).entries()) {
        await ctx.db.insert("voteExplanations", {
          // The natural key. `seed-erklärung-` prefix keeps it recognisably
          // synthetic; DIP's activity ids are bare integers.
          dipAktivitaetId: `seed-erklaerung-${index + 1}`,
          mpInternalId: mp.internalId,
          dipVorgangId: linkedSheetVorgangId,
          // The referenced procedure's *title*, not a reason — schema note
          // on `voteExplanations.subject` is explicit that this is what was
          // voted on, not why. Any wording that read as an explanation
          // would defeat the point of storing it separately from `title`.
          subject: `Testdaten: Vorgangstitel ${linkedSheetVorgangId}`,
          aktivitaetsart: "Schriftliche Erklärung gem. § 31 Geschäftsordnung BT",
          // A stub protocol-page URL — a synthetic seed cannot link to the
          // real one, and inventing a plausible bundestag.de URL would land
          // a broken external link on a page that will render for other
          // developers. `null` says "no source available" honestly.
          sourceUrl: null,
          protocolNumber: `${WAHLPERIODE}/${80 + index}`,
          date: `2026-07-${String(3 + index).padStart(2, "0")}`,
          wahlperiode: WAHLPERIODE,
          createdAt: now,
        })
        explanations++
      }
    }

    // --- motions + committee referrals -----------------------------------
    //
    // Three motions so the /motions page has both "with referral" and
    // "without" rows to render. Referrals are attached to one of them,
    // leaving two rows for the `emptyNoReferral` arm of the disclosure.
    // Every motion carries a `dipVorgangId` — the referrals query is keyed
    // on it and the disclosure's unlinked arm is exercised by the
    // Drucksache-only path in `seed-local.ts` instead.
    //
    // ⚠ Neither `motions` nor `committeeReferrals` names an MP, so
    // `purgeSeedData`'s per-MP traversal does not reach them. The seed
    // Vorgang ids therefore carry a `seed-motion-` prefix that
    // `convex/purgeSeed.ts` uses to identify them from the motion/referral
    // side, matching the same shape as the `bt-` mandate prefix.
    const motionSeeds = [
      {
        vorgang: "seed-motion-1",
        title: "Testdaten: Entwurf eines Gesetzes zur Digitalisierung der Verwaltung",
        vorgangstyp: "Gesetzgebung",
        withReferrals: true,
      },
      {
        vorgang: "seed-motion-2",
        title: "Testdaten: Antrag zu Klimaschutzmaßnahmen",
        vorgangstyp: "Antrag",
        withReferrals: false,
      },
      {
        vorgang: "seed-motion-3",
        title: "Testdaten: Kleine Anfrage zur Bahninfrastruktur",
        vorgangstyp: "Kleine Anfrage",
        withReferrals: false,
      },
    ]
    let motions = 0
    for (const [index, seed] of motionSeeds.entries()) {
      await ctx.db.insert("motions", {
        dipVorgangId: seed.vorgang,
        dipDrucksacheId: null,
        drucksacheNr: `${WAHLPERIODE}/${9000 + index}`,
        title: seed.title,
        type: "Gesetzentwurf",
        date: `2026-07-${String(1 + index * 2).padStart(2, "0")}`,
        wahlperiode: WAHLPERIODE,
        vorgangstyp: seed.vorgangstyp,
        createdAt: now,
      })
      motions++
    }

    let referrals = 0
    const REFERRAL_COMMITTEES = [
      { name: "Ausschuss für Digitales", abbrev: "AfD-Aus", lead: true },
      { name: "Innenausschuss", abbrev: "InnAus", lead: false },
      { name: "Rechtsausschuss", abbrev: "RAus", lead: false },
    ]
    for (const seed of motionSeeds) {
      if (!seed.withReferrals) continue
      for (const [index, committee] of REFERRAL_COMMITTEES.entries()) {
        await ctx.db.insert("committeeReferrals", {
          dipVorgangspositionId: `seed-position-${seed.vorgang}-${index}`,
          dipVorgangId: seed.vorgang,
          committeeName: committee.name,
          committeeAbbreviation: committee.abbrev,
          leadCommittee: committee.lead,
          // `ueberweisungsart` is empty on every referral sampled from DIP,
          // so `null` here matches the real distribution rather than
          // inventing a value.
          referralType: null,
          positionKind: "Überweisung",
          documentNumber: `${WAHLPERIODE}/9000`,
          title: seed.title,
          date: "2026-07-01",
          wahlperiode: WAHLPERIODE,
          createdAt: now,
        })
        referrals++
      }
    }

    // --- feed events ---
    let events = 0
    for (let day = 1; day <= 28; day++) {
      for (let slot = 0; slot < 8; slot++) {
        const mp = roster[Math.floor(random() * roster.length)]
        const kind = EVENT_TYPES[Math.floor(random() * EVENT_TYPES.length)]
        const paper = 7000 + events
        await ctx.db.insert("activityEvents", {
          mpInternalId: mp.internalId,
          eventType: kind,
          date: `2026-07-${String(day).padStart(2, "0")}`,
          title: `Testdaten: ${kind} vom ${day}.07.2026`,
          description: "Synthetischer Eintrag aus seedDev — kein Bundestagsdokument.",
          // Both reconstructible reference shapes appear, so the feed's link
          // rendering is exercised rather than only its no-link branch.
          referenceId:
            kind === "speech" ? `${WAHLPERIODE}/${80 + (day % 6)}` : `${WAHLPERIODE}/${paper}`,
          referenceType: kind === "speech" ? "plenarprotokoll" : "drucksache",
          wahlperiode: WAHLPERIODE,
          createdAt: now,
        })
        events++
      }
    }

    return { mps: roster.length, scores, events, ballots, explanations, motions, referrals }
  },
})
