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
| Named-vote **XLSX** sheets | ~**WP17** (2012/13) | The listing's older entries carry a PDF and no data sheet (§4.1). |
| MdB-Stammdaten **roster** | WP1 | The dump holds every MP since 1949. |
| MdB-Stammdaten **committees** | **WP21 only** | Committee membership is published for the current period alone (§6.3, §6.4). WP1–20 carry `Fraktion/Gruppe` entries and nothing else. |

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

## What each period holds

Record counts are DIP's own `numFound`, read before the backfill ran, and the
roster is the Stammdaten mandate count for the period.

| WP | Span | Roster | Activities | Vorgänge | Drucksachen | Protocols | Speeches | Votes | Committees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | 2025-03-25 – | 635 | 80 472 | 16 386 | 7 353 | 90 | ✅ | ✅ | ✅ 1 791 seats |
| 20 | 2021-10-26 – 2025-03-25 | 772 | 127 965 | 37 666 | 15 153 | 214 | ✅ | ✅ | ❌ never published |
| 19 | 2017-10-24 – 2021-10-26 | 750 | 400 862 | 51 758 | 32 716 | 239 | ✅ | ✅ | ❌ never published |
| 18 | 2013-10-22 – 2017-10-24 | 658 | 121 294 | 28 156 | 13 705 | 245 | ✅ | ✅ | ❌ never published |
| 17 | 2009-10-27 – 2013-10-22 | 652 | 159 836 | 33 681 | 14 838 | 253 | ❌ no XML | ◐ partial | ❌ never published |
| 16 | 2005-10-18 – 2009-10-27 | 642 | 177 418 | 21 533 | 14 163 | 233 | ❌ no XML | ❌ PDF only | ❌ never published |
| 15 | 2002-10-17 – 2005-10-18 | 628 | 90 102 | 14 520 | 6 019 | 187 | ❌ no XML | ❌ PDF only | ❌ never published |
| 14 | 1998-10-26 – 2002-10-17 | 699 | 96 106 | 17 737 | 10 016 | 255 | ❌ no XML | ❌ PDF only | ❌ never published |

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
