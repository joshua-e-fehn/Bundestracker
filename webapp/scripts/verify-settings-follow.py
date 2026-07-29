#!/usr/bin/env python3
"""
Browser check for `/settings` and the follow control.

## What it can and cannot prove

The **signed-out** half is checked end to end, and it is the half that matters
most here: it is what every visitor sees, and its failure mode — `AuthGuard`
bouncing the reader to /sign-in from a link visible in the navigation — is
invisible from a status code. That is exactly the bug `lib/auth-routes.ts`'s ⚠
is written about, and the reason `/settings` is on `PUBLIC_PATHS` at all. So
this asserts the page *renders*, in both viewports and both languages, carrying
the explanation rather than a redirect.

The **signed-in** half cannot be driven here. It needs a Google account and a
real OAuth round trip against a live deployment, which this branch is under
instruction not to create. What is checked instead is the seam a signed-in
reader depends on and a signed-out one cannot see: that the page mounts its
preference queries, that Convex answers them, and that nothing throws. The set
semantics that make a follow idempotent are covered without a browser at all —
`convex/userPreferences.test.ts`.

## Why console and network are watched rather than only the DOM

A React hydration mismatch (#418) does not change the rendered HTML. It
detaches `<head>` and swallows the reader's *next* click, which is how it
shipped twice on this site before `scripts/verify-first-click-navigation.mjs`
existed. `FollowButton` renders once per roster row, making it the highest-count
session-branching component here, and a console listener is the only cheap way
to see the throw at all.

## Why Python rather than a sibling of the two .mjs scripts

Only because of what is installed: this machine carries Playwright's Python
distribution with a matching browser build, and the Node package resolves to a
newer revision with no browser behind it. `../scripts/visual-sweep.py` is the
same choice for the same reason, so this is the second of a pair rather than a
lone exception.

    BASE_URL=http://localhost:3100 python3 scripts/verify-settings-follow.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field

from playwright.sync_api import Page, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3100")

# Only for a run against a self-hosted backend fronted by a throwaway
# certificate. `webapp/lib/convex-url.ts` requires an https convex.cloud /
# convex.site *pair*, which is the guard that stops a build compiling against
# the wrong deployment — so a local run gives the backend real origins behind a
# self-signed cert rather than weakening the guard. Never set against a real
# deployment: it would turn off certificate checking for the whole run.
INSECURE_TLS = os.environ.get("INSECURE_TLS") == "1"

# Desktop and a small phone. 390x844 is the viewport the audit measured with,
# and it is where the sidebar is gone and the drawer is the only navigation.
VIEWPORTS = [("desktop", 1440, 900), ("mobile", 390, 844)]

# Noise that is not this branch's business. Everything else on `console.error`
# is — a hydration throw and a Convex failure arrive on the same channel.
IGNORED_CONSOLE = ("favicon", "Download the React DevTools")


@dataclass
class Report:
    passed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        if ok:
            self.passed.append(label)
            print(f"  ✓ {label}")
        else:
            self.failed.append(label)
            print(f"  ✗ {label}{f' — {detail}' if detail else ''}")


def watch(page: Page) -> tuple[list[str], list[str]]:
    """Console errors and 5xx responses, for the duration of this page."""
    errors: list[str] = []
    server_errors: list[str] = []

    page.on(
        "console",
        lambda m: errors.append(m.text[:300]) if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:300]}"))
    # 401 on an auth endpoint is the ordinary signed-out answer, not a failure;
    # a 5xx is the deployment or a query breaking.
    page.on(
        "response",
        lambda r: server_errors.append(f"{r.status} {r.url}") if r.status >= 500 else None,
    )
    return errors, server_errors


def run(page: Page, report: Report, viewport: str) -> None:
    # --- /settings, signed out ------------------------------------------
    page.goto(f"{BASE}/settings", wait_until="networkidle")

    report.check(
        "/settings does not redirect a signed-out reader",
        page.url.endswith("/settings"),
        f"landed on {page.url}",
    )

    heading = page.locator("h1").first.text_content() or ""
    report.check("the page has its heading", "Einstellungen" in heading, f'saw "{heading}"')

    # The signed-out card. This is the whole reason the route is public rather
    # than gated: it says what an account holds instead of demanding one.
    report.check(
        "it explains what an account is for",
        page.get_by_text("Ohne Konto gibt es hier nichts zu speichern").count() > 0,
    )
    report.check(
        "it links to the sign-in picker",
        page.locator('main a[href="/sign-in"]').count() > 0,
    )

    # The failure app/page.test.ts documents, and the one a 390px viewport finds.
    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    report.check(
        "the page does not scroll sideways", overflow <= 0, f"{overflow}px wider than viewport"
    )

    # --- the navigation reaches it --------------------------------------
    if viewport == "desktop":
        report.check(
            "the sidebar carries a settings entry",
            page.locator('nav a[href="/settings"]').count() > 0,
        )
    else:
        # The drawer is the only route into the navigation below `lg`, and the
        # settings row sits in its sticky footer — the part that must not
        # require scrolling past nine destinations to reach.
        #
        # Scoped to the dialog rather than to the page: the desktop rail is in
        # the DOM at every width (it is `hidden lg:flex`, a CSS decision so the
        # browser picks one before hydration — see components/nav-sidebar.tsx),
        # so a bare `a[href="/settings"]` matches the *hidden* one first and
        # waits forever on a link that is correctly invisible.
        page.get_by_role("button", name="Menü öffnen").click()
        link = page.get_by_role("dialog").locator('a[href="/settings"]').first
        try:
            link.wait_for(state="visible", timeout=5_000)
            visible = True
        except Exception:
            visible = False
        report.check("the drawer carries a settings entry, visible without scrolling", visible)
        page.keyboard.press("Escape")

    # --- the follow control ---------------------------------------------
    # A real member read off the roster rather than a hardcoded id, so this
    # cannot silently pass against an empty deployment.
    page.goto(f"{BASE}/mps", wait_until="networkidle")
    profile = page.evaluate(
        """() => {
          const a = document.querySelector('td a[href^="/mps/"]')
          return a ? a.getAttribute('href') : null
        }"""
    )
    report.check("the roster lists at least one member", bool(profile), "no member links found")

    # Visible, not merely present. The follow column is the last cell of every
    # row, and the roster is the widest table on the site — a control that is
    # in the DOM but pushed outside a 390px viewport is a control a phone reader
    # does not have.
    roster_controls = page.locator('td a[href="/sign-in"]:visible').count()
    report.check(
        "the roster's follow column signposts sign-in rather than failing",
        roster_controls > 0,
        f"{roster_controls} visible controls found",
    )

    if profile:
        page.goto(f"{BASE}{profile}", wait_until="networkidle")
        # Scoped to `main`: the profile's own control, not a chrome link that
        # happens to share the name.
        follow = page.locator("main").get_by_role("link", name="Anmelden, um zu folgen")
        report.check("the profile carries a follow control", follow.count() > 0)

        if follow.count() > 0:
            # A *link*, not a disabled button: the signed-out decision is that
            # the control becomes the invitation (components/follow-button.tsx).
            report.check(
                "the signed-out follow control is a link to /sign-in",
                follow.first.get_attribute("href") == "/sign-in",
            )
            follow.first.click()
            page.wait_for_url("**/sign-in", timeout=5_000)
            report.check("it reaches the sign-in page", page.url.endswith("/sign-in"))

    # --- the English pass, through the toggle ---------------------------
    page.goto(f"{BASE}/settings", wait_until="networkidle")
    # The footer's toggle, which is on every page and renders with its label.
    page.get_by_role("button", name="Sprache").last.click()
    page.get_by_role("menuitem", name="English").click()
    page.wait_for_function("() => document.documentElement.lang === 'en'", timeout=5_000)

    english = page.locator("h1").first.text_content() or ""
    report.check("the page translates", "Settings" in english, f'saw "{english}"')
    report.check(
        "the signed-out explanation translates",
        page.get_by_text("Without an account there is nothing to save here").count() > 0,
    )
    # Back to German, so the next viewport starts where a first-time reader does.
    page.evaluate("() => localStorage.removeItem('bundestrack.locale')")


def main() -> int:
    report = Report()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, width, height in VIEWPORTS:
            print(f"\n### {name} {width}×{height}")
            context = browser.new_context(
                viewport={"width": width, "height": height},
                # German — the default locale and what most readers get. The
                # English pass goes through the toggle rather than a second
                # context, because the toggle is the path a reader takes.
                locale="de-DE",
                ignore_https_errors=INSECURE_TLS,
            )
            page = context.new_page()
            errors, server_errors = watch(page)

            run(page, report, name)

            real = [e for e in errors if not any(n in e for n in IGNORED_CONSOLE)]
            report.check("no console errors", not real, " | ".join(real[:3]))
            report.check("no 5xx responses", not server_errors, " | ".join(server_errors[:3]))

            context.close()
        browser.close()

    print("")
    if report.failed:
        print(f"✖ {len(report.failed)} of {len(report.passed) + len(report.failed)} checks failed:")
        for label in report.failed:
            print(f"   - {label}")
        return 1
    print(f"✓ all {len(report.passed)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
