#!/usr/bin/env python3
"""
Screenshot every Bundestrack route in both themes, and check what a screenshot
cannot: text contrast.

## Why a script rather than a browser session

The brief asks for every page in both modes, which is 2 x N screenshots plus a
readability judgement on each. Eyeballing 20+ images finds a blank page but
reliably misses the thing that actually breaks when a palette changes — a label
that is technically visible at 2.8:1. So the sweep does both: it writes the
images for a human to look at, *and* walks the DOM computing WCAG contrast for
every text node, which is the part an eye is bad at and arithmetic is good at.

## How the theme is set

`localStorage.theme`, written before the first paint, because that is next-themes'
own storage key (components/providers/theme-provider.tsx) and its blocking
pre-paint script reads it to set the `.dark` class. Setting the class directly
would be undone by that script on the next navigation; setting the OS-level
`color_scheme` would only work through "system" and would not exercise the
explicit choice a reader makes with the toggle.

The light pass deliberately writes `"light"` rather than clearing the key: it
must test what the *toggle* produces, not only what a fresh visitor gets. The
default is asserted separately by `--check-default`, which clears storage and
reads back the resolved class.

## Contrast

`contrastRatio` implements WCAG 2.1 relative luminance over the *resolved*
colours — `getComputedStyle` returns rgb() even when the author wrote oklch(),
so no colour-space maths is needed here. The background is resolved by walking
up the ancestor chain to the first non-transparent one, which is what the
browser itself paints; a naive `getComputedStyle(el).backgroundColor` is
`rgba(0,0,0,0)` for nearly every text node and would compare against black.

Elements are skipped when they are invisible, empty, or off-screen. Two
thresholds, matching WCAG AA: 3.0 for large text (>=24px, or >=18.66px bold),
4.5 for everything else.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# Every route the brief names. `/settings` is absent from `app/` — the follow
# list and the custom score weightings live on the MP profile and the rankings
# page instead — so it is listed here with `optional` and reported as skipped
# rather than silently dropped or noisily failed.
ROUTES: list[tuple[str, str]] = [
    ("home", "/"),
    ("mps", "/mps"),
    ("mp-detail", None),  # resolved at runtime from the roster
    ("votes", "/votes"),
    ("vote-detail", None),  # resolved at runtime from the vote list
    ("rankings", "/rankings"),
    ("seating", "/seating"),
    ("feed", "/feed"),
    ("sign-in", "/sign-in"),
    ("not-found", "/this-route-does-not-exist"),
]

OPTIONAL_ROUTES: list[tuple[str, str]] = [("settings", "/settings")]

THEMES = ("light", "dark")

VIEWPORT = {"width": 1440, "height": 1000}
MOBILE_VIEWPORT = {"width": 390, "height": 844}


CONTRAST_JS = r"""
() => {
  const parseRGB = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const over = (fg, bg) => {
    // Source-over compositing, for a semi-transparent foreground or backdrop.
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  };

  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // The painted background behind an element: the first ancestor with a
  // non-transparent background, composited down. Falls back to the canvas white
  // / body colour at the root.
  const backdrop = (el) => {
    let node = el;
    const stack = [];
    while (node && node.nodeType === 1) {
      const bg = parseRGB(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        stack.push(bg);
        if (bg.a >= 1) break;
      }
      node = node.parentElement;
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };

  const results = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent || "").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);

    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) < 0.1) continue;
    // sr-only: clipped to a 1px box. Present for screen readers, never painted,
    // so its contrast is not a defect.
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;

    const fgRaw = parseRGB(cs.color);
    if (!fgRaw) continue;
    const bg = backdrop(el);
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;

    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3.0 : 4.5;
    const r = ratio(fg, bg);

    if (r < required) {
      results.push({
        text: text.slice(0, 70),
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 90),
        color: cs.color,
        background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        fontSize: size,
        fontWeight: weight,
        ratio: Math.round(r * 100) / 100,
        required,
      });
    }
  }
  return results;
}
"""


@dataclass
class Report:
    shots: list[str] = field(default_factory=list)
    contrast: dict[str, list[dict]] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    default_theme: str | None = None


def set_theme(page: Page, base: str, theme: str) -> None:
    """Write next-themes' storage key, then load so its pre-paint script reads it."""
    page.goto(base, wait_until="domcontentloaded")
    page.evaluate("(t) => localStorage.setItem('theme', t)", theme)


def settle(page: Page) -> None:
    """Wait for the Convex subscriptions to resolve and the skeletons to clear."""
    page.wait_for_load_state("networkidle", timeout=45_000)
    # The skeletons animate, so `networkidle` can fire while they are still up
    # for a query that resolved late. Poll for their absence with a short cap:
    # an empty state legitimately has none and must not block the sweep.
    try:
        page.wait_for_function(
            "() => document.querySelectorAll('.animate-pulse').length === 0",
            timeout=12_000,
        )
    except Exception:
        pass
    page.wait_for_timeout(900)


def discover_detail_routes(page: Page, base: str) -> dict[str, str]:
    """The first MP and the first ballot, so the [id] pages get real content."""
    found: dict[str, str] = {}

    page.goto(f"{base}/mps", wait_until="domcontentloaded")
    settle(page)
    href = page.evaluate(
        "() => document.querySelector('a[href^=\"/mps/\"]')?.getAttribute('href') ?? null"
    )
    if href:
        found["mp-detail"] = href

    page.goto(f"{base}/votes", wait_until="domcontentloaded")
    settle(page)
    href = page.evaluate(
        "() => document.querySelector('a[href^=\"/votes/\"]')?.getAttribute('href') ?? null"
    )
    if href:
        found["vote-detail"] = href

    return found


def check_default_theme(page: Page, base: str) -> str:
    """What a first-time visitor gets: storage cleared, class read back."""
    page.goto(base, wait_until="domcontentloaded")
    page.evaluate("() => localStorage.clear()")
    page.goto(base, wait_until="domcontentloaded")
    page.wait_for_timeout(700)
    return page.evaluate(
        "() => document.documentElement.classList.contains('dark') ? 'dark' : 'light'"
    )


def sweep(base: str, out: Path, mobile: bool) -> Report:
    report = Report()
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = browser.new_context(
            viewport=MOBILE_VIEWPORT if mobile else VIEWPORT,
            device_scale_factor=1,
            # The site negotiates its locale from this header (app/layout.tsx),
            # and German is the default the screenshots should show.
            locale="de-DE",
            extra_http_headers={"Accept-Language": "de-DE,de;q=0.9"},
        )
        page = ctx.new_page()
        page.on(
            "console",
            lambda m: report.errors.append(f"console.{m.type}: {m.text[:200]}")
            if m.type == "error"
            else None,
        )
        page.on("pageerror", lambda e: report.errors.append(f"pageerror: {str(e)[:200]}"))

        report.default_theme = check_default_theme(page, base)

        detail = discover_detail_routes(page, base)

        routes: list[tuple[str, str]] = []
        for name, path in ROUTES:
            resolved = path if path is not None else detail.get(name)
            if resolved is None:
                report.skipped.append(f"{name}: no row found to link to")
                continue
            routes.append((name, resolved))

        for name, path in OPTIONAL_ROUTES:
            resp_ok = False
            try:
                r = page.goto(f"{base}{path}", wait_until="domcontentloaded")
                resp_ok = r is not None and r.status == 200
            except Exception:
                resp_ok = False
            if resp_ok:
                routes.append((name, path))
            else:
                report.skipped.append(f"{name}: {path} is not a route in app/")

        suffix = "-mobile" if mobile else ""

        for theme in THEMES:
            set_theme(page, base, theme)
            for name, path in routes:
                key = f"{name}-{theme}{suffix}"
                try:
                    page.goto(f"{base}{path}", wait_until="domcontentloaded")
                    settle(page)

                    actual = page.evaluate(
                        "() => document.documentElement.classList.contains('dark')"
                        " ? 'dark' : 'light'"
                    )
                    if actual != theme:
                        report.errors.append(
                            f"{key}: theme did not apply (wanted {theme}, got {actual})"
                        )

                    shot = out / f"{key}.png"
                    page.screenshot(path=str(shot), full_page=True)
                    report.shots.append(str(shot))

                    issues = page.evaluate(CONTRAST_JS)
                    if issues:
                        report.contrast[key] = issues
                except Exception as exc:  # noqa: BLE001 - reported, not raised
                    report.errors.append(f"{key}: {type(exc).__name__}: {exc}")

        browser.close()

    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3170")
    ap.add_argument("--out", default="/tmp/bundestrack-shots")
    ap.add_argument("--mobile", action="store_true")
    ap.add_argument("--json", default=None, help="write the machine-readable report here")
    args = ap.parse_args()

    report = sweep(args.base, Path(args.out), args.mobile)

    print(f"default theme (fresh visitor): {report.default_theme}")
    print(f"screenshots: {len(report.shots)} -> {args.out}")

    if report.skipped:
        print("\nskipped:")
        for s in report.skipped:
            print(f"  - {s}")

    total = sum(len(v) for v in report.contrast.values())
    print(f"\ncontrast failures: {total} across {len(report.contrast)} page/theme pairs")
    for key, issues in sorted(report.contrast.items()):
        print(f"\n  {key} ({len(issues)}):")
        for i in issues[:12]:
            print(
                f"    {i['ratio']}:1 (needs {i['required']}) "
                f"{i['tag']} {i['fontSize']}px/{i['fontWeight']} "
                f"{i['color']} on {i['background']}"
            )
            print(f"      text: {i['text']!r}")
            print(f"      class: {i['cls']}")
        if len(issues) > 12:
            print(f"    ... and {len(issues) - 12} more")

    if report.errors:
        # Deduplicated: one broken query re-throws on every route and would
        # otherwise bury everything else.
        print(f"\nerrors ({len(report.errors)}):")
        for e in sorted(set(report.errors)):
            print(f"  - {e}")

    if args.json:
        Path(args.json).write_text(
            json.dumps(
                {
                    "defaultTheme": report.default_theme,
                    "shots": report.shots,
                    "contrast": report.contrast,
                    "errors": sorted(set(report.errors)),
                    "skipped": report.skipped,
                },
                indent=2,
            )
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
