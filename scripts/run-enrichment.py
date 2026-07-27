#!/usr/bin/env python3
"""Run the enrich stage alone, against the real sources.

Deliberately **not** a `cli.py` command: `sync` already runs this stage in its
proper place in the dependency order, and a second entry point into the same
work is the "more than one way to do one thing" the structure pass exists to
remove. This is an operator's tool for the *first* enrichment run, which has to
happen without also re-fetching 80 537 activities and 90 protocols to get
there. Routine runs are `pixi run pipeline sync`.

    scripts/run-enrichment.py --dry-run --full
    scripts/run-enrichment.py --full

`--full` re-reads every biography page regardless of `CONTACT_TTL`. A first run
wants it because no MP has ever been stamped, so the gate would let them all
through anyway — but passing it explicitly means a re-run after a crash also
takes the pages it already has, rather than half-resuming into a roster where
some rows carry a contact block and some do not.

⚠ Writes the roster, which means it writes *every* `mps` column — see the note
on `transform.mp_payload`. It loads the roster first for that reason: the
payload is built from the resolver, so skipping stage 1 would post rows that
blank the columns this run is not fetching.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

#: The pipeline package's directory. Everything below resolves from the script's
#: own location rather than the working directory — the rule
#: scripts/daily-sync.sh follows, because an operator runs these from wherever
#: they happen to be and cron starts in $HOME.
PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"

# The pipeline is an editable install under Pixi, but this also has to work from
# a plain checkout where the env was never activated.
sys.path.insert(0, str(PIPELINE_DIR / "src"))

from bundestrack.config import get_settings  # noqa: E402
from bundestrack.pipeline.state import save_state  # noqa: E402
from bundestrack.pipeline.sync import CURRENT_WAHLPERIODE, Pipeline, RunReport  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Fetch, but write nothing.")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Re-read every biography page, ignoring the contact TTL.",
    )
    parser.add_argument("--wp", type=int, default=CURRENT_WAHLPERIODE)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # Both `.env` and the state file are resolved relative to the working
    # directory (config.py), and the state file is where the contact TTL is
    # remembered — so running this from `scripts/` would read no credentials
    # and then write a *second* watermark file that the daily cron never sees.
    # `pixi run pipeline` gets this via the task's own `cwd`; this does it here.
    os.chdir(PIPELINE_DIR)

    settings = get_settings()
    if not args.dry_run:
        settings.require_convex_http_url()
        settings.require_pipeline_api_key()

    report = RunReport(args.wp, "enrich")
    with Pipeline(args.wp, settings=settings, dry_run=args.dry_run) as run:
        # The roster first, and not as a formality: the resolver it builds is
        # what the enrichment joins against, and `mp_payload` reads every other
        # column off it — so skipping it would post rows that blank the
        # activity data this run is not touching.
        run.load_roster(report)
        run.load_enrichment(report, full=args.full)
        if not args.dry_run:
            save_state(settings.state_path, run.state)

    print(report.summary())
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
