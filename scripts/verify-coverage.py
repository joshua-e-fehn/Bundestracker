#!/usr/bin/env python3
"""Read the deployment's own coverage counters back through the pipeline door.

The three coverage answers — committee referrals per period, §31 declarations
per period, and the vote-scope migration's remaining rows — used to be public
`query()`s that the UI never called and no operator script ever did either. A
public surface with no product caller is worse than either alone: the
`.collect()` inside each is reachable by anyone who guesses the path, but the
question it answers reaches no one. So they moved behind
`/api/pipeline/coverage/*` with the ingestion bearer key, and this script is
what turns "an internal query kept for operators" into an operator step that
actually runs.

    PIPELINE_API_KEY=… scripts/verify-coverage.py
    scripts/verify-coverage.py --wp 20 21
    scripts/verify-coverage.py --wp 21 --vote-scope-only

Reports one row per period asked, the vote-scope migration's `remaining`
counter (with a `+` when it hit the ceiling), and a non-zero exit code when
any period reads "0 referrals" or "0 explanations" that its sources should
have carried, or when the migration is not complete. That last is deliberate:
`voteScopeCoverage` is the check the post-deploy playbook names and a green
tick from this script is what a human ran instead of the SQL query no operator
was ever going to write.

Coverage boundaries mirror `scripts/verify-backfill.py`: committee referrals
land from WP18 (DIP `Ueberweisung` is available then), §31 declarations from
WP20 (protocol XML carries them from WP18 but the declarations landed as a
routine pipeline output only from WP20). Older periods will legitimately read
zero — that is a source floor rather than a missing backfill, and the report
says so per row instead of failing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# The Settings loader lives in `pipeline/src/bundestrack/config.py`; adding
# that to the path here keeps this script runnable without installing the
# pipeline package. `scripts/verify-*.py` do the same.
PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR / "src"))

from bundestrack.config import ConfigError, get_settings  # noqa: E402

DEFAULT_PERIODS: tuple[int, ...] = (21, 20, 19, 18)

#: Coverage source-floors, matching `scripts/verify-backfill.py`'s constants
#: and `pipeline/src/bundestrack/api/protocols.py` `FIRST_XML_WAHLPERIODE`.
#: A period below one of these that reports zero is a *source* absence rather
#: than a missed backfill.
FIRST_REFERRAL_WAHLPERIODE = 18
FIRST_EXPLANATION_WAHLPERIODE = 20


def coverage_call(base: str, key: str, path: str, body: dict) -> dict:
    """One POST to `/api/pipeline/coverage/<path>`, decoding a JSON reply.

    `pipelineRoute` in webapp/convex/http.ts returns `{error: "…"}` for a bad
    key (401), a validator failure (400) or an unknown route (404). Bubbling
    the message is how a rotated key surfaces as "rotate the key" rather than
    as an unhelpful stack trace.
    """
    request = urllib.request.Request(
        f"{base}/api/pipeline/coverage/{path}",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
        except (ValueError, json.JSONDecodeError):
            payload = {"error": error.reason}
        status = error.code
        message = payload.get("error", payload)
        if status == 401:
            raise SystemExit(
                "401 from /api/pipeline/coverage — PIPELINE_API_KEY does not match the "
                "value the deployment holds. Rotate with `bunx convex env set "
                "PIPELINE_API_KEY \"…\"` on the deployment and re-export it here."
            ) from error
        raise SystemExit(f"HTTP {status} from coverage/{path}: {message}") from error


def format_remaining(scope: dict) -> str:
    """`remaining=<n>` or `<n>+` when the ceiling bit it — same shape the
    `getChamberStats` cards use for a floor, so a reader who has seen those
    already knows what the trailing `+` means."""
    suffix = "+" if scope.get("atLeastCeiling") else ""
    return f"{scope['remaining']}{suffix}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--wp",
        type=int,
        nargs="*",
        default=list(DEFAULT_PERIODS),
        help="periods to check (default: 21 20 19 18)",
    )
    parser.add_argument(
        "--vote-scope-only",
        action="store_true",
        help="skip the per-period reads and only run the migration check",
    )
    args = parser.parse_args()

    try:
        settings = get_settings()
        base = settings.require_convex_http_url()
    except ConfigError as error:
        raise SystemExit(str(error)) from error

    key = os.environ.get("PIPELINE_API_KEY") or getattr(settings, "pipeline_api_key", None)
    if not key:
        raise SystemExit(
            "PIPELINE_API_KEY is not set. Export it or add it to pipeline/.env; "
            "the value must match the one on the deployment "
            '(`bunx convex env set PIPELINE_API_KEY "…"`).'
        )

    incomplete: list[str] = []

    if not args.vote_scope_only:
        # Column widths pinned to what a wide row looks like; a run against a
        # future period with millions of referrals still lines up. `motionsWith`
        # is truncated to `motionsW` to keep the same width without splitting.
        header = f"{'WP':>4} {'referrals':>10} {'lead':>6} {'expl.':>7} {'motionsW':>10}"
        print(header)
        print("-" * len(header))
        for wp in sorted(set(args.wp), reverse=True):
            referrals = coverage_call(base, key, "referrals", {"wahlperiode": wp})
            explanations = coverage_call(base, key, "explanations", {"wahlperiode": wp})
            print(
                f"{wp:>4} {referrals['referrals']:>10} {referrals['leadReferrals']:>6} "
                f"{explanations['explanations']:>7} {explanations['motionsWithExplanations']:>10}"
            )
            if wp >= FIRST_REFERRAL_WAHLPERIODE and referrals["referrals"] == 0:
                incomplete.append(
                    f"WP{wp}: no referrals "
                    f"(source is available from WP{FIRST_REFERRAL_WAHLPERIODE})"
                )
            if wp >= FIRST_EXPLANATION_WAHLPERIODE and explanations["explanations"] == 0:
                incomplete.append(
                    f"WP{wp}: no §31 declarations "
                    f"(source is available from WP{FIRST_EXPLANATION_WAHLPERIODE})"
                )

    scope = coverage_call(base, key, "vote-scope", {})
    print()
    print(
        f"vote-scope migration: complete={scope['complete']}, "
        f"remaining={format_remaining(scope)}"
    )
    if not scope["complete"]:
        incomplete.append(
            f"vote-scope: {format_remaining(scope)} row(s) still un-migrated — "
            "re-run `POST /api/pipeline/votes/backfill-scope` until it reports done."
        )

    if incomplete:
        print()
        print("INCOMPLETE:")
        for entry in incomplete:
            print(f"  - {entry}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
