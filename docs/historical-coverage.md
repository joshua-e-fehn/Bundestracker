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
| **Portraits and contact details** | **WP21 only** | `bundestag.de/abgeordnete/biografien` serves whoever is in office *now* and accepts no period parameter, so for a past chamber it describes the wrong people. The pipeline reads it for the current period only — see below. |
| **Occupation and education** | **WP16** | abgeordnetenwatch, which *is* period-aware and joins by Stammdaten id rather than by name (§4.3), so it enriches historical periods safely. |

Two consequences worth stating plainly, because they are permanent rather than
pending:

- **No period before WP21 can have a committee metric.** Not from this source
  and not from any other — §6.3 records Stammdaten as the only machine-readable
  committee source in existence. A historical MP's committee count is `0`
  because nothing was published, and the score's committee component is
  therefore structurally absent for WP14–20 rather than measured at zero.
- **No period before WP18 can have speech data.** Word counts, speech counts
  and the speaking-time proxy are all derived from protocol XML. WP14–17 have
  the sittings but not the machine-readable transcripts.
- **No period before WP19 can have per-MP vote data**, and WP19 only from
  2019-09. This is the boundary that moved: §4.1 had it at ~WP17 by inference,
  and it is actually mid-WP19 by measurement. It bites harder than the other
  two because vote participation is a *scored* component — an MP in WP14–18 has
  a participation rate of 0 not because they missed every ballot but because no
  machine-readable record of any ballot exists for them.

- **No period before WP21 gets a portrait or contact block.** The enrich stage
  (added by the enrichment PR while this branch was in flight) reads the
  bundestag.de MP listing, which has no period parameter and returns the
  sitting Bundestag whoever asks. Running it against a historical roster would
  match near-nobody — and where a name *did* collide across periods it would
  attach a sitting MP's portrait and constituency office to their predecessor.
  So it is gated on the current period, and a backfill says so in its report
  rather than leaving an empty column that reads as un-fetched. Skipping it
  also saves ~639 biography pages of ~280 KB — ~175 MB per period through a
  WAF that counts bytes (§2.6). abgeordnetenwatch is *not* gated: it joins on
  the Stammdaten id, so occupation and education reach back to WP16.

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

## What the UI does with a backfilled period — today, nothing

The data lands, and every page still shows WP21. This is worth stating plainly
because a backfill that "worked" and a backfill nobody can see look identical
from the browser.

- `app/mps/page.tsx`, `app/mps/[id]/page.tsx` and the MP table all pass the
  `CURRENT_WAHLPERIODE = 21` constant from `lib/bundestag.ts`. Nothing accepts a
  period from the URL or from a control.
- `convex/mps.ts` exports `getMPMandates` — documented as "the profile page's
  period switcher", returning every period a person served in — and **no
  component calls it**. The backend for browsing history exists; the front end
  does not.
- `getCurrentWahlperiode` reads the *newest* ingested period
  (`newestWahlperiode`, ordered descending), so backfilling WP14–20 cannot
  displace WP21 on the home page. Verified live during the WP20 run: it still
  answered `21`.

So the backfill is a data-layer change. Surfacing it needs a period control on
the MP list and profile, wired to `getMPMandates` — a separate piece of work,
and the reason the queries were already written to take a `wahlperiode`
argument rather than assume one.

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
