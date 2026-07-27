#!/usr/bin/env python3
"""Read a period back out of Convex and report what the enrichment landed.

Deliberately reads through the *public query* rather than the ingestion API:
what matters is what the webapp can see, not what the pipeline believes it
posted. `mps:getMPs` is the query the roster page itself calls, so a column
that is written but not returned — `photoCredit` was, until this was run —
shows up here as a gap rather than as a success.

    scripts/verify-enrichment.py
    scripts/verify-enrichment.py --wp 20
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

#: See the note in run-enrichment.py: resolved from this file, not the cwd.
PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR / "src"))

from bundestrack.config import get_settings  # noqa: E402

FIELDS = (
    "photoUrl",
    "photoCredit",
    "occupation",
    "education",
    "contact",
    "dipPersonId",
    "profession",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wp", type=int, default=21, help="Wahlperiode to report on.")
    args = parser.parse_args()

    # `.env` is read relative to the working directory — see run-enrichment.py.
    os.chdir(PIPELINE_DIR)
    settings = get_settings()
    request = urllib.request.Request(
        f"{settings.convex_url}/api/query",
        data=json.dumps(
            {"path": "mps:getMPs", "args": {"wahlperiode": args.wp}, "format": "json"}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)

    if payload.get("status") != "success":
        print("Query failed:", payload)
        return 1

    rows = payload["value"]
    if not rows:
        print(f"No WP{args.wp} rows — nothing to report on.")
        return 1
    print(f"WP{args.wp} mandate rows: {len(rows)}")
    for field in FIELDS:
        filled = sum(1 for row in rows if row.get(field) is not None)
        print(f"  {field:14s} {filled:4d}  ({filled / len(rows):6.1%})")

    contacts = [row["contact"] for row in rows if row.get("contact")]
    print(f"\ncontact blocks: {len(contacts)}")
    for key in ("formUrl", "constituencyOffice", "homepage"):
        print(f"  {key:20s} {sum(1 for c in contacts if c.get(key)):4d}")
    print(f"  {'socials (any)':20s} {sum(1 for c in contacts if c.get('socials')):4d}")
    print(f"  {'socials (total)':20s} {sum(len(c.get('socials') or []) for c in contacts):4d}")

    # A portrait without its credit is the one combination that must not exist:
    # these are photographer-credited works, not open-licensed ones (§6.5), so
    # the two columns are written and read as a pair.
    bare = [row["name"] for row in rows if row.get("photoUrl") and not row.get("photoCredit")]
    print(f"\nportraits with no credit: {len(bare)}{' — ' + ', '.join(bare[:5]) if bare else ''}")

    unenriched = [row["name"] for row in rows if not row.get("photoUrl")]
    print(f"rows with no portrait: {len(unenriched)}")
    for name in unenriched[:12]:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
