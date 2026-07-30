# Historical coverage — what each Wahlperiode can and cannot show

Bundestrack tracks WP21 live and backfills WP14–20 from the same sources. The
older periods are not simply *smaller*: several sources do not reach back at
all, and the gaps are structural rather than a fetch that has not run yet.
This file records which is which, so a zero in the UI can be read correctly.

The distinction matters because the two look identical in a database. A period
with no committee rows is not a parliament whose members sat on no committees —
it is a period for which the only machine-readable committee source publishes
nothing. Every table below separates *measured zero* from *never published*.

## The coverage boundaries

| Source | Reaches back to | Why it stops there |
| --- | --- | --- |
| DIP `/aktivitaet`, `/vorgang`, `/drucksache`, `/person` | **WP14** and earlier | Full API coverage for every period Bundestrack tracks. |
| Plenary protocol **XML** | **WP18** (22.10.2013) | Earlier sittings are published as PDF only. Verified live: the first page of `/plenarprotokoll` carries `xml_url` on 100/100 records for WP18 and WP19, and **0/100** for WP17 and WP16. This settles open question 6 in `api-research.md` §11.4 — the boundary is exactly WP18, as the spec's note claimed but no pass had confirmed. |
| Named-vote **XLSX** sheets | **2019-09-26**, i.e. mid-WP19 | Measured by walking the listing to exhaustion: of 1 015 entries, 391 carry an XLSX and 624 are PDF-only, and the earliest sheet is 2019-09-26. This **corrects** §4.1's "roughly WP17 (2012/13)", which was inferred by bisection and is wrong by about seven years — it also settles open question 5, where two passes appeared to disagree because one was describing the listing (1 015 entries, reaching 2009) and the other the data sheets (none before 2019). |
| MdB-Stammdaten **roster** | WP1 | The dump holds every MP since 1949. |
| MdB-Stammdaten **committees** | **WP21 only** | Committee membership is published for the current period alone (§6.3, §6.4). WP1–20 carry `Fraktion/Gruppe` entries and nothing else. |
| DIP **committee referrals** (`Ueberweisung`) | **WP18** in practice | Present on 4.8 %–9.7 % of procedure steps for WP18–21 (measured 2026-07-29). ⚠ A different claim from the row above: it says which committees a *bill* was sent to, and names no member. See the note below. |
| DIP **vote explanations** (`§ 31 GO-BT`) | **WP19** confirmed | Published as an `/aktivitaet` carrying `person_id`, the procedure, and a page link into the protocol. Sparse by nature — most ballots carry none (§4.5). |

Two consequences worth stating plainly, because they are permanent rather than
pending:

- **No period before WP21 can have a committee metric.** Not from this source
  and not from any other — §6.3 records Stammdaten as the only machine-readable
  committee source in existence. A historical MP's committee count is `0`
  because nothing was published, and the score's committee component is
  therefore structurally absent for WP14–20 rather than measured at zero.

  **This was checked against `Ueberweisung`, and it still holds.** DIP publishes
  committee *referrals* — which committees a bill was sent to — for WP18–21, and
  Bundestrack now ingests them (`committeeReferrals`). They do **not** narrow
  the gap above by one MP. A referral names a committee and a document; there is
  no person on the record and no field from which one could be derived. So it
  answers "where did this bill go" and never "what did this member do", and the
  committee component of the score stays structurally absent for WP14–20.
  Referral coverage is its own question, answered by the operator-only
  `POST /api/pipeline/coverage/referrals` route (bearer-gated; the wrapper is
  `scripts/verify-coverage.py`) — an empty answer there means the period has
  not been backfilled, where an empty `committees:getCommittees` means
  nothing was ever published. The two must not be read as one.
- **No period before WP18 can have speech data.** Word counts, speech counts
  and the speaking-time proxy are all derived from protocol XML. WP14–17 have
  the sittings but not the machine-readable transcripts.
- **No period before WP19 can have per-MP vote data**, and WP19 only from
  2019-09. This is the boundary that moved: §4.1 had it at ~WP17 by inference,
  and it is actually mid-WP19 by measurement. It bites harder than the other
  two because vote participation is a *scored* component — an MP in WP14–18 has
  a participation rate of 0 not because they missed every ballot but because no
  machine-readable record of any ballot exists for them.

A score is therefore not comparable across the boundary. WP20–21 are scored on
all six components; WP19 lacks committees and most of its votes; WP18 lacks
committees and votes; WP14–17 lack committees, votes and speeches, leaving
motions, questions, reports and sponsorships. The UI must not rank an MP from
WP15 against one from WP21 as though the same measurements stood behind both.

## What each period holds

Record counts are DIP's own `numFound`, read before the backfill ran, and the
roster is the Stammdaten mandate count for the period.

| WP | Span | Roster | Activities | Vorgänge | Drucksachen | Protocols | Speeches | Votes | Committees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | 2025-03-25 – | 635 | 80 472 | 16 386 | 7 353 | 90 | ✅ | ✅ 68 sheets | ✅ 1 791 seats |
| 20 | 2021-10-26 – 2025-03-25 | 772 | 127 965 | 37 666 | 15 153 | 214 | ✅ | ✅ 186 sheets | ❌ never published |
| 19 | 2017-10-24 – 2021-10-26 | 750 | 400 862 | 51 758 | 32 716 | 239 | ✅ | ◐ 137 sheets, from 2019-09 only | ❌ never published |
| 18 | 2013-10-22 – 2017-10-24 | 658 | 121 294 | 28 156 | 13 705 | 245 | ✅ | ❌ PDF only | ❌ never published |
| 17 | 2009-10-27 – 2013-10-22 | 652 | 159 836 | 33 681 | 14 838 | 253 | ❌ no XML | ❌ PDF only | ❌ never published |
| 16 | 2005-10-18 – 2009-10-27 | 642 | 177 418 | 21 533 | 14 163 | 233 | ❌ no XML | ❌ not in the listing | ❌ never published |
| 15 | 2002-10-17 – 2005-10-18 | 628 | 90 102 | 14 520 | 6 019 | 187 | ❌ no XML | ❌ not in the listing | ❌ never published |
| 14 | 1998-10-26 – 2002-10-17 | 699 | 96 106 | 17 737 | 10 016 | 255 | ❌ no XML | ❌ not in the listing | ❌ never published |

The sheet counts are what the period filter selects out of the listing, so they
are also what each backfill will download. The listing itself reaches back only
to 2009-12-03, which is why WP14–16 are marked *not in the listing* rather than
*PDF only*: for those periods there is no entry at all, in either format.

WP19 is the outlier at 400 862 activities — over three times WP20's — and is
the longest single backfill by a wide margin.

The period spans are derived from the mandate dates in the Stammdaten dump
(`StammdatenDump.wahlperiode_window`) rather than from a table of election
dates, so they stay correct without a second source of truth to maintain.

## Scores

A backfilled period needs `scores --wp N --all-months`, not `scores --wp N`.
The plain form writes only the period total, and the nightly Convex sweep
recomputes the *current* calendar month — so every month of a closed period
would stay unwritten. The profile trend graphs read exactly those monthly rows
and mark a missing one as *not computed* rather than as a zero
(`getMonthlyScoresByMP`), which is honest but empty.

`scripts/historical-backfill.sh` does both, per period, in one process.

## What the UI does with a backfilled period

**Every period-bound page now takes one from the URL.** This section recorded
the opposite until the period selector landed, and the original finding is worth
keeping because it names the failure mode: a backfill that "worked" and a
backfill nobody can see look identical from the browser.

What it looked like before:

- `app/mps/page.tsx`, `app/mps/[id]/page.tsx` and the MP table all passed the
  `CURRENT_WAHLPERIODE = 21` constant from `lib/bundestag.ts`. Nothing accepted
  a period from the URL or from a control.
- `convex/mps.ts` exported `getMPMandates` — documented as "the profile page's
  period switcher", returning every period a person served in — and **no
  component called it**. The backend for browsing history existed; the front end
  did not.

### The contract now

- **`?wp=N` scopes the page**, on `/mps`, `/mps/[id]`, `/rankings`, `/feed`,
  `/seating`, `/parties`, `/parties/[party]`, `/votes`, `/inquiry-quorum` and
  `/search`. The parameter is `/search`'s own convention, promoted rather than
  replaced — `lib/period.ts` is the one parser and href builder, so no page can
  disagree with another about what `?wp=21.5` means.
- **An absent parameter means the current period**, resolved from the roster by
  `newestWahlperiode` exactly as before. Switching *back* to the current period
  writes no parameter, so a URL never pins a chamber that stops sitting — the
  staleness `getCurrentWahlperiode` exists to prevent, which a hardcoded
  `?wp=21` in every link would have reintroduced through the address bar.
- **A current profile URL is unchanged.** `/mps/bt-0001` still resolves to the
  current mandate; the parameter is additive.
- **`getMPMandates` is wired**, to the profile's period switcher, which is what
  it was written for. A profile offers the periods that person actually sat in,
  so every option is a real page.
- **`mps.listPeriods` is the single source** for which periods exist, how many
  mandates each holds, and whether each has been scored. `/search`'s filter
  reads it too, so the set offered there is the set offered everywhere.

### Three absences, told apart

The distinction this document opens with is now made on screen:

| State | What it means | What the UI does |
|---|---|---|
| Source never published it | Permanent — committees before the current period, speeches before WP18, votes before 2019-09 | A note beside the zero, naming the boundary |
| Period not backfilled | This deployment has not run it; the address is valid | Says so and lists the periods that are loaded. **Not a 404** |
| Person did not sit | The mandate does not exist in that period | Names them, and links the periods they did sit in |

The unscored case is a fourth and is called out separately, because a
backfilled-but-unswept period renders every leaderboard empty and empty reads as
an idle chamber. See "Scores" above for why that is the *normal* state of a
fresh backfill rather than an edge case.

### A pre-existing discrepancy this exposed

`getChamberStats` reports 642 MPs for WP21 where §6.2's reconciliation says
630, and `getFractionSizes` sums to 647 mandate rows against the 635 the
Stammdaten dump holds. Both figures predate this backfill — they are read off
WP21 rows written by earlier runs — and both are larger than the source, which
points at ingested rows rather than at the counting. Not investigated here; it
is a WP21 data question, not a historical-coverage one, and fixing the count
would have hidden it.

## Running a backfill

```bash
scripts/historical-backfill.sh 20 19 18 17 16 15 14
```

One process and one period at a time, because the pacer that keeps the Enodia
WAF from IP-blocking every `bundestag.de` host is process-wide (§2.6). Two
sweeps side by side defeat it, and so does a sweep running beside any other
script that fetches from those hosts.

A period that fails does not stop the rest — every write is an upsert, so
re-running one period is cheap, and the driver's summary names the ones that
need it.
