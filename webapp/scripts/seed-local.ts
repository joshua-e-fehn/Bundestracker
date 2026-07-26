/**
 * Seeds a local Convex deployment with a realistic slice of WP21.
 *
 * Development only — it POSTs to the same `/api/pipeline/*` routes the Python
 * pipeline uses (convex/http.ts), so running it also exercises the ingestion
 * API rather than reaching past it into the database. Nothing here is invented
 * data pretending to be real: the names, groups and Drucksache numbers are
 * shaped like the sources described in docs/api-research.md so the pages are
 * exercised against the *distribution* the real data has, especially its gaps.
 *
 * Three properties of the real corpus are deliberately reproduced, because they
 * are what the UI has to survive:
 *
 *  - **Most MPs have no portrait.** §6.5 measured Commons coverage at 36.5 %,
 *    so most rows here have `photoUrl: null` and render as initials.
 *  - **Some MPs have no score row.** The cron has not reached them; the table
 *    must show that as unknown rather than as zero.
 *  - **List MPs have no constituency**, and one MP sits with no Fraktion.
 *
 *   PIPELINE_API_KEY=… bun run scripts/seed-local.ts
 */

// The empty export makes this a module, so the top-level `await main()` below
// is legal to `tsc`. `bun run` executes it either way; the production build
// typechecks every file under webapp/, including this one.
export {}

const SITE_URL = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3213"
const API_KEY = process.env.PIPELINE_API_KEY ?? "dev-seed-key"
const WP = 21

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${SITE_URL}/api/pipeline/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`POST ${path} → ${response.status}: ${text}`)
  return JSON.parse(text)
}

type Seed = {
  internalId: string
  vorname: string
  nachname: string
  fraktion: string
  party: string
  constituency: string | null
  photoUrl?: string | null
  profession?: string | null
  /** Omitted means the cron has not scored this MP — a real state the table
   * must render as unknown rather than as zero. */
  score?: { motions: number; speechWords: number; questions: number; participation: number }
}

const MPS: Seed[] = [
  {
    internalId: "bt-0001",
    vorname: "Friedrich",
    nachname: "Merz",
    fraktion: "CDU/CSU",
    party: "CDU",
    constituency: "Hochsauerlandkreis",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/2/2f/Friedrich_Merz_2019.jpg",
    profession: "Rechtsanwalt",
    score: { motions: 14, speechWords: 48200, questions: 3, participation: 0.94 },
  },
  {
    internalId: "bt-0002",
    vorname: "Saskia",
    nachname: "Esken",
    fraktion: "SPD",
    party: "SPD",
    constituency: "Calw",
    profession: "Informatikerin",
    score: { motions: 9, speechWords: 31400, questions: 11, participation: 0.88 },
  },
  {
    internalId: "bt-0003",
    vorname: "Britta",
    nachname: "Haßelmann",
    // The long Stammdaten spelling, to check the badge survives an unmapped row.
    fraktion: "BÜNDNIS 90/DIE GRÜNEN",
    party: "BÜNDNIS 90/DIE GRÜNEN",
    constituency: null,
    score: { motions: 21, speechWords: 27800, questions: 19, participation: 0.97 },
  },
  {
    internalId: "bt-0004",
    vorname: "Cansel",
    nachname: "Kiziltepe",
    fraktion: "SPD",
    party: "SPD",
    constituency: null,
    score: { motions: 4, speechWords: 9100, questions: 26, participation: 0.71 },
  },
  {
    internalId: "bt-0005",
    vorname: "Sahra",
    nachname: "Özoğuz",
    fraktion: "Die Linke",
    party: "Die Linke",
    constituency: "Hamburg-Wandsbek",
    // Diacritics, so the search box's folding is exercised against a real name
    // shape (§6.1: the two official sources disagree at character level).
    score: { motions: 2, speechWords: 5400, questions: 41, participation: 0.62 },
  },
  {
    internalId: "bt-0006",
    vorname: "Michael",
    nachname: "Brand (Fulda)",
    fraktion: "CDU/CSU",
    party: "CDU",
    constituency: "Fulda",
    // The ortsZusatz disambiguator, inside the name as Stammdaten spells it.
    score: { motions: 7, speechWords: 12600, questions: 5, participation: 0.91 },
  },
  {
    internalId: "bt-0007",
    vorname: "Konstantin",
    nachname: "von Notz",
    fraktion: "BÜNDNIS 90/DIE GRÜNEN",
    party: "BÜNDNIS 90/DIE GRÜNEN",
    constituency: "Herzogtum Lauenburg – Stormarn-Süd",
    score: { motions: 11, speechWords: 22300, questions: 8, participation: 0.85 },
  },
  {
    internalId: "bt-0008",
    vorname: "Joana",
    nachname: "Cotar",
    // No Fraktion — `fraktionslos` is a real state and must render neutrally
    // rather than as a coloured smudge.
    fraktion: "fraktionslos",
    party: "",
    constituency: null,
    score: { motions: 0, speechWords: 1800, questions: 2, participation: 0.44 },
  },
  {
    internalId: "bt-0009",
    vorname: "Lars",
    nachname: "Klingbeil",
    fraktion: "SPD",
    party: "SPD",
    constituency: "Rotenburg I – Heidekreis",
    // No score row: the cron has not reached this MP. The table must show "—".
  },
  {
    internalId: "bt-0010",
    vorname: "Alice",
    nachname: "Weidel",
    fraktion: "AfD",
    party: "AfD",
    constituency: null,
    score: { motions: 6, speechWords: 18900, questions: 14, participation: 0.79 },
  },
  // Two more CDU/CSU members, so the group has a real majority for bt-0006 to
  // break with. At two members a single dissent is a 1–1 tie, which
  // `groupMajority` correctly reports as *no* majority — so the dissent case
  // was never rendered, and the seed rather than the query was the reason.
  {
    internalId: "bt-0011",
    vorname: "Julia",
    nachname: "Klöckner",
    fraktion: "CDU/CSU",
    party: "CDU",
    constituency: "Kreuznach",
    score: { motions: 5, speechWords: 14200, questions: 6, participation: 0.9 },
  },
  {
    internalId: "bt-0012",
    vorname: "Alexander",
    nachname: "Dobrindt",
    fraktion: "CDU/CSU",
    party: "CSU",
    constituency: "Weilheim",
    score: { motions: 8, speechWords: 16700, questions: 4, participation: 0.86 },
  },
]

const WEIGHTS = {
  motions: 5,
  speeches: 0.01,
  questions: 3,
  reports: 4,
  voteParticipation: 100,
  committees: 2,
  billSponsorships: 5,
}

function breakdownFor(seed: NonNullable<Seed["score"]>, committees: number) {
  const raws = {
    motions: seed.motions,
    speeches: seed.speechWords,
    questions: seed.questions,
    reports: 0,
    voteParticipation: seed.participation,
    committees,
    billSponsorships: Math.floor(seed.motions / 3),
  }
  const breakdown = Object.fromEntries(
    Object.entries(raws).map(([component, raw]) => {
      const weight = WEIGHTS[component as keyof typeof WEIGHTS]
      return [component, { raw, weight, weighted: raw * weight }]
    }),
  )
  const totalScore =
    Math.round(Object.values(breakdown).reduce((sum, entry) => sum + entry.weighted, 0) * 100) / 100
  return { breakdown, totalScore, raws }
}

/** A deterministic pseudo-random stream, so two runs seed the same corpus and a
 * screenshot taken today is comparable to one taken tomorrow. */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

async function main() {
  console.log(`Seeding ${SITE_URL} …`)

  await post("mps", {
    mps: MPS.map((seed) => ({
      internalId: seed.internalId,
      stammdatenId: `1100${seed.internalId.slice(-4)}`,
      dipPersonId: null,
      name: `${seed.vorname} ${seed.nachname}`,
      vorname: seed.vorname,
      nachname: seed.nachname.replace(/\s*\(.*\)$/, ""),
      ortsZusatz: /\((.*)\)/.exec(seed.nachname)?.[0] ?? null,
      praefix: seed.nachname.startsWith("von ") ? "von" : null,
      party: seed.party,
      fraktion: seed.fraktion,
      constituency: seed.constituency,
      wahlperiode: WP,
      bio: null,
      photoUrl: seed.photoUrl ?? null,
      birthDate: "1975-04-12",
      education: null,
      profession: seed.profession ?? null,
      electionMethod: seed.constituency ? "Direktwahl" : "Landesliste",
      datesInOffice: { start: "2025-03-25", end: null },
    })),
  })
  console.log(`  ${MPS.length} MPs`)

  // One committee each for the first six, so the sidebar has both states.
  const committees = ["Auswärtiger Ausschuss", "Haushaltsausschuss", "Rechtsausschuss"]
  await post("committee-memberships", {
    memberships: MPS.slice(0, 6).map((seed, index) => ({
      mpInternalId: seed.internalId,
      committeeName: committees[index % committees.length],
      role: index === 0 ? "Vorsitzender" : "Ordentliches Mitglied",
      wahlperiode: WP,
      startDate: "2025-04-08",
      endDate: null,
    })),
  })

  // Two ballots, so the party-line comparison has something to compare against
  // — including one where a member breaks with their group.
  for (const [index, ballot] of [
    { abstimmnr: 1, title: "Gesetz zur Änderung des Klimaschutzgesetzes", date: "2026-06-18" },
    { abstimmnr: 2, title: "Antrag zur Reform des Wahlrechts", date: "2026-07-02" },
  ].entries()) {
    await post("vote-sheets", {
      wahlperiode: WP,
      sitzungnr: 90 + index,
      abstimmnr: ballot.abstimmnr,
      title: ballot.title,
      date: ballot.date,
      result: "Annahme der Vorlage",
      yesCount: 6,
      noCount: 3,
      abstainCount: 1,
      invalidCount: 0,
      absentCount: 0,
      totalEligible: MPS.length,
      sourceUrl: null,
    })
    await post("vote-records", {
      wahlperiode: WP,
      sitzungnr: 90 + index,
      abstimmnr: ballot.abstimmnr,
      records: MPS.map((seed, mpIndex) => ({
        mpInternalId: seed.internalId,
        // Groups vote together, except bt-0006, who breaks with the CDU/CSU on
        // the first ballot — the case `groupMajority` exists to surface.
        vote:
          seed.internalId === "bt-0006" && index === 0
            ? "no"
            : seed.fraktion === "CDU/CSU" || seed.fraktion === "AfD"
              ? "yes"
              : mpIndex % 5 === 4
                ? "abstain"
                : mpIndex % 7 === 3
                  ? "absent"
                  : "no",
        partyAtVote: seed.fraktion,
        remark: mpIndex % 7 === 3 ? "gesetzlicher Mutterschutz" : null,
      })),
    })
  }
  console.log("  2 ballots")

  await post("speeches", {
    speeches: MPS.flatMap((seed, mpIndex) =>
      Array.from({ length: 3 }, (_, speechIndex) => ({
        mpInternalId: seed.internalId,
        protocolId: null,
        protocolDate: `2026-0${5 + (speechIndex % 3)}-1${mpIndex % 9}`,
        wahlperiode: WP,
        sitzungnr: 88 + speechIndex,
        speechIndex: mpIndex * 10 + speechIndex,
        wordCount: 900 + mpIndex * 137 + speechIndex * 411,
        topic: `Tagesordnungspunkt ${3 + speechIndex}`,
      })),
    ),
  })
  console.log(`  ${MPS.length * 3} speeches`)

  // The sponsors are attached below, per motion; here only the count of MPs
  // decides how many papers to create.
  const motions = MPS.slice(0, 8).map((_seed, index) => ({
    dipVorgangId: `vorgang-${index + 1}`,
    dipDrucksacheId: null,
    drucksacheNr: `21/${7300 + index * 17}`,
    title: [
      "Entwurf eines Gesetzes zur Beschleunigung von Planungsverfahren",
      "Antrag: Digitale Infrastruktur im ländlichen Raum stärken",
      "Entschließungsantrag zur Reform der Schuldenbremse",
      "Antrag: Transparenz bei parlamentarischen Abstimmungen",
      "Entwurf eines Gesetzes zur Änderung des Energiewirtschaftsgesetzes",
      "Antrag: Förderung des öffentlichen Nahverkehrs",
      "Entschließungsantrag zur europäischen Asylpolitik",
      "Antrag: Bürokratieabbau für kleine und mittlere Unternehmen",
    ][index],
    type: index % 2 === 0 ? "Gesetzentwurf" : "Antrag",
    date: `2026-0${4 + (index % 4)}-${String(5 + index).padStart(2, "0")}`,
    wahlperiode: WP,
    vorgangstyp: null,
  }))
  await post("motions", { motions })
  for (const [index, seed] of MPS.slice(0, 8).entries()) {
    await post("motion-sponsors", {
      dipVorgangId: `vorgang-${index + 1}`,
      dipDrucksacheId: null,
      wahlperiode: WP,
      sponsors: [
        { mpInternalId: seed.internalId, role: "Erstunterzeichner" },
        {
          mpInternalId: MPS[(index + 1) % MPS.length].internalId,
          role: "Mitunterzeichner",
        },
      ],
    })
  }
  console.log(`  ${motions.length} motions`)

  // The contribution graph's input: a year of daily events, denser on sitting
  // weeks and empty over the summer recess, so the grid has real texture rather
  // than uniform noise.
  const random = makeRandom(20260726)
  const events: Array<Record<string, unknown>> = []
  const today = new Date(Date.UTC(2026, 6, 26))
  for (const seed of MPS) {
    const intensity = seed.score ? 0.3 + seed.score.motions / 30 : 0.1
    for (let daysBack = 0; daysBack < 360; daysBack++) {
      const day = new Date(today)
      day.setUTCDate(day.getUTCDate() - daysBack)
      const weekday = day.getUTCDay()
      // Parliament does not sit at weekends, nor through the summer recess.
      if (weekday === 0 || weekday === 6) continue
      const month = day.getUTCMonth()
      if (month === 7) continue
      if (random() > intensity) continue
      const count = 1 + Math.floor(random() * 3)
      for (let n = 0; n < count; n++) {
        const iso = day.toISOString().slice(0, 10)
        events.push({
          mpInternalId: seed.internalId,
          eventType: (["motion", "speech", "vote", "question"] as const)[Math.floor(random() * 4)],
          date: iso,
          title: "Parlamentarische Aktivität",
          description: null,
          referenceId: `${seed.internalId}-${iso}-${n}`,
          referenceType: "seed",
          wahlperiode: WP,
        })
      }
    }
  }
  for (let offset = 0; offset < events.length; offset += 400) {
    await post("activity-events", { events: events.slice(offset, offset + 400) })
  }
  console.log(`  ${events.length} activity events`)

  // Scores: the period total plus twelve monthly rows, matching the shape
  // `activityScores` documents — the null-month row is what the rankings sort
  // on and what the profile's big number reads.
  for (const seed of MPS) {
    if (!seed.score) continue
    const committeeSeats = MPS.slice(0, 6).some((m) => m.internalId === seed.internalId) ? 1 : 0
    const { breakdown, totalScore, raws } = breakdownFor(seed.score, committeeSeats)
    await post("scores", {
      mpInternalId: seed.internalId,
      wahlperiode: WP,
      month: null,
      motionCount: raws.motions,
      speechCount: 3,
      speechWordCount: raws.speeches,
      questionCount: raws.questions,
      reportCount: 0,
      voteParticipationRate: seed.score.participation,
      committeeCount: committeeSeats,
      billSponsorshipCount: raws.billSponsorships,
      totalScore,
      scoreBreakdown: breakdown,
    })

    for (let back = 0; back < 12; back++) {
      const month = new Date(Date.UTC(2026, 6 - back, 1)).toISOString().slice(0, 7)
      const share = 1 / 12
      const monthly = breakdownFor(
        {
          motions: Math.round(seed.score.motions * share),
          speechWords: Math.round(seed.score.speechWords * share),
          questions: Math.round(seed.score.questions * share),
          participation: seed.score.participation,
        },
        committeeSeats,
      )
      await post("scores", {
        mpInternalId: seed.internalId,
        wahlperiode: WP,
        month,
        motionCount: monthly.raws.motions,
        speechCount: 1,
        speechWordCount: monthly.raws.speeches,
        questionCount: monthly.raws.questions,
        reportCount: 0,
        voteParticipationRate: seed.score.participation,
        committeeCount: committeeSeats,
        billSponsorshipCount: monthly.raws.billSponsorships,
        totalScore: monthly.totalScore,
        scoreBreakdown: monthly.breakdown,
      })
    }
  }
  console.log("  scores")
  console.log("Done.")
}

await main()
