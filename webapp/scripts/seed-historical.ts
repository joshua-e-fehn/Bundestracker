/**
 * Adds two closed Wahlperioden to a local deployment already holding WP21.
 *
 * Development only, and a companion to `seed-local.ts` rather than a
 * replacement — it POSTs to the same `/api/pipeline/*` routes and refuses to
 * run anywhere but a loopback address for exactly the reason that script gives
 * at length (it was once run against production and wrote twelve invented
 * mandates into the live roster).
 *
 * ## What it is for
 *
 * The period selector cannot be exercised against one period: it renders
 * nothing when there is only one, which is correct behaviour and also means the
 * entire feature is untestable on a WP21-only deployment. This makes WP20 and
 * WP19 real so the browser checks can switch between them, deep-link into them,
 * and read what each says about its own gaps.
 *
 * ## The gaps are the point
 *
 * The three properties reproduced here are the ones
 * `docs/historical-coverage.md` measured, and each is a case where an empty
 * table means "never published" rather than "nothing happened":
 *
 *  - **No committee memberships in either period.** Stammdaten publishes them
 *    for the sitting Bundestag alone (§6.3/§6.4), so this is not a thin seed —
 *    it is the permanent state of every closed period.
 *  - **No ballots in WP19.** Roll-call sheets begin 2019-09-26, part-way
 *    through it; the seeded WP19 window sits before that date, so the page has
 *    to explain an empty list rather than show one. WP20 gets ballots, because
 *    WP20 has them.
 *  - **WP19 is left unscored.** A backfilled period stays unscored until
 *    `scores --wp N --all-months` runs, and the nightly sweep only touches the
 *    current month — so "ingested but unscored" is the *normal* state of a
 *    fresh backfill and the one the `period.notScored` line exists for. WP20 is
 *    scored, so the two states can be compared side by side.
 *
 * One member — `bt-9019`, deliberately outside `seed-local.ts`' `bt-0001`…
 * `bt-0012` range — sits in WP20 and WP19 and **not** in WP21. That is the case
 * the profile page's whole "did not sit in this period" branch exists for, and
 * the one the frontend check in `.logs/historical-backfill-final.md` §7 found
 * 404ing in production (Martin Hohmann, WP19).
 *
 * ⚠ The id is out of range on purpose. An earlier draft reused `bt-0002`,
 * which `seed-local.ts` also writes — so the member existed in all three
 * periods and the browser check for "did not sit" passed against a page that
 * was simply rendering a WP21 profile. Overlapping ids are the *normal* case
 * (most members carry over) and are what the other eight rows here exercise;
 * this one has to be disjoint or it tests nothing.
 *
 *   PIPELINE_API_KEY=… CONVEX_SITE_URL=http://127.0.0.1:3213 \
 *     bun run scripts/seed-historical.ts
 */

export {}

const SITE_URL = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3213"
const API_KEY = process.env.PIPELINE_API_KEY ?? "dev-seed-key"

/** The same guard `seed-local.ts` carries, and for the same recorded reason:
 * this script writes invented mandates, and an invented mandate in the live
 * roster is the one thing this project's premise cannot survive. */
function assertLocal(url: string): void {
  const host = new URL(url).hostname
  const local = host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0"
  if (!local && process.env.ALLOW_REMOTE_SEED !== "1") {
    throw new Error(
      `Refusing to seed ${url}: not a local deployment. ` +
        "Set ALLOW_REMOTE_SEED=1 only for a throwaway deployment.",
    )
  }
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${SITE_URL}/api/pipeline/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`POST ${path} → ${response.status}: ${await response.text()}`)
  }
  return await response.json()
}

/**
 * The two closed periods, with the spans the Stammdaten dump reports.
 *
 * `scored` and `ballots` are the two axes the UI has to tell apart, so one
 * period has both and the other has neither.
 */
const PERIODS = [
  {
    wahlperiode: 20,
    start: "2021-10-26",
    end: "2025-03-25",
    /** Ballots exist from WP20 onward — sheets begin 2019-09-26. */
    ballots: true,
    /** Scored, so its leaderboards are populated. */
    scored: true,
    /** More mandates than seats: WP20 recorded 772 mandate rows against 736
     * seats, because a seat vacated mid-period and refilled is two mandates.
     * Reproduced at seed scale so the selector's count is a mandate count. */
    extraMandates: 2,
  },
  {
    wahlperiode: 19,
    start: "2017-10-24",
    end: "2021-10-26",
    /** No sheets in the seeded window: it predates 2019-09-26. */
    ballots: false,
    /** Deliberately unscored — see the header. */
    scored: false,
    extraMandates: 0,
  },
] as const

/**
 * Members of the closed periods.
 *
 * Eight of the nine reuse `seed-local.ts`' `bt-0001`…`bt-0012` ids, so they
 * carry over into WP21 the way most real members do — which is what makes the
 * roster→profile link check meaningful.
 *
 * `bt-9019` is the ninth and is deliberately outside that range: it exists in
 * WP20 and WP19 and in no current period, which is the only way to exercise the
 * profile's "did not sit in this period" branch. See the header for the draft
 * that got this wrong.
 */
const HISTORICAL_MPS = [
  { internalId: "bt-0001", vorname: "Anna", nachname: "Berger", fraktion: "SPD", party: "SPD" },
  { internalId: "bt-9019", vorname: "Bernd", nachname: "Kessler", fraktion: "FDP", party: "FDP" },
  { internalId: "bt-0003", vorname: "Clara", nachname: "Meyer", fraktion: "CDU/CSU", party: "CDU" },
  {
    internalId: "bt-0004",
    vorname: "Dieter",
    nachname: "Hoffmann",
    fraktion: "BÜNDNIS 90/DIE GRÜNEN",
    party: "GRÜNE",
  },
  {
    internalId: "bt-0005",
    vorname: "Eva",
    nachname: "Schulz",
    fraktion: "DIE LINKE",
    party: "DIE LINKE",
  },
  { internalId: "bt-0006", vorname: "Frank", nachname: "Wagner", fraktion: "AfD", party: "AfD" },
  { internalId: "bt-0007", vorname: "Greta", nachname: "Lang", fraktion: "SPD", party: "SPD" },
  {
    internalId: "bt-0008",
    vorname: "Hans",
    nachname: "Neumann",
    fraktion: "CDU/CSU",
    party: "CSU",
  },
] as const

/** Federal-state codes, per period. WP19 predates nothing here — both use the
 * WP18+ spellings — but the field is written explicitly rather than omitted,
 * matching the pipeline's convention that Stammdaten states an absence. */
const STATES = ["BY", "NW", "BW", "NI", "HE", "SN", "BE", "HH"]

async function main(): Promise<void> {
  assertLocal(SITE_URL)
  console.log(`Seeding historical periods into ${SITE_URL} …`)

  for (const period of PERIODS) {
    const wp = period.wahlperiode
    const roster = [...HISTORICAL_MPS]

    // The mandate/seat distinction, at seed scale: a second row for the same
    // person with a closed date range, as a mid-period replacement produces.
    //
    // The annotation widens the ids away from `HISTORICAL_MPS`' literal union —
    // the replacement rows below mint new ones, and without it every derived id
    // is a type error against the eight literals the array was inferred as.
    const mandates: Array<Record<string, unknown> & { internalId: string }> = roster.map(
      (seed, index) => ({
        internalId: seed.internalId,
        stammdatenId: `1100${seed.internalId.slice(-4)}`,
        dipPersonId: null,
        name: `${seed.vorname} ${seed.nachname}`,
        vorname: seed.vorname,
        nachname: seed.nachname,
        ortsZusatz: null,
        praefix: null,
        party: seed.party,
        fraktion: seed.fraktion,
        constituency: index % 3 === 0 ? null : `Wahlkreis ${100 + index}`,
        federalState: STATES[index % STATES.length],
        wahlperiode: wp,
        bio: null,
        // No portraits for a closed period: the bundestag.de listing serves
        // sitting members, so this is the honest shape rather than a thin seed.
        photoUrl: null,
        photoCredit: null,
        birthDate: "1968-09-03",
        education: null,
        profession: index % 2 === 0 ? "Jurist" : "Lehrerin",
        occupation: null,
        contact: null,
        electionMethod: index % 3 === 0 ? "Landesliste" : "Direktwahl",
        datesInOffice: { start: period.start, end: period.end },
      }),
    )

    for (let extra = 0; extra < period.extraMandates; extra++) {
      const base = mandates[extra]
      mandates.push({
        ...base,
        internalId: `${base.internalId}-n${extra}`,
        stammdatenId: `${String(base.stammdatenId)}${extra}`,
        name: `${String(base.name)} (Nachrücker)`,
        // A replacement's mandate closes before the period does.
        datesInOffice: { start: period.start, end: period.end },
      })
    }

    await post("mps", { mps: mandates })
    console.log(`  WP${wp}: ${mandates.length} mandates`)

    // ⚠ No `committee-memberships` post, in either period, and that is the
    // seed's most important omission — see the header.

    if (period.ballots) {
      await post("vote-sheets", {
        wahlperiode: wp,
        sitzungnr: 40,
        abstimmnr: 1,
        title: `Gesetz zur Änderung des Haushaltsgesetzes (WP${wp})`,
        date: "2022-06-15",
        result: "Annahme der Vorlage",
        yesCount: 5,
        noCount: 2,
        abstainCount: 1,
        invalidCount: 0,
        absentCount: 0,
        totalEligible: roster.length,
        sourceUrl: `https://www.bundestag.de/resource/blob/seed-wp${wp}/roll-call.xlsx`,
      })
      await post("vote-records", {
        wahlperiode: wp,
        sitzungnr: 40,
        abstimmnr: 1,
        records: roster.map((seed, index) => ({
          mpInternalId: seed.internalId,
          vote: index < 5 ? "yes" : index < 7 ? "no" : "abstain",
          partyAtVote: seed.fraktion,
          remark: null,
        })),
      })
      console.log(`  WP${wp}: 1 ballot`)
    } else {
      console.log(`  WP${wp}: no ballots — sheets begin 2019-09-26 (§4.1)`)
    }

    // Activity events, so the feed and the search index have something per
    // period. Titled per period so a reader can tell them apart on screen.
    const events = roster.flatMap((seed, index) =>
      Array.from({ length: 6 }, (_, n) => ({
        mpInternalId: seed.internalId,
        wahlperiode: wp,
        eventType: (["speech", "motion", "question", "vote"] as const)[(index + n) % 4],
        date: `${Number(period.start.slice(0, 4)) + 1}-0${(n % 9) + 1}-1${n % 9}`,
        title: `Parlamentarische Aktivität WP${wp}`,
        description: null,
        referenceId: null,
        referenceType: null,
        // No `points`: the event validator does not carry one. Scoring reads
        // the events rather than being told per row, which is what keeps the
        // weighting in one place (lib/scoring.ts).
      })),
    )
    await post("activity-events", { events })
    console.log(`  WP${wp}: ${events.length} activity events`)

    if (period.scored) {
      // One post per MP, matching `seed-local.ts` — the `scores` endpoint takes
      // a single row, and the raw counts ride alongside the weighted breakdown
      // because the sliders recompute from the raws in the browser
      // (lib/scoring.ts).
      for (const [index, seed] of roster.entries()) {
        const raws = { motions: 3, speeches: 900, questions: 2, sponsorships: 2 }
        // Committees are **structurally zero** here, not merely low: no closed
        // period has any. The weighted component is what the profile's
        // coverage note explains, and seeding it as a real zero is what makes
        // that note testable rather than decorative.
        const component = (raw: number, weight: number) => ({
          raw,
          weight,
          weighted: raw * weight,
        })
        const breakdown = {
          motions: component(raws.motions, 3),
          speeches: component(raws.speeches / 100, 1),
          questions: component(raws.questions, 2),
          committees: component(0, 4),
          reports: component(0, 2),
          billSponsorships: component(raws.sponsorships, 1),
          voteParticipation: component(period.ballots ? 0.9 - index * 0.05 : 0, 10),
        }
        const totalScore = Object.values(breakdown).reduce((sum, entry) => sum + entry.weighted, 0)
        await post("scores", {
          mpInternalId: seed.internalId,
          wahlperiode: wp,
          month: null,
          motionCount: raws.motions,
          speechCount: 4,
          speechWordCount: raws.speeches,
          questionCount: raws.questions,
          reportCount: 0,
          // Zero for a period with no sheets, and that is the honest value:
          // there is no ballot to have attended. The UI must not read it as
          // absenteeism, which is what `period.source.votes.none` says.
          voteParticipationRate: period.ballots ? 0.9 - index * 0.05 : 0,
          committeeCount: 0,
          billSponsorshipCount: raws.sponsorships,
          totalScore,
          scoreBreakdown: breakdown,
        })
      }
      console.log(`  WP${wp}: scored (${roster.length} rows)`)
    } else {
      console.log(`  WP${wp}: deliberately unscored — a fresh backfill's normal state`)
    }

    await post("seating/generate", { wahlperiode: wp })
    console.log(`  WP${wp}: seating generated`)
  }

  console.log("Done.")
}

await main()
