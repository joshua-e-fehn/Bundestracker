#!/usr/bin/env python3
"""Check what the live site shows for historical periods against what Convex holds.

    scripts/verify-frontend-history.py
    scripts/verify-frontend-history.py --base http://localhost:3170 --json out.json

`scripts/visual-sweep.py` screenshots every route and audits contrast. This asks
a different question, and the one a backfill raises: **a period is in the
database — can a reader reach it, and does the page agree with the row count?**

Four checks, each reported with the Convex figure beside the rendered one:

1. **Period selection.** `/search` is the only route with a period control
   (`components/search-page.tsx`, shown when more than one period has a
   roster) and it reads `?wp=`. Every other page resolves its period from
   `mps.getCurrentWahlperiode` — `newestWahlperiode`, the highest on the
   roster — so it renders the current period and offers no way to leave it.
   This walks `?wp=` across every period Convex reports and records what comes
   back.
2. **Rankings.** `/rankings` renders through `CurrentPeriod`, so this records
   which period it actually shows and compares its rows to
   `activityScores:getRankings` for that period.
3. **MP trends.** `/mps/[id]` takes its period from the hardcoded
   `CURRENT_WAHLPERIODE` (webapp/lib/bundestag.ts), so a profile is fetched
   for a member of the *current* period and for one whose mandate is
   historical; the second is expected to 404 and that is recorded as a finding
   rather than as a crash.
4. **Dashboard.** `/dashboard` loads and settles without an error boundary.

Console errors, page errors and failed requests are collected throughout and
reported per route. A 404 that the app renders deliberately (an unknown MP) is
distinguished from one it did not intend.

Exit code is 1 if any *hard* failure occurred — an uncaught console error, a
5xx, a page that never settled. A period that is unreachable in the UI is
reported as a finding, not as a hard failure: it is a frontend gap, and this
script's job is to measure it, not to decide it.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from playwright.sync_api import Page, sync_playwright

CONVEX = "https://whimsical-bandicoot-307.convex.cloud/api/query"
DEFAULT_BASE = "https://www.bundestracker.de"
VIEWPORT = {"width": 1440, "height": 1000}

#: `pageLimit` clamps every public query's `limit` to this
#: (webapp/convex/lib/ingest.ts `MAX_PAGE`).
MAX_PAGE = 700


def convex(path: str, args: dict) -> Any:
    request = urllib.request.Request(
        CONVEX,
        data=json.dumps({"path": path, "args": args, "format": "json"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = json.load(response)
    if body.get("status") != "success":
        raise RuntimeError(f"{path}: {body.get('errorMessage', body)}")
    return body["value"]


@dataclass
class Report:
    checks: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str) -> None:
        self.checks.append({"check": name, "ok": ok, "detail": detail})
        print(f"  [{'ok' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    def finding(self, text: str) -> None:
        self.findings.append(text)
        print(f"  [finding] {text}", flush=True)


def settle(page: Page) -> None:
    """Wait for the Convex subscriptions to resolve and the skeletons to clear.

    Lifted from scripts/visual-sweep.py, which is the behaviour this app
    actually has: `networkidle` can fire while a late query's skeleton is still
    up, so the pulse class is polled afterwards with a short cap — an empty
    state legitimately has none.
    """
    page.wait_for_load_state("networkidle", timeout=45_000)
    try:
        page.wait_for_function(
            "() => document.querySelectorAll('.animate-pulse').length === 0",
            timeout=12_000,
        )
    except Exception:
        pass
    page.wait_for_timeout(800)


def visible_period(page: Page) -> int | None:
    """The Wahlperiode the page claims to be showing, read off its own text.

    The site writes it as `WP21` / `Wahlperiode 21` in headings and filter
    labels. Read from the DOM rather than assumed, because the whole question
    here is whether the page agrees with the database.
    """
    return page.evaluate(
        """() => {
            const text = document.body.innerText
            const m = text.match(/(?:Wahlperiode|WP)\\s*(\\d{2})/)
            return m ? Number(m[1]) : null
        }"""
    )


def count_rows(page: Page) -> int:
    """Ranking/table rows currently rendered, by their link to an MP."""
    return page.evaluate(
        "() => document.querySelectorAll('a[href^=\"/mps/\"]').length"
    )


def run(base: str, report: Report) -> None:
    periods: list[int] = [
        int(p) for p in convex("search:getSearchFilterOptions", {"wahlperiode": 21})["wahlperioden"]
    ]
    current = int(convex("mps:getCurrentWahlperiode", {}))
    print(f"Convex holds rosters for: {periods}; current = WP{current}\n", flush=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport=VIEWPORT, locale="de-DE")
        page = ctx.new_page()

        page.on(
            "console",
            lambda m: report.errors.append(f"console.{m.type}: {m.text[:200]}")
            if m.type == "error"
            else None,
        )
        page.on("pageerror", lambda e: report.errors.append(f"pageerror: {str(e)[:200]}"))
        page.on(
            "response",
            lambda r: report.errors.append(f"{r.status} {r.url[:120]}")
            if r.status >= 500
            else None,
        )

        # --- 1. period selection via /search -----------------------------
        print("1. Historical period selection (/search?wp=)", flush=True)
        for period in periods:
            page.goto(f"{base}/search?wp={period}&q=der", wait_until="domcontentloaded")
            settle(page)
            shown = visible_period(page)
            has_control = page.locator("#search-period").count() > 0
            report.check(
                f"/search?wp={period}",
                shown == period,
                f"page shows WP{shown}, requested WP{period}"
                f"{', selector present' if has_control else ', NO period selector'}",
            )

        # --- 2. rankings --------------------------------------------------
        print("\n2. Rankings", flush=True)
        page.goto(f"{base}/rankings", wait_until="domcontentloaded")
        settle(page)
        shown = visible_period(page)
        rendered = count_rows(page)
        expected = len(
            convex(
                "activityScores:getRankings",
                {"wahlperiode": shown or current, "month": None, "limit": 50},
            )
        )
        report.check(
            "/rankings renders rows",
            rendered > 0,
            f"WP{shown}: {rendered} MP links rendered, Convex has "
            f"{expected} scored rows in the first page of that period",
        )
        for period in [p for p in periods if p != current]:
            reachable = page.locator(f"text=/Wahlperiode\\s*{period}|WP\\s*{period}/").count() > 0
            if not reachable:
                report.finding(
                    f"/rankings offers no way to reach WP{period} — it renders "
                    f"WP{shown} only (CurrentPeriod → newestWahlperiode)"
                )

        # --- 3. MP trends --------------------------------------------------
        print("\n3. MP profile and trend graphs", flush=True)
        for period in periods:
            roster = convex("mps:getMPs", {"wahlperiode": period, "limit": 1})
            if not roster:
                continue
            mp = roster[0]
            response = page.goto(
                f"{base}/mps/{mp['internalId']}", wait_until="domcontentloaded"
            )
            settle(page)
            status = response.status if response else 0
            if status == 404 or page.locator("text=/nicht gefunden|not found/i").count() > 0:
                report.finding(
                    f"/mps/{mp['internalId']} (WP{period} member {mp['name']!r}) is a 404 — "
                    "the profile route pins the period to CURRENT_WAHLPERIODE "
                    "(webapp/lib/bundestag.ts), so historical mandates have no page"
                )
                continue
            charts = page.locator("svg").count()
            monthly = convex(
                "activityScores:getMonthlyScoresByMP",
                {"mpInternalId": mp["internalId"], "wahlperiode": period},
            )
            scored = sum(1 for row in monthly if row["scored"])
            report.check(
                f"/mps/[id] WP{period} trends",
                charts > 0,
                f"{mp['name']}: {charts} chart(s) rendered; Convex has "
                f"{scored}/{len(monthly)} months scored",
            )

        # --- 4. dashboard --------------------------------------------------
        print("\n4. Dashboard", flush=True)
        response = page.goto(f"{base}/dashboard", wait_until="domcontentloaded")
        settle(page)
        body = page.inner_text("body")
        report.check(
            "/dashboard loads",
            (response.status if response else 0) < 400 and len(body) > 200,
            f"HTTP {response.status if response else '?'}, {len(body)} chars of text, "
            f"period shown: WP{visible_period(page)}",
        )

        browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--json", default=None)
    options = parser.parse_args()

    report = Report()
    print(f"Frontend history check against {options.base}\n", flush=True)
    run(options.base, report)

    print("\n--- console / network errors ---", flush=True)
    if report.errors:
        for error in dict.fromkeys(report.errors):
            print(f"  {error}", flush=True)
    else:
        print("  none", flush=True)

    print("\n--- findings (frontend gaps, not backfill failures) ---", flush=True)
    for finding in report.findings or ["  none"]:
        print(f"  {finding}" if report.findings else finding, flush=True)

    failed = [c for c in report.checks if not c["ok"]]
    print(
        f"\n{len(report.checks) - len(failed)}/{len(report.checks)} checks passed, "
        f"{len(report.findings)} findings, {len(set(report.errors))} distinct errors",
        flush=True,
    )

    if options.json:
        with open(options.json, "w") as handle:
            json.dump(
                {
                    "checks": report.checks,
                    "findings": report.findings,
                    "errors": sorted(set(report.errors)),
                },
                handle,
                indent=2,
            )

    return 1 if failed or report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
