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
 *  - **Most MPs have a portrait, but not all.** The Bundestag's own listing
 *    publishes one for every WP21 MP and 635 of 639 join to the roster
 *    (pipeline `api/mp_profiles.py`), so initials are now the exception — which
 *    is exactly why a row here still has none, and why every portrait here
 *    carries the `photoCredit` the licence requires.
 *  - **Contact data is partial and has no email or phone in it.** Neither is
 *    published anywhere; `formUrl` is the Bundestag's own substitute. Roughly
 *    half of MPs list a constituency office, so some rows here do not.
 *  - **Some MPs have no score row.** The cron has not reached them; the table
 *    must show that as unknown rather than as zero.
 *  - **List MPs have no constituency**, and one MP sits with no Fraktion.
 *  - **A federal state is not implied by holding a constituency.** Most list
 *    members carry a `WKR_LAND` too; only the 21 WP21 mandates with no
 *    constituency block at all leave it empty, so exactly one row here does.
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

/**
 * Refuses to run against anything but a local deployment.
 *
 * This is not hypothetical caution. This script was run against **production**
 * on 2026-07-27 and wrote twelve invented mandates into the live roster; nine
 * carried the names of sitting members, so nine MPs appeared twice on a site
 * whose entire premise is that every figure is a Bundestag record. Removing them
 * took `convex/purgeSeed.ts` and a traversal of ten tables — and two attempts:
 * the first missed the two ballots this script also writes, because a vote sheet
 * belongs to no mandate, and one of them stayed live for two days afterwards.
 *
 * The default `SITE_URL` is a loopback address, so the accident needs an
 * explicit `CONVEX_SITE_URL=` pointing somewhere else — which is exactly the
 * shape of a command someone runs while debugging a deployment. Hence a check on
 * the value rather than trust in the default.
 *
 * `ALLOW_REMOTE_SEED=1` is the deliberate override, for a throwaway cloud
 * deployment that genuinely wants fixtures. It has to be typed on the command
 * line, which is the whole point: nobody types it by accident, and it is
 * greppable in a shell history afterwards.
 */
function assertLocalDeployment(url: string): void {
  if (process.env.ALLOW_REMOTE_SEED === "1") return
  const host = URL.canParse(url) ? new URL(url).hostname : ""
  const local = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1"
  if (local) return
  throw new Error(
    `Refusing to seed ${url}: this writes invented MPs and only a local deployment may hold them.\n` +
      "Production held twelve of these rows for a day because this check did not exist.\n" +
      "If the target really is a throwaway deployment, re-run with ALLOW_REMOTE_SEED=1.",
  )
}

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
  /** Stammdaten `WKR_LAND`. Omitted means the source carries none — the shape
   * of the 21 WP21 list members with no constituency block at all, and the
   * only way the state filter's unknown arm gets exercised locally. It is
   * *not* implied by `constituency: null`: most list members do carry one. */
  federalState?: string | null
  photoUrl?: string | null
  /** Required alongside `photoUrl` — the images are credited, not
   * open-licensed, so one without the other is not a shippable state. */
  photoCredit?: string | null
  profession?: string | null
  occupation?: string | null
  education?: string | null
  contact?: {
    formUrl: string | null
    constituencyOffice: string | null
    homepage: string | null
    socials: Array<{ platform: string; url: string }>
  } | null
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
    federalState: "NW",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/2/2f/Friedrich_Merz_2019.jpg",
    photoCredit: "Tobias Koch/CDU",
    profession: "Rechtsanwalt",
    occupation: "MdB",
    education: "Jurist",
    contact: {
      formUrl: "https://www.bundestag.de/services/formular/contactform?mdbId=1043330",
      constituencyOffice: "Wahlkreisbüro Arnsberg\nZu den Werkstätten 2\n59759 Arnsberg",
      homepage: "https://www.friedrich-merz.de",
      socials: [
        { platform: "Instagram", url: "https://www.instagram.com/friedrichmerz/" },
        { platform: "X", url: "https://x.com/_FriedrichMerz" },
      ],
    },
    score: { motions: 14, speechWords: 48200, questions: 3, participation: 0.94 },
  },
  {
    internalId: "bt-0002",
    vorname: "Saskia",
    nachname: "Esken",
    fraktion: "SPD",
    party: "SPD",
    constituency: "Calw",
    federalState: "BW",
    profession: "Informatikerin",
    occupation: "MdB",
    // No constituency office and no homepage — the shape roughly half the real
    // roster has, so the Contact card must render a partial block.
    contact: {
      formUrl: "https://www.bundestag.de/services/formular/contactform?mdbId=1043342",
      constituencyOffice: null,
      homepage: null,
      socials: [{ platform: "Mastodon", url: "https://social.bund.de/@eskensaskia" }],
    },
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
    federalState: "NW",
    score: { motions: 21, speechWords: 27800, questions: 19, participation: 0.97 },
  },
  {
    internalId: "bt-0004",
    vorname: "Cansel",
    nachname: "Kiziltepe",
    fraktion: "SPD",
    party: "SPD",
    constituency: null,
    federalState: "BE",
    score: { motions: 4, speechWords: 9100, questions: 26, participation: 0.71 },
  },
  {
    internalId: "bt-0005",
    vorname: "Sahra",
    nachname: "Özoğuz",
    fraktion: "Die Linke",
    party: "Die Linke",
    constituency: "Hamburg-Wandsbek",
    federalState: "HH",
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
    federalState: "HE",
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
    federalState: "SH",
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
    // The only row with no `federalState`: the shape of the 21 WP21 mandates
    // whose constituency block is empty entirely. Every state filter must show
    // this member under no state rather than under a guessed one.
    score: { motions: 0, speechWords: 1800, questions: 2, participation: 0.44 },
  },
  {
    internalId: "bt-0009",
    vorname: "Lars",
    nachname: "Klingbeil",
    fraktion: "SPD",
    party: "SPD",
    constituency: "Rotenburg I – Heidekreis",
    federalState: "NI",
    // No score row: the cron has not reached this MP. The table must show "—".
  },
  {
    internalId: "bt-0010",
    vorname: "Alice",
    nachname: "Weidel",
    fraktion: "AfD",
    party: "AfD",
    constituency: null,
    federalState: "BW",
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
    federalState: "RP",
    score: { motions: 5, speechWords: 14200, questions: 6, participation: 0.9 },
  },
  {
    internalId: "bt-0012",
    vorname: "Alexander",
    nachname: "Dobrindt",
    fraktion: "CDU/CSU",
    party: "CSU",
    constituency: "Weilheim",
    federalState: "BY",
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
  // Before the first write, not after — see `assertLocalDeployment`.
  assertLocalDeployment(SITE_URL)
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
      // Explicit null, never omitted: Stammdaten is read in full every run, so
      // the pipeline states the absence rather than staying silent about it —
      // see `federal_state` in the pipeline's transform.py.
      federalState: seed.federalState ?? null,
      wahlperiode: WP,
      bio: null,
      photoUrl: seed.photoUrl ?? null,
      photoCredit: seed.photoCredit ?? null,
      birthDate: "1975-04-12",
      education: seed.education ?? null,
      profession: seed.profession ?? null,
      occupation: seed.occupation ?? null,
      contact: seed.contact ?? null,
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
  // — including one where a member breaks with their group. The first is
  // linked to a DIP Vorgang so the vote-detail §31 disclosure has a populated
  // arm to exercise; the second is *deliberately unlinked* so the
  // "linkage missing" arm is visible too. The schema note on
  // `voteSheets.dipVorgangId` sets out why the three states matter.
  for (const [index, ballot] of [
    {
      abstimmnr: 1,
      title: "Gesetz zur Änderung des Klimaschutzgesetzes",
      date: "2026-06-18",
      // `seed-vorgang-` prefix keeps it recognisably synthetic; a real DIP
      // Vorgang id is a bare integer.
      dipVorgangId: "seed-vorgang-klimaschutz",
    },
    {
      abstimmnr: 2,
      title: "Antrag zur Reform des Wahlrechts",
      date: "2026-07-02",
      dipVorgangId: null,
    },
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
      dipVorgangId: ballot.dipVorgangId,
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

  // §31 declarations against the first (linked) ballot's Vorgang, so the
  // vote-detail page's disclosure has a populated arm. Attributed to three
  // members whose names the reader has already seen; a real §31 sample
  // (measured 2026-07-29) reaches 20 declarations against a sitting's
  // busiest ballot, so three is a plausible chamber and not a wall. The
  // second ballot is left with no declaration on purpose — that is the
  // "linked, none filed" arm of the disclosure.
  await post("vote-explanations", {
    explanations: MPS.slice(0, 3).map((seed, index) => ({
      // `seed-` prefix keeps the ids recognisably synthetic; a real DIP
      // activity id is a bare integer.
      dipAktivitaetId: `seed-erklaerung-${index + 1}`,
      mpInternalId: seed.internalId,
      dipVorgangId: "seed-vorgang-klimaschutz",
      // The referenced procedure's *title*, not the member's reason — the
      // schema note on `voteExplanations.subject` is explicit that this
      // is what was voted on, not why.
      subject: "Gesetz zur Änderung des Klimaschutzgesetzes",
      aktivitaetsart: "Schriftliche Erklärung gem. § 31 Geschäftsordnung BT",
      // A stub source link, so the disclosure's link branch is exercised
      // without pointing at a real external URL a seeder should not be
      // linking to. `#seed-declaration-<n>` renders as a same-page anchor
      // and does not navigate off the site.
      sourceUrl: `about:blank#seed-declaration-${index + 1}`,
      protocolNumber: `${WP}/${90}`,
      date: "2026-06-18",
      wahlperiode: WP,
    })),
  })
  console.log("  3 §31 declarations")

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

  /**
   * The motions corpus — the input `/motions` pages over.
   *
   * Four properties of the real table are reproduced, because each is one the
   * page has to survive and none of them was visible while every seeded row
   * looked alike:
   *
   *  - **`vorgangstyp` is heavily skewed.** Measured against production,
   *    `Schriftliche Frage` is 44 % of a WP21 sample and 71 % of a WP20 one.
   *    That skew is the entire reason `by_wahlperiode_and_vorgangstyp_and_date`
   *    exists (convex/schema.ts): filtering to a rarer kind after the fact
   *    empties the first several pages. A seed of eight evenly-spread rows
   *    could not have exercised it.
   *  - **`vorgangstyp` is often null**, and null is not a filterable value —
   *    `getMotionFilterOptions` drops it from the vocabulary deliberately, so
   *    the seed has to contain some or that branch is never taken.
   *  - **Most rows carry no Drucksache number.** 178 of 700 in the WP21 sample,
   *    63 of 700 in WP20. `drucksachePdfUrl` returns null for those and the row
   *    renders "no linkable document" instead of a link, which is a state worth
   *    seeing on screen rather than only in a test.
   *  - **A period spans several calendar years**, which is what the year filter
   *    is for and what a single-year seed cannot show.
   */
  const MOTION_KINDS = [
    // Weighted by frequency, so a filter on a rare kind behaves here the way it
    // behaves in production rather than returning a third of the list.
    ...Array<string | null>(9).fill("Schriftliche Frage"),
    ...Array<string | null>(4).fill("Kleine Anfrage"),
    "Gesetzgebung",
    "Antrag",
    "EU-Vorlage",
    ...Array<string | null>(4).fill(null),
  ]
  const MOTION_TITLES = [
    "Entwurf eines Gesetzes zur Beschleunigung von Planungsverfahren",
    "Antrag: Digitale Infrastruktur im ländlichen Raum stärken",
    "Entschließungsantrag zur Reform der Schuldenbremse",
    "Antrag: Transparenz bei parlamentarischen Abstimmungen",
    "Entwurf eines Gesetzes zur Änderung des Energiewirtschaftsgesetzes",
    "Antrag: Förderung des öffentlichen Nahverkehrs",
    "Entschließungsantrag zur europäischen Asylpolitik",
    "Antrag: Bürokratieabbau für kleine und mittlere Unternehmen",
    // Carries an umlaut in a word a reader would plausibly search for, so the
    // title filter's folding (`für` → `fuer`, lib/search.ts) is exercised by the
    // data rather than only by its unit test.
    "Kleine Anfrage: Maßnahmen für die Barrierefreiheit im Fernverkehr",
    "Kleine Anfrage: Stand der Digitalisierung in Bundesbehörden",
  ]
  // 60 rows rather than 8: enough to page twice at 25 and to leave a rare kind
  // genuinely rare. Still a seed, not a corpus — production holds 37 726 for one
  // period, and nothing here pretends to that scale.
  const MOTION_COUNT = 60
  const motions = Array.from({ length: MOTION_COUNT }, (_unused, index) => ({
    dipVorgangId: `vorgang-${index + 1}`,
    dipDrucksacheId: null,
    // Roughly a quarter, matching the sampled 178/700 — the rest render the
    // "no linkable document" state.
    drucksacheNr: index % 4 === 0 ? `21/${7300 + index * 17}` : null,
    title: `${MOTION_TITLES[index % MOTION_TITLES.length]} (${index + 1})`,
    type: index % 2 === 0 ? "Gesetzentwurf" : "Antrag",
    // Spread over two calendar years so the year filter has something to select
    // between, newest first once the index orders them.
    date: `${index < 40 ? 2026 : 2025}-${String(1 + (index % 12)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`,
    wahlperiode: WP,
    vorgangstyp: MOTION_KINDS[index % MOTION_KINDS.length],
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

  // Committee referrals against a handful of the motions above — the input
  // the `/motions` row disclosure reads. Three motions get referrals each
  // (one lead, two consulted), so the disclosure's populated arm exercises
  // ordering (lead first) and every sensible column. The rest of the 60
  // motions stay empty, which is what the "no referral for this motion"
  // arm needs. `getReferralCoverage` returns a positive count for the
  // period either way, so the "not backfilled" arm is exercised through
  // tests rather than through this seed.
  const REFERRAL_COMMITTEES = [
    { name: "Ausschuss für Klimaschutz und Energie", abbrev: "KEnAus", lead: true },
    { name: "Ausschuss für Verkehr", abbrev: "VerkAus", lead: false },
    { name: "Rechtsausschuss", abbrev: "RAus", lead: false },
  ]
  const referrals: Array<Record<string, unknown>> = []
  for (const [motionIndex, motion] of motions.slice(0, 3).entries()) {
    for (const [committeeIndex, committee] of REFERRAL_COMMITTEES.entries()) {
      referrals.push({
        dipVorgangspositionId: `seed-position-${motion.dipVorgangId}-${committeeIndex}`,
        dipVorgangId: motion.dipVorgangId,
        committeeName: committee.name,
        committeeAbbreviation: committee.abbrev,
        leadCommittee: committee.lead,
        // `ueberweisungsart` was empty on every referral sampled from DIP,
        // so null here matches the real distribution rather than
        // inventing a value.
        referralType: null,
        positionKind: motionIndex === 0 ? "Überweisung" : "1. Beratung",
        documentNumber: motion.drucksacheNr,
        title: motion.title,
        date: motion.date,
        wahlperiode: WP,
      })
    }
  }
  await post("committee-referrals", { referrals })
  console.log(`  ${referrals.length} committee referrals`)

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

  // Last, because the arc is *derived* from the roster rather than posted — the
  // same `seating/generate` route the Python pipeline calls, so seeding
  // exercises it rather than reaching past it. Running it before the roster
  // exists would seat nobody. See convex/seating.ts.
  const seating = (await post("seating/generate", { wahlperiode: WP })) as {
    seated: number
    rows: number
  }
  console.log(`  seating (${seating.seated} seats, ${seating.rows} rows)`)
  console.log("Done.")
}

await main()
