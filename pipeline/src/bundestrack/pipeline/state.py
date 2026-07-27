"""What one sync needs to remember for the next one.

A JSON file beside the pipeline, holding three things:

- **The watermarks** — the high-water `aktualisiert` an incremental sync filters
  on. §11.2 is specific about what it must be: *the max `aktualisiert` actually
  seen*, not wall-clock time. A clock-based watermark drops any record whose
  timestamp fell between the last query and the run finishing, and it never
  comes back, because the next window starts after it.

  One per **stream**, not one per period. The stages fail independently — that
  is the point of isolating them — so a single shared watermark would let a
  stage that succeeded advance past the window a stage that *failed* still
  needs. A run where activities land and protocols are blocked by the WAF
  would move the mark to today, and tomorrow's sync would never ask for those
  protocols again: the sitting is lost, silently and permanently. Keyed
  `<wahlperiode>:<stream>`, each stream advances only on its own evidence.

- **The quarantine** (§7.3) — names the roster could not resolve, retried on
  later syncs rather than dropped. See `pipeline.join`.

- **The Stammdaten `<VERSION>`** — a Unix timestamp, and the cheapest change
  detector there is (§6.2). Worth persisting so a refresh is visible; the dump
  is re-downloaded every sync regardless, since there is no metadata endpoint
  to ask first.

A file rather than a Convex table on purpose: it is operational state about
*fetching*, not data about parliament, and the sync must be able to decide what
to fetch before it can reach a deployment. Losing it costs a wider window, not
correctness — every write downstream is an upsert on a natural key.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from pydantic import BaseModel, Field

from bundestrack.pipeline.join import Quarantine

logger = logging.getLogger(__name__)

#: How far back to re-read beyond the recorded watermark.
#:
#: §11.2 asks for the window to overlap "slightly to tolerate clock skew". An
#: hour, because DIP timestamps carry a `+02:00` offset and the risk being
#: hedged is a machine whose clock disagrees with the API's — and because
#: re-reading an hour costs a handful of pages against a WAF that punishes
#: volume (§2.6), while missing an hour costs records that never return.
OVERLAP = timedelta(hours=1)

#: The independently-watermarked fetch streams. One per stage that filters on
#: `f.aktualisiert.start`, so a stage that failed keeps its window — see the
#: module docstring.
STREAM_ACTIVITIES = "activities"
STREAM_MOTIONS = "motions"
STREAM_PROTOCOLS = "protocols"


class SyncState(BaseModel):
    """Everything a run inherits from the one before it."""

    #: Max `aktualisiert` seen, keyed `<wahlperiode>:<stream>`, as an ISO 8601
    #: string with offset — the format `f.aktualisiert.start` expects (§2.5).
    watermarks: dict[str, str] = Field(default_factory=dict)
    #: The Stammdaten dump's `<VERSION>` at the last successful run.
    stammdaten_version: str | None = None
    quarantine: Quarantine = Field(default_factory=Quarantine)
    #: DIP protocol id → the `xml_hash` last ingested. Undocumented but present
    #: on every Bundestag protocol (§5.1), and the MD5 of the XML — so this is
    #: what lets a sync skip re-downloading ~1.2 MB per unchanged sitting.
    protocol_hashes: dict[str, str] = Field(default_factory=dict)
    #: Internal id → the date that MP's biography page was last read, ISO
    #: `YYYY-MM-DD`. The contact block is one ~280 KB page per MP and there are
    #: 630 of them, so fetching the lot every sync is ~12 minutes and ~175 MB
    #: through a WAF that counts both (§2.6). This is what lets a run fetch only
    #: the MPs it has never read or has not read recently.
    #:
    #: Portraits are *not* keyed here: they come from the listing, which is ~27
    #: requests for all 639, so there is nothing to save by skipping any.
    contact_fetched_on: dict[str, str] = Field(default_factory=dict)
    #: Ballots already ingested, per Wahlperiode, as `wp/sitzung/abstimmung`.
    #: The named-vote listing ignores every date parameter tried in research
    #: (§4.1), so an incremental run cannot ask the server for new ballots — it
    #: pages from the newest and stops at the first one in here.
    ingested_ballot_keys: dict[str, list[str]] = Field(default_factory=dict)
    #: When the last run finished. Reported by `status`, never used as a
    #: watermark — see the module docstring for why that distinction matters.
    last_run: str | None = None

    @staticmethod
    def _key(wahlperiode: int, stream: str) -> str:
        return f"{wahlperiode}:{stream}"

    def watermark(self, wahlperiode: int, stream: str) -> str | None:
        return self.watermarks.get(self._key(wahlperiode, stream))

    def since(self, wahlperiode: int, stream: str) -> str | None:
        """The `f.aktualisiert.start` value for one stream's incremental fetch.

        The stored watermark minus `OVERLAP`. Returns None when nothing has
        been recorded, which is how a `sync` on a fresh host becomes a full
        fetch rather than one that silently starts from now and never
        backfills — and how a stream whose stage failed last night re-reads
        the window it never finished.
        """
        stored = self.watermark(wahlperiode, stream)
        if not stored:
            return None
        try:
            parsed = datetime.fromisoformat(stored)
        except ValueError:
            logger.warning(
                "Ignoring unparseable %s watermark %r for WP%d", stream, stored, wahlperiode
            )
            return None
        return (parsed - OVERLAP).isoformat()

    def advance(self, wahlperiode: int, stream: str, seen: datetime | None) -> None:
        """Move one stream's watermark forward to a timestamp actually observed.

        Monotonic: a batch whose newest record is older than the stored
        watermark — a re-read of the overlap window, or a backfill of an older
        period — must not move it backwards, or the next sync would re-read
        everything since.
        """
        if seen is None:
            return
        current = self.watermark(wahlperiode, stream)
        if current:
            try:
                if datetime.fromisoformat(current) >= seen:
                    return
            except ValueError:
                pass
        self.watermarks[self._key(wahlperiode, stream)] = seen.isoformat()

    def newest_watermark(self, wahlperiode: int) -> str | None:
        """The furthest any stream has reached — for `status` to report.

        The *minimum* would be the honest "everything before this is certainly
        ingested" figure, but it reads as the pipeline being days behind
        whenever one stream legitimately has no recent records. `status` shows
        this and the per-stream detail beneath it.
        """
        marks = [
            value for key, value in self.watermarks.items() if key.startswith(f"{wahlperiode}:")
        ]
        return max(marks) if marks else None

    def stream_watermarks(self, wahlperiode: int) -> dict[str, str]:
        """Every stream's mark for one period, for reporting."""
        prefix = f"{wahlperiode}:"
        return {
            key.removeprefix(prefix): value
            for key, value in sorted(self.watermarks.items())
            if key.startswith(prefix)
        }

    # -- protocol hashes ---------------------------------------------------

    def protocol_hash(self, protocol_id: str) -> str | None:
        return self.protocol_hashes.get(protocol_id)

    def record_protocol_hash(self, protocol_id: str, xml_hash: str) -> None:
        """Remember a sitting's XML hash, once its speeches have landed.

        Recorded *after* a successful ingest rather than at download, so a run
        that dies between fetching and writing re-fetches that sitting next
        time instead of skipping it forever.
        """
        self.protocol_hashes[protocol_id] = xml_hash

    # -- contact freshness -------------------------------------------------

    def contact_is_stale(self, internal_id: str, *, today: date, max_age_days: int) -> bool:
        """Should this MP's biography page be re-read?

        True for an MP never read, and for one read longer ago than
        `max_age_days`. An unparseable date is treated as stale — re-reading
        one page is cheaper than reasoning about how a bad value got there.
        """
        recorded = self.contact_fetched_on.get(internal_id)
        if not recorded:
            return True
        try:
            fetched = date.fromisoformat(recorded)
        except ValueError:
            logger.warning(
                "Ignoring unparseable contact fetch date %r for %s", recorded, internal_id
            )
            return True
        return (today - fetched).days >= max_age_days

    def record_contact_fetch(self, internal_id: str, *, today: date) -> None:
        """Remember that an MP's page was read, once its contact block landed.

        Recorded after a successful parse rather than at download, on the same
        reasoning as `record_protocol_hash`: a run that dies between fetching
        and writing should re-read that page next time, not skip it for a week.
        """
        self.contact_fetched_on[internal_id] = today.isoformat()

    # -- ballots -----------------------------------------------------------

    def ingested_ballots(self, wahlperiode: int) -> list[str]:
        return self.ingested_ballot_keys.get(str(wahlperiode), [])

    def record_ballot(self, wahlperiode: int, key: str) -> None:
        keys = self.ingested_ballot_keys.setdefault(str(wahlperiode), [])
        if key not in keys:
            keys.append(key)

    def finish(self) -> None:
        self.last_run = datetime.now(UTC).isoformat()


def load_state(path: Path) -> SyncState:
    """Read the state file, or start empty.

    A missing file is the normal first run. A corrupt one is logged and
    ignored rather than fatal: the cost is a wider fetch window, and refusing
    to run until an operator repairs a cache file would take the pipeline down
    for something that repairs itself.
    """
    if not path.exists():
        return SyncState()
    try:
        return SyncState.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        logger.warning("Could not read %s (%s) — starting from an empty state", path, error)
        return SyncState()


def save_state(path: Path, state: SyncState) -> None:
    """Write the state file atomically.

    Via a temporary file and a rename, because the alternative is a run killed
    mid-write leaving truncated JSON — which `load_state` would then discard,
    turning a crash into a full re-fetch on a WAF-protected API (§2.6).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(state.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
