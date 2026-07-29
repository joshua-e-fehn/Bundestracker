#!/usr/bin/env python3
"""Score every month of a closed electoral period, in parallel, and verify it.

    scripts/score-period.py --wp 19
    scripts/score-period.py --wp 19 --workers 8

`pixi run pipeline scores --wp N --all-months` is the ordinary way to do this
and stays so. This exists for the historical backfill, where two properties of
that path stop being acceptable:

**It is serial.** `ConvexLoader.recompute_scores` walks the cursor one slice at
a time because it must: the route returns `hasMore` and the loop is how a
caller discovers the end. But a slice depends only on the cursor it was handed,
not on the slice before it — so for a *closed* period, whose roster cannot shift
underneath the run, every cursor is known up front and the discovery loop is not
needed. Measured on WP20 2025-03: 97 slices, 140 s serial against 21 s at 8
workers, both writing all 772 rows.

⚠ **The cursor is a member `internalId`, not an offset** (changed with the
period-scoped scoring work). `recomputeScores` seeks with
`.gt("internalId", cursor)` off `by_wahlperiode_and_internalId`, so a slice
costs `batchSize + 1` rows wherever it starts — where the old offset form
re-read every member already scored and cost ~25 000 roster reads to page
through 635. That is *better* for this script, not worse: the boundaries are
still derivable without a prior response, because they are simply the roster's
own ids in index order, and `roster_ids` below reads them. An opaque
`.paginate()` token would have made this script impossible, which is why the
route does not use one.

**It downloads the Stammdaten dump.** `cli.py::_period_months` fetches a
~950 KB zip from `www.bundestag.de` purely to call `wahlperiode_window`. That
is a request to the Enodia-fronted host from a second process, and the pacer
that keeps the WAF from IP-blocking is process-wide
(`api/base.py::_SHARED_PACER`) — so it cannot see it. Running that beside a
live backfill is how the whole host gets blocked (docs/api-research.md §2.6).
The windows here are the same dump's answers, resolved once and written down.

Verifies before returning, because a slice answering 200 is not the same claim
as a member having a score: every month is read back off the score index and a
short one is reported and re-run.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR / "src"))

from bundestrack.config import get_settings
from bundestrack.pipeline.sync import months_in

QUERY_URL = "https://whimsical-bandicoot-307.convex.cloud/api/query"

#: `wahlperiode_window(N)` for every closed period, read off the Stammdaten
#: dump once (2026-07-29) rather than re-downloaded per run — see the header on
#: why that download is the one thing this script must not do.
PERIOD_WINDOWS: dict[int, tuple[date, date]] = {
    20: (date(2021, 10, 26), date(2025, 3, 25)),
    19: (date(2017, 10, 24), date(2021, 10, 26)),
    18: (date(2013, 10, 22), date(2017, 10, 24)),
    17: (date(2009, 10, 27), date(2013, 10, 22)),
    16: (date(2005, 10, 18), date(2009, 10, 27)),
    15: (date(2002, 10, 17), date(2005, 10, 18)),
    14: (date(1998, 10, 26), date(2002, 10, 17)),
}

#: `MAX_SCORE_BATCH` (webapp/convex/activityScores.ts). The route clamps to it,
#: so asking for more is silently this — matching it here keeps the cursor
#: arithmetic honest rather than merely lucky.
BATCH = 8

#: `MAX_PAGE` (convex/lib/ingest.ts) — the ceiling `pageLimit` clamps every
#: public query's `limit` to, silently.
MAX_PAGE = 700


def post(url: str, payload: dict, headers: dict, timeout: int = 180) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def scored_rows(wahlperiode: int, month: str | None) -> int:
    """How many MPs hold a score row, read from both ends of the score index.

    Both ends because `getRankings` has no cursor and `pageLimit` caps a page at
    `MAX_PAGE`: a roster of 772 read one way returns 700 and looks complete.
    Two overlapping slices off one ordered index cover all of it.
    """
    seen: set[str] = set()
    for direction in ("desc", "asc"):
        body = post(
            QUERY_URL,
            {
                "path": "activityScores:getRankings",
                "args": {
                    "wahlperiode": wahlperiode,
                    "month": month,
                    "limit": MAX_PAGE,
                    "direction": direction,
                },
                "format": "json",
            },
            {"Content-Type": "application/json"},
            timeout=120,
        )
        if body.get("status") != "success":
            raise RuntimeError(f"getRankings failed: {body.get('errorMessage', body)}")
        rows = body["value"]
        seen.update(row["mpInternalId"] for row in rows)
        if len(rows) < MAX_PAGE:
            break
    return len(seen)


def roster_ids(wahlperiode: int) -> list[str]:
    """Every `internalId` the period holds, in the order the score cursor walks.

    The cursor is a member id and the route seeks with `.gt("internalId", …)`
    off `by_wahlperiode_and_internalId`, so the boundaries between slices are
    exactly this list read `BATCH` at a time — sorted, because that index is.
    Sorting here rather than trusting `getMPs`' order is what makes a slice
    boundary mean the same thing to this script and to the route.

    ⚠ Not `getChamberStats().mps.count`, which is the **seat** count: it returns
    `peakConcurrentMandates`, the most mandates that overlapped on any one day
    (convex/stats.ts). For WP20 that is 736 against 772 rows, because a seat
    vacated mid-period and refilled is two mandates and one seat. The cursor
    walks a row per *mandate*, so sizing the range by seats stops 36 rows short
    — and silently, since every slice still answers 200. That is why this
    returns the ids themselves rather than a count: a count can be wrong in a
    way that reads as success, and a list of ids cannot be short without the
    members it omits being visibly absent.

    Read off the roster query, which pages, rather than off a count that
    reconciles rows to seats. `getMPs` is capped at `MAX_PAGE` per call and
    offers no cursor, so a period past 700 mandates is walked by Fraktion —
    each is well under the cap and together they partition the roster.
    """
    body = post(
        QUERY_URL,
        {
            "path": "mps:getMPs",
            "args": {"wahlperiode": wahlperiode, "limit": MAX_PAGE},
            "format": "json",
        },
        {"Content-Type": "application/json"},
        timeout=120,
    )
    if body.get("status") != "success":
        raise RuntimeError(f"getMPs failed: {body.get('errorMessage', body)}")
    rows = body["value"]
    if len(rows) < MAX_PAGE:
        return sorted(row["internalId"] for row in rows)

    # The page filled, so there may be more. Sum the Fraktionen instead: the
    # same index, sliced by a field that partitions it.
    fraktionen = {row["fraktion"] for row in rows}
    seen: set[str] = set()
    for fraktion in fraktionen:
        body = post(
            QUERY_URL,
            {
                "path": "mps:getMPs",
                "args": {
                    "wahlperiode": wahlperiode,
                    "fraktion": fraktion,
                    "limit": MAX_PAGE,
                },
                "format": "json",
            },
            {"Content-Type": "application/json"},
            timeout=120,
        )
        if body.get("status") != "success":
            raise RuntimeError(f"getMPs failed: {body.get('errorMessage', body)}")
        page = body["value"]
        if len(page) >= MAX_PAGE:
            raise RuntimeError(
                f"WP{wahlperiode} Fraktion {fraktion!r} filled a {MAX_PAGE}-row page; "
                "the roster cannot be counted exactly this way."
            )
        seen.update(row["internalId"] for row in page)
    return sorted(seen)


class Scorer:
    def __init__(self, wahlperiode: int, workers: int) -> None:
        settings = get_settings()
        self.url = f"{settings.require_convex_http_url()}/api/pipeline/scores/recompute"
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.require_pipeline_api_key()}",
        }
        self.wahlperiode = wahlperiode
        self.workers = workers

    def slice_at(self, cursor: str | None, month: str, size: int = BATCH) -> int:
        """Score the `size` MPs after `cursor`, halving the slice if it is too big.

        `cursor` is the `internalId` to start *after*, or None for the start of
        the roster — the route seeks with `.gt("internalId", cursor)`, so a
        worker handed a boundary id scores exactly the members between it and
        the next boundary. Boundaries come from `roster_ids`, which reads the
        same order the route walks.

        `MAX_SCORE_BATCH` = 8 is a *measured* bound, and the per-MP cost it was
        measured against has since fallen by roughly 5×: `voteParticipation`
        used to collect **all** of an MP's `voteRecords` with no period filter
        and do a `db.get` per record, so every historical period that landed
        raised the cost of scoring every other one. `voteRecords` now carries
        its ballot's period and date, so the read is one bounded index range and
        a backfill no longer moves this number.

        The halving stays anyway. It costs nothing when nothing overflows, and
        the failure it catches — a read-limit 400 — is per *transaction*, so
        fewer MPs per call remains the only lever that helps. A single MP that
        still will not fit is re-raised: that is a real ceiling breach and must
        not be silently skipped, because a skipped MP scores as absent rather
        than as unmeasured.

        ⚠ Halving is only exact when the slice's members are known. With an
        offset cursor the second half was `cursor + half`; with a keyset cursor
        the route must tell us where the first half ended, so the halves are
        walked serially off the returned `nextCursor` rather than computed. That
        is a slower path taken only when a slice overflows, which is now rare.
        """
        try:
            body = post(
                self.url,
                {
                    "wahlperiode": self.wahlperiode,
                    "month": month,
                    "cursor": cursor,
                    "batchSize": size,
                },
                self.headers,
            )
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            if "Too many documents read" not in detail or size <= 1:
                raise RuntimeError(
                    f"cursor {cursor} (batch {size}): {detail[:300]}"
                ) from error
            half = size // 2
            scored = self.slice_at(cursor, month, half)
            # Where the first half stopped, asked of the route rather than
            # guessed: a keyset cursor cannot be advanced by arithmetic.
            probe = post(
                self.url,
                {
                    "wahlperiode": self.wahlperiode,
                    "month": month,
                    "cursor": cursor,
                    "batchSize": half,
                },
                self.headers,
            )
            resume = probe.get("nextCursor")
            if resume is None:
                return scored
            return scored + self.slice_at(str(resume), month, size - half)
        return int(body.get("scored", 0))

    def month(self, month: str, roster: list[str]) -> int:
        """Every slice of one month, concurrently. Returns rows written.

        The boundaries are the roster's own ids: worker *k* starts after
        `roster[k * BATCH - 1]` and scores the `BATCH` members that follow. The
        first slice starts at None, which is the beginning of the period.

        The last boundary is the roster's last id rather than one past the end,
        and it is deliberately included: a period that gained a mandate row since
        `roster` was read would otherwise leave its newest members unscored, and
        a slice that runs past the end scores nobody and costs one request. Same
        headroom the offset form bought with `roster + BATCH`, expressed in the
        cursor's own terms.
        """
        cursors: list[str | None] = [None]
        cursors.extend(roster[index - 1] for index in range(BATCH, len(roster), BATCH))
        if roster:
            cursors.append(roster[-1])
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            return sum(pool.map(lambda c: self.slice_at(c, month), cursors))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wp", type=int, required=True, help="Closed period to score.")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent slices.")
    options = parser.parse_args()

    if options.wp not in PERIOD_WINDOWS:
        # The current period's months are the nightly sweep's job, and a period
        # with no closed window has no month list to enumerate — the same
        # refusal `cli.py::scores` makes rather than silently scoring the total.
        print(
            f"WP{options.wp} has no closed window here. Known: "
            f"{', '.join(f'WP{w}' for w in sorted(PERIOD_WINDOWS, reverse=True))}.",
            file=sys.stderr,
        )
        return 64

    months = months_in(*PERIOD_WINDOWS[options.wp])
    scorer = Scorer(options.wp, options.workers)

    roster = roster_ids(options.wp)
    if not roster:
        print(
            f"WP{options.wp} has no roster — ingest it before scoring.", file=sys.stderr
        )
        return 65

    print(
        f"WP{options.wp}: {len(months)} months × ~{len(roster) // BATCH + 1} slices, "
        f"{options.workers} workers",
        flush=True,
    )
    started = time.time()
    short: list[str] = []

    for index, month in enumerate(months, start=1):
        t0 = time.time()
        try:
            scorer.month(month, roster)
            rows = scored_rows(options.wp, month)
        except (urllib.error.URLError, RuntimeError, OSError) as error:
            # One month must not cost the rest: every write is idempotent, so a
            # failed month is re-runnable and the ones after it are unaffected.
            print(f"  [{index}/{len(months)}] {month} FAILED: {error}", flush=True)
            short.append(month)
            continue
        flag = "" if rows >= roster else f"  ⚠ {rows}/{roster}"
        if rows < roster:
            short.append(month)
        print(
            f"  [{index}/{len(months)}] {month}: {rows} rows in {time.time() - t0:.0f}s"
            f" (elapsed {(time.time() - started) / 60:.0f}m){flag}",
            flush=True,
        )

    totals = scored_rows(options.wp, None)
    print(
        f"WP{options.wp} DONE in {(time.time() - started) / 60:.1f}m — "
        f"period total: {totals}/{roster} rows",
        flush=True,
    )
    if short or totals < roster:
        print(f"WP{options.wp} SHORT MONTHS: {' '.join(short) or '(none)'}", flush=True)
        return 1
    print(f"WP{options.wp} ALL MONTHS COMPLETE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
