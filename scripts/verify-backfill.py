#!/usr/bin/env python3
"""Read back what a historical backfill actually landed, period by period.

A driver's exit code says its stages returned; it does not say the rows are in
Convex. This asks the deployment itself, over the public query API — the same
surface the website reads, so what it reports is what a visitor would see.

    scripts/verify-backfill.py                # WP14 … WP21
    scripts/verify-backfill.py --wp 19 20
    scripts/verify-backfill.py --months       # also probe every month's scores

Per period it reports the roster size, the four chamber totals
(`stats.getChamberStats`), whether period-total score rows exist, and — with
`--months` — how many of the period's months have score rows. The monthly probe
is one query per month, so it is opt-in rather than the default.

Counts marked `+` are floors: `getChamberStats` stops at its own ceiling and
says so rather than guessing (convex/stats.ts `COUNT_CEILING`), and this passes
that distinction through instead of flattening it.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date

DEPLOYMENT = "https://whimsical-bandicoot-307.convex.cloud"

#: Bounds from the Stammdaten dump's own `wahlperiode_window`, resolved once
#: rather than re-downloading a ~950 KB zip per run — and, more to the point,
#: rather than making a request to bundestag.de while a backfill is running
#: against the same WAF-fronted host (memory: bundestag-waf-enodia).
PERIOD_WINDOWS: dict[int, tuple[date, date | None]] = {
    21: (date(2025, 3, 25), None),  # open — the current period
    20: (date(2021, 10, 26), date(2025, 3, 25)),
    19: (date(2017, 10, 24), date(2021, 10, 26)),
    18: (date(2013, 10, 22), date(2017, 10, 24)),
    17: (date(2009, 10, 27), date(2013, 10, 22)),
    16: (date(2005, 10, 18), date(2009, 10, 27)),
    15: (date(2002, 10, 17), date(2005, 10, 18)),
    14: (date(1998, 10, 26), date(2002, 10, 17)),
}

#: What each period's *sources* can carry, so a zero can be read correctly.
#: Protocol XML starts at WP18 (pipeline/src/bundestrack/api/protocols.py
#: `FIRST_XML_WAHLPERIODE`), vote data sheets at roughly WP17 (§4.1 — earlier
#: ballots are PDF-only), and Stammdaten publishes committees for the current
#: period alone (§6.4).
FIRST_XML_WAHLPERIODE = 18
FIRST_SHEET_WAHLPERIODE = 17


def months_in(start: date, end: date | None) -> list[str]:
    """Every `YYYY-MM` a period spans. An open end yields nothing.

    Mirrors `bundestrack.pipeline.sync.months_in`, which is the definition the
    scoring itself uses; duplicated here only so this script stays runnable
    without the pipeline package importable.
    """
    if end is None:
        return []
    months: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def query(path: str, args: dict) -> object:
    """One public Convex query. Raises on anything but a success envelope."""
    request = urllib.request.Request(
        f"{DEPLOYMENT}/api/query",
        data=json.dumps({"path": path, "args": args, "format": "json"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = json.load(response)
    if body.get("status") != "success":
        raise RuntimeError(f"{path} failed: {body.get('errorMessage', body)}")
    return body["value"]


def count_str(stat: dict) -> str:
    """`5000+` where the count is a floor, so a ceiling never reads as a total."""
    return f"{int(stat['count'])}{'' if stat['exact'] else '+'}"


#: `pageLimit` clamps every public query's `limit` to this (convex/lib/ingest.ts
#: `MAX_PAGE`). Asking for more is not an error and not a bigger page — it is
#: silently this many, which is why a WP20 roster of 736 first read back as a
#: suspiciously round 700.
MAX_PAGE = 700


def scored_rows(
    wahlperiode: int, month: str | None, cap: int = 4000
) -> tuple[int, bool]:
    """How many MPs have a score row for this period/month, and whether it is exact.

    `getRankings` reads the score index directly and takes a slice, so this
    counts rows that exist rather than members who ought to have one. It is
    read from both ends because the query offers no cursor: `desc` gives the
    top `MAX_PAGE` and `asc` the bottom, and a period whose rows fit in the two
    together is counted exactly by deduplicating them. Beyond that the answer
    is a floor and says so.
    """
    seen: set[str] = set()
    for direction in ("desc", "asc"):
        rows = query(
            "activityScores:getRankings",
            {
                "wahlperiode": wahlperiode,
                "month": month,
                "limit": MAX_PAGE,
                "direction": direction,
            },
        )
        seen.update(row["mpInternalId"] for row in rows)  # type: ignore[index,union-attr]
        # A short page is the whole board from this end, so one direction
        # settles it and the second is not worth the query.
        if len(rows) < MAX_PAGE:  # type: ignore[arg-type]
            return len(seen), True
        if len(seen) >= cap:
            break
    # Both ends came back full. If their union is smaller than the two pages
    # laid end to end, they overlap in the middle — and two overlapping slices
    # taken from opposite ends of one ordered index cover all of it, so the
    # union is the whole board rather than a floor. A chamber of 630-odd is
    # always this case; the floor is what a roster past 1 400 would get.
    return len(seen), len(seen) < 2 * MAX_PAGE


def month_scored(wahlperiode: int, month: str) -> bool:
    """Whether *any* MP has a score row for this month.

    A one-row page, because that is the whole question: `--months` asks which
    months the sweep reached, and a month it reached has 600-odd rows while one
    it missed has none. Counting them would be 600× the reads to answer a
    yes/no.
    """
    rows = query(
        "activityScores:getRankings",
        {"wahlperiode": wahlperiode, "month": month, "limit": 1},
    )
    return bool(rows)


#: The short forms `transform.normalise_fraktion` maps every source spelling to
#: (`FRAKTION_PATTERNS`), plus the no-group status. Anything else in the roster
#: is a spelling that fell through — the function passes it through and logs,
#: rather than mapping it to `Fraktionslos` and quietly moving an MP out of
#: their group, so the wrong value reaches the database and only a read like
#: this one finds it.
KNOWN_FRAKTIONEN = {
    "CDU/CSU",
    "SPD",
    "BÜNDNIS 90/DIE GRÜNEN",
    "AfD",
    "FDP",
    "Die Linke",
    "Fraktionslos",
}


def unmapped_fraktionen(periods: list[int]) -> dict[int, set[str]]:
    """Group spellings in the roster that `normalise_fraktion` did not map.

    Worth checking per period rather than trusting the pattern list: the
    wording changes between Wahlperioden — that is the reason the patterns are
    substring matches and not an equality table — and a group that fails to map
    is a value the seating order, the rankings filter and the UI all fail to
    match. WP20's `Gruppe BSW …` is a real group and expected to appear here;
    it is listed so a reader can tell it apart from a mis-parse.
    """
    found: dict[int, set[str]] = {}
    for wahlperiode in periods:
        try:
            rows = query("mps:getFractionSizes", {"wahlperiode": wahlperiode})
        except (urllib.error.URLError, RuntimeError):
            continue
        odd = {
            str(row["fraktion"])
            for row in rows  # type: ignore[union-attr]
            if str(row["fraktion"]) not in KNOWN_FRAKTIONEN
        }
        if odd:
            found[wahlperiode] = odd
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--wp", type=int, nargs="*", help="Periods to check. Default: 14…21."
    )
    parser.add_argument(
        "--months",
        action="store_true",
        help="Also probe every month of every period for score rows (one query each).",
    )
    options = parser.parse_args()
    periods = options.wp or sorted(PERIOD_WINDOWS, reverse=True)

    print(
        f"{'WP':>4} {'MPs':>6} {'ballots':>8} {'motions':>8} {'questions':>10} "
        f"{'speeches':>9} {'scored':>7} {'months':>12}"
    )
    print("-" * 74)

    incomplete: list[str] = []
    for wahlperiode in periods:
        try:
            stats = query("stats:getChamberStats", {"wahlperiode": wahlperiode})
            totals, totals_exact = scored_rows(wahlperiode, None)
        except (urllib.error.URLError, RuntimeError) as error:
            print(f"{wahlperiode:>4} QUERY FAILED: {error}")
            incomplete.append(f"WP{wahlperiode}:query")
            continue

        month_cell = "-"
        if options.months:
            months = months_in(*PERIOD_WINDOWS[wahlperiode])
            if months:
                covered = sum(1 for m in months if month_scored(wahlperiode, m))
                month_cell = f"{covered}/{len(months)}"
                if covered < len(months):
                    incomplete.append(f"WP{wahlperiode}:months {covered}/{len(months)}")
            else:
                # An open period. Its months are the nightly sweep's job, not a
                # backfill's, so a gap here is not a finding.
                month_cell = "open"

        print(
            f"{wahlperiode:>4} {count_str(stats['mps']):>6} {count_str(stats['namedVotes']):>8} "
            f"{count_str(stats['motions']):>8} {count_str(stats['questions']):>10} "
            f"{count_str(stats['speeches']):>9} "
            f"{f'{totals}' + ('' if totals_exact else '+'):>7} {month_cell:>12}"
        )
        if int(stats["mps"]["count"]) and totals == 0:
            incomplete.append(f"WP{wahlperiode}:no period-total scores")

    unmapped = unmapped_fraktionen(periods)
    if unmapped:
        print()
        print(
            "Unmapped Fraktion spellings — `normalise_fraktion` passed these through:"
        )
        for wahlperiode, values in sorted(unmapped.items(), reverse=True):
            print(f"  WP{wahlperiode}: {', '.join(sorted(values))}")
        # Reported, not failed. A group that maps to nothing is *usually* a
        # spelling `FRAKTION_PATTERNS` has not met, but it is sometimes a real
        # group with no short form — WP20's `Gruppe BSW …` is one, and a
        # Gruppe is constitutionally not a Fraktion, so inventing a short form
        # for it would be a claim the sources do not make. Which of the two a
        # value is takes a human, so this prints it rather than deciding.
        print("  (a real group with no short form reads the same as a mis-parse here)")

    print()
    print("Source limits — a zero below these is absent data, not an idle chamber:")
    print(f"  speeches:    protocol XML starts at WP{FIRST_XML_WAHLPERIODE} (§5.2)")
    print(
        f"  ballots:     vote data sheets start at ~WP{FIRST_SHEET_WAHLPERIODE} (§4.1)"
    )
    print("  committees:  Stammdaten publishes the current period only (§6.4)")

    if incomplete:
        print()
        print(f"INCOMPLETE: {', '.join(incomplete)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
