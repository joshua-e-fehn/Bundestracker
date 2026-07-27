import { describe, expect, test } from "bun:test"
import {
  eligibleGroups,
  hasRuledOut,
  QUORUM_SHARE,
  quorumCombinations,
  quorumGroups,
  quorumSummary,
  quorumThreshold,
  RULED_OUT,
  refusalsOf,
} from "./inquiry"
import type { FractionSize } from "./parties"

/**
 * Tests for the quorum arithmetic.
 *
 * Same premise as lib/seating.test.ts: this is the part that can be wrong
 * without looking wrong. A threshold off by one, a combination list that skips a
 * pair, an exclusion matrix that is asymmetric because one direction was entered
 * and the other forgotten — each of those renders as a perfectly plausible
 * table, and none of them throws. That is what these are for.
 *
 * The threshold is the sharpest case. `floor` instead of `ceil` produces 157 for
 * a 630-seat chamber, which looks entirely reasonable beside a total of 630 and
 * is a false statement about what compels an inquiry under Art. 44(1) GG.
 */

/**
 * WP21's composition, at 630 seats.
 *
 * ⚠ Deliberately *not* §9's figures. That table reads "CDU/CSU 209, AfD 152,
 * SPD 122, Grüne 88, Linke 67, fraktionslos 3", which sums to 641 — it counts
 * the 635 `WAHLPERIODE` rows including departures and late replacements (§6.2
 * reconciles 635 to the 630 currently serving). A fixture summing to 641 gives a
 * threshold of 161 rather than 158, so every assertion below would be tested
 * against a chamber that does not exist.
 *
 * Spelled the way the *sources* spell them rather than canonically, so the fold
 * is exercised by the fixture rather than assumed.
 */
const WP21: FractionSize[] = [
  { fraktion: "CDU/CSU", count: 208 },
  { fraktion: "AfD", count: 152 },
  { fraktion: "SPD", count: 120 },
  { fraktion: "BÜ90/GR", count: 85 },
  { fraktion: "Die Linke", count: 64 },
  { fraktion: "Fraktionslos", count: 1 },
]

/** The period the fixture is from. `quorumGroups` needs it to read
 * `GOVERNING_PARTIES` — in WP21 the CDU/CSU and SPD govern. */
const WP = 21

describe("quorumThreshold", () => {
  test("a quarter of the real chamber is 158, not 157", () => {
    // 630 / 4 = 157.5. The rule is a floor on the *signatories*, so it rounds
    // up — 157 members are fewer than a quarter however the number is written.
    // This is the one assertion here that is a legal reading rather than
    // arithmetic, and the one a `floor` would silently get wrong.
    expect(quorumThreshold(630)).toBe(158)
  })

  test("an exact quarter is not rounded up past itself", () => {
    // The failure mode on the other side: a blanket `+1` would report 159 for a
    // chamber of 632, where 158 already *is* a quarter.
    expect(quorumThreshold(632)).toBe(158)
    expect(quorumThreshold(4)).toBe(1)
    expect(quorumThreshold(800)).toBe(200)
  })

  test("every fractional quarter rounds up", () => {
    expect(quorumThreshold(629)).toBe(158)
    expect(quorumThreshold(631)).toBe(158)
    expect(quorumThreshold(633)).toBe(159)
  })

  test("an empty chamber has no threshold rather than a threshold of one", () => {
    // A fresh deployment has no roster. Reporting that one signature compels an
    // inquiry would be a confident claim about a parliament with nobody in it.
    expect(quorumThreshold(0)).toBe(0)
    expect(quorumThreshold(-5)).toBe(0)
    expect(quorumThreshold(Number.NaN)).toBe(0)
  })

  test("the share it is derived from is a quarter", () => {
    expect(QUORUM_SHARE).toBe(0.25)
  })
})

describe("RULED_OUT", () => {
  test("names only parties this codebase knows", () => {
    // A typo'd key would sit in the table doing nothing, and the page would
    // render a blank exclusion column with no error anywhere.
    const keys = Object.keys(RULED_OUT)
    for (const [party, others] of Object.entries(RULED_OUT)) {
      for (const other of others) {
        expect(keys, `${party} → ${other}`).toContain(other)
      }
    }
  })

  test("no group rules out itself", () => {
    for (const [party, others] of Object.entries(RULED_OUT)) {
      expect(others, party).not.toContain(party)
    }
  })

  test("residual categories declare nothing", () => {
    // `fraktionslos` is a set of individuals, not a bloc — it cannot
    // collectively rule anything out, and an entry here would imply it can.
    expect(RULED_OUT.fraktionslos).toEqual([])
    expect(RULED_OUT.unknown).toEqual([])
  })
})

describe("hasRuledOut", () => {
  test("is symmetric even where the declaration is one-sided", () => {
    // The SPD's entry names the AfD; the AfD's entry names nobody. A joint
    // motion still needs both signatures, so either refusal alone blocks it.
    // Storing declarations as made and symmetrising here is what keeps the
    // record honest without putting words in a party's mouth.
    expect(RULED_OUT.afd).toEqual([])
    expect(hasRuledOut("spd", "afd")).toBe(true)
    expect(hasRuledOut("afd", "spd")).toBe(true)
  })

  test("every group has ruled out the AfD", () => {
    for (const party of ["cdu-csu", "spd", "gruene", "linke", "fdp"] as const) {
      expect(hasRuledOut(party, "afd"), party).toBe(true)
    }
  })

  test("the CDU/CSU and Die Linke have ruled each other out", () => {
    expect(hasRuledOut("cdu-csu", "linke")).toBe(true)
  })

  test("the SPD and Die Linke are not recorded as an exclusion", () => {
    // Deliberately absent: the federal incompatibility resolution no longer
    // stands and state coalitions exist, so what remains is reluctance rather
    // than a declared bar. A maintained table is only worth having if it also
    // stays silent where the record is thin.
    expect(hasRuledOut("spd", "linke")).toBe(false)
  })

  test("a group is never blocked with itself", () => {
    // A single Fraktion large enough to reach the quarter needs nobody's
    // agreement; reporting it as self-blocked would be nonsense the
    // combination table would then render as a row.
    expect(hasRuledOut("cdu-csu", "cdu-csu")).toBe(false)
    expect(hasRuledOut("afd", "afd")).toBe(false)
  })
})

describe("refusalsOf", () => {
  test("folds in refusals received as well as declared", () => {
    // The AfD declares none and is named by five. A column built only from its
    // own entry would show "none" beside the most-excluded group on the page.
    expect([...refusalsOf("afd")].sort()).toEqual(
      (["cdu-csu", "fdp", "gruene", "linke", "spd"] as const).toSorted(),
    )
  })

  test("lists each counterparty once", () => {
    // The CDU/CSU declares against Die Linke and is declared against by it.
    const linke = refusalsOf("linke")
    expect(linke.filter((party) => party === "cdu-csu")).toHaveLength(1)
  })
})

describe("quorumGroups", () => {
  test("folds spellings of one group before testing it against the bar", () => {
    // The failure this prevents is the one that understates a bloc: production
    // returns `Fraktionslos` and `fraktionslos` as separate rows (§6.4, §5.2),
    // and unfolded neither half is measured against the threshold.
    const split: FractionSize[] = [
      { fraktion: "Fraktionslos", count: 3 },
      { fraktion: "fraktionslos", count: 1 },
      { fraktion: "CDU/CSU", count: 209 },
    ]
    const groups = quorumGroups(split, WP)
    const unaffiliated = groups.filter((group) => group.party === "fraktionslos")
    expect(unaffiliated).toHaveLength(1)
    expect(unaffiliated[0].seats).toBe(4)
  })

  test("orders the groups left to right along the political axis", () => {
    const order = quorumGroups(WP21, WP).map((group) => group.party)
    expect(order).toEqual(["linke", "gruene", "spd", "cdu-csu", "afd", "fraktionslos"])
  })

  test("the largest governing group reaches the quarter on its own", () => {
    // ⚠ The assertion that corrected this page's premise. The CDU/CSU holds 208
    // of 630 — above the 158-seat quarter — so "no group reaches it alone" is
    // false, and a page built on that claim would have shipped a wrong headline.
    // What binds is the *opposition* scope; see the module header.
    const groups = quorumGroups(WP21, WP)
    const cdu = groups.find((group) => group.party === "cdu-csu")
    expect(cdu?.seats).toBe(208)
    expect(cdu?.reachesAlone).toBe(true)
    // And it is the only one: no opposition group comes close on its own.
    expect(groups.filter((group) => group.reachesAlone)).toHaveLength(1)
  })

  test("reads government and opposition from GOVERNING_PARTIES", () => {
    const roles = new Map(quorumGroups(WP21, WP).map((group) => [group.party, group.role]))
    expect(roles.get("cdu-csu")).toBe("government")
    expect(roles.get("spd")).toBe("government")
    expect(roles.get("afd")).toBe("opposition")
    expect(roles.get("gruene")).toBe("opposition")
    expect(roles.get("linke")).toBe("opposition")
  })

  test("shares sum to the whole chamber", () => {
    const total = quorumGroups(WP21, WP).reduce((sum, group) => sum + group.share, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  test("unaffiliated members are counted in the total but not eligible to combine", () => {
    // Both halves matter. Dropping them from the total would lower the bar for
    // everyone else; letting them combine would assert a coordination that the
    // category does not have.
    const groups = quorumGroups(WP21, WP)
    const unaffiliated = groups.find((group) => group.party === "fraktionslos")
    expect(unaffiliated?.eligible).toBe(false)
    expect(groups.reduce((sum, group) => sum + group.seats, 0)).toBe(630)
    expect(eligibleGroups(groups)).toHaveLength(5)
  })
})

describe("quorumCombinations", () => {
  const groups = quorumGroups(WP21, WP)

  test("enumerates every subset up to the size bound, and no more", () => {
    // Five eligible groups: C(5,1)+C(5,2)+C(5,3) = 5 + 10 + 10 = 25. A missing
    // pair would silently remove a row a reader is looking for.
    const combinations = quorumCombinations(groups, 630)
    expect(combinations).toHaveLength(25)
    expect(new Set(combinations.map((entry) => entry.parties.join("+"))).size).toBe(25)
    expect(Math.max(...combinations.map((entry) => entry.parties.length))).toBe(3)
  })

  test("never places an ineligible group in a combination", () => {
    for (const combination of quorumCombinations(groups, 630)) {
      expect(combination.parties).not.toContain("fraktionslos")
      expect(combination.parties).not.toContain("unknown")
    }
  })

  test("returns the near misses as well as the successes", () => {
    // The page's actual finding lives in the rows that fail: a list of only the
    // ones that reach answers "who can" and discards "why not".
    const combinations = quorumCombinations(groups, 630)
    expect(combinations.some((entry) => !entry.reaches)).toBe(true)
    expect(combinations.some((entry) => entry.reaches)).toBe(true)
  })

  test("seats are summed and measured against the threshold", () => {
    const cduSpd = quorumCombinations(groups, 630).find(
      (entry) => entry.parties.join("+") === "spd+cdu-csu",
    )
    // The governing coalition: 208 + 120, more than twice the quarter.
    expect(cduSpd?.seats).toBe(328)
    expect(cduSpd?.reaches).toBe(true)
  })

  test("a combination below the bar does not reach it", () => {
    const grueneLinke = quorumCombinations(groups, 630).find(
      (entry) => entry.parties.join("+") === "linke+gruene",
    )
    // 85 + 64 = 149, nine short of 158 — the whole finding, and the reason the
    // shortfall is printed as a number rather than as a colour.
    expect(grueneLinke?.seats).toBe(149)
    expect(grueneLinke?.reaches).toBe(false)
  })

  test("names the pairs that block a combination rather than only flagging it", () => {
    const withAfd = quorumCombinations(groups, 630).find(
      (entry) => entry.parties.join("+") === "spd+afd",
    )
    expect(withAfd?.blocked).toBe(true)
    expect(withAfd?.blockedBy).toContainEqual(["spd", "afd"])
  })

  test("viable is the conjunction, and the two halves stay separable", () => {
    // The module's whole discipline: `reaches` is counted, `blocked` is
    // maintained, and a consumer can attribute each to its source.
    for (const combination of quorumCombinations(groups, 630)) {
      expect(combination.viable).toBe(combination.reaches && !combination.blocked)
      expect(combination.blocked).toBe(combination.blockedBy.length > 0)
    }
  })

  test("sorts by seats, largest first", () => {
    const seats = quorumCombinations(groups, 630).map((entry) => entry.seats)
    expect(seats).toEqual([...seats].sort((a, b) => b - a))
  })
})

describe("quorumSummary", () => {
  const summary = quorumSummary(WP21, WP)

  test("counts the chamber and its quarter", () => {
    expect(summary.totalSeats).toBe(630)
    expect(summary.threshold).toBe(158)
  })

  test("chamber-wide, the quarter is reachable — which is why that scope is not the finding", () => {
    // ⚠ The corrected premise, asserted rather than described. Over the whole
    // chamber several unblocked combinations clear the bar, because the
    // governing groups are in them. A page reporting *this* number would say the
    // Bundestag can freely establish inquiries, which is true and useless: a
    // government does not compel an inquiry into itself.
    expect(summary.viable.length).toBeGreaterThan(0)
    expect(summary.shortfall).toBeNull()
  })

  test("the opposition cannot reach the quarter without the AfD", () => {
    // The actual finding. The opposition holds 302 seats — AfD 152, Grüne 85,
    // Linke 64 and one unaffiliated member — comfortably past 158. But every
    // other group has ruled the AfD out, and Grüne + Linke alone is 149.
    //
    // The unaffiliated seat is counted in `seats` and cannot appear in a
    // combination (`isEligible`), which is not an inconsistency: that member
    // holds a seat and may sign individually, so omitting them would understate
    // the opposition — but "the unaffiliated" do not file a joint motion.
    const opposition = summary.opposition
    expect(opposition).not.toBeNull()
    expect(opposition?.seats).toBe(302)
    expect(opposition?.reaching.length).toBeGreaterThan(0)
    expect(opposition?.viable).toHaveLength(0)
    // Six, not nine — and the difference is worth stating, because the obvious
    // expectation is wrong in an interesting way. The largest *unblocked*
    // opposition set is not Grüne + Linke (149, nine short) but the **AfD
    // alone** (152, six short): a single group needs no partner, so no
    // exclusion can block it. The lock is therefore narrower than "the
    // opposition cannot act" — it is that the opposition cannot act *jointly*,
    // while the largest single opposition group is six seats from compelling an
    // inquiry on its own.
    expect(opposition?.shortfall).toBe(6)
  })

  test("the non-AfD opposition is nine seats short of the quarter", () => {
    // The other half of the finding, asserted directly: Grüne 85 + Linke 64 =
    // 149 against a bar of 158. This is the number the podcast claim is about —
    // the parties that *will* work together cannot reach a quarter.
    const grueneLinke = summary.opposition?.combinations.find(
      (entry) => entry.parties.join("+") === "linke+gruene",
    )
    expect(grueneLinke?.seats).toBe(149)
    expect(grueneLinke?.reaches).toBe(false)
    expect(summary.threshold - (grueneLinke?.seats ?? 0)).toBe(9)
  })

  test("the AfD alone is the largest single group short of the quarter", () => {
    // 152 of 630. Six seats, and no exclusion applies because there is no
    // partner to refuse — see `hasRuledOut`'s self-check.
    const afdAlone = summary.opposition?.combinations.find(
      (entry) => entry.parties.join("+") === "afd",
    )
    expect(afdAlone?.seats).toBe(152)
    expect(afdAlone?.reaches).toBe(false)
    expect(afdAlone?.blocked).toBe(false)
  })

  test("every reaching opposition combination is blocked by the AfD exclusion", () => {
    for (const combination of summary.opposition?.reaching ?? []) {
      expect(combination.blocked, combination.parties.join("+")).toBe(true)
      // Every one of them is blocked *because of the AfD* — the single
      // exclusion the whole finding rests on.
      expect(combination.parties).toContain("afd")
      expect(combination.blockedBy.length).toBeGreaterThan(0)
    }
  })

  test("the opposition is measured against the chamber's quarter, not its own", () => {
    // The bar is a quarter of *all* members. Restricting who is willing to sign
    // does not lower it, and a quarter of the opposition's 301 seats would be
    // 76 — a number that means nothing and that every pairing would clear.
    for (const combination of summary.opposition?.combinations ?? []) {
      expect(combination.reaches).toBe(combination.seats >= summary.threshold)
    }
  })

  test("an unrecorded coalition yields no opposition scope rather than a guessed one", () => {
    // `GOVERNING_PARTIES` covers WP20 and WP21 only, so `backfill --wp 19`
    // takes this path. Treating every group as opposition would invent a
    // finding out of missing data.
    const historical = quorumSummary(WP21, 19)
    expect(historical.groups.every((group) => group.role === "unknown")).toBe(true)
    expect(historical.opposition).toBeNull()
    // The chamber-wide arithmetic still works — only the scope that needs the
    // maintained coalition is withheld.
    expect(historical.threshold).toBe(158)
  })

  test("shortfall is null rather than 0 when a combination reaches", () => {
    // "No shortfall" and "short by zero" are different claims, and a 0 here
    // would render as "0 seats short" — which reads as success.
    const roomy = quorumSummary(
      [
        { fraktion: "SPD", count: 400 },
        { fraktion: "CDU/CSU", count: 230 },
      ],
      WP,
    )
    expect(roomy.viable.length).toBeGreaterThan(0)
    expect(roomy.shortfall).toBeNull()
  })

  test("a lone group large enough to reach the bar cannot be blocked", () => {
    // The AfD holds 530 of 630 here and signs alone, so there is no partner to
    // refuse it and the row is viable. That is the model behaving correctly, not
    // a gap in the exclusion table: `hasRuledOut(x, x)` is false by
    // construction, because a Fraktion past the quarter needs nobody's consent.
    const dominated = quorumSummary(
      [
        { fraktion: "AfD", count: 530 },
        { fraktion: "SPD", count: 100 },
      ],
      WP,
    )
    const afdAlone = dominated.combinations.find((entry) => entry.parties.join("+") === "afd")
    expect(afdAlone?.reaches).toBe(true)
    expect(afdAlone?.blocked).toBe(false)
  })

  test("reports a real shortfall when every unblocked combination is too small", () => {
    // A chamber where no single group reaches the bar and every combination that
    // would is excluded. Opposition: AfD 150, Grüne 100, Linke 40 = 290 against
    // a bar of 158 — but Grüne + Linke is 140, eight short, and everything
    // larger needs the AfD.
    const stuck = quorumSummary(
      [
        { fraktion: "SPD", count: 200 },
        { fraktion: "CDU/CSU", count: 140 },
        { fraktion: "AfD", count: 150 },
        { fraktion: "BÜ90/GR", count: 100 },
        { fraktion: "Die Linke", count: 40 },
      ],
      WP,
    )
    expect(stuck.threshold).toBe(158)
    expect(stuck.opposition?.viable).toHaveLength(0)
    expect(stuck.opposition?.shortfall).toBe(8)
  })

  test("an empty roster yields no threshold and no combinations", () => {
    const empty = quorumSummary([], WP)
    expect(empty.totalSeats).toBe(0)
    expect(empty.threshold).toBe(0)
    expect(empty.combinations).toHaveLength(0)
    expect(empty.reaching).toHaveLength(0)
    // Nothing reaches, and there is no unblocked combination to measure — so
    // there is no shortfall to state either.
    expect(empty.shortfall).toBeNull()
  })

  test("a single group holding a quarter reaches it alone and is unblocked", () => {
    // The degenerate case the real chamber does not exhibit, asserted so the
    // one-group arm of the enumeration is covered: a Fraktion needs nobody's
    // agreement, so it cannot be blocked.
    const dominant = quorumSummary(
      [
        { fraktion: "CDU/CSU", count: 300 },
        { fraktion: "SPD", count: 330 },
      ],
      WP,
    )
    const alone = dominant.combinations.find((entry) => entry.parties.join("+") === "cdu-csu")
    expect(alone?.reaches).toBe(true)
    expect(alone?.blocked).toBe(false)
    expect(dominant.groups.every((group) => group.reachesAlone)).toBe(true)
  })
})
