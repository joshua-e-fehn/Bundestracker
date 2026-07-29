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

- **When each mandate's contact block was last fetched** — the biography pages
  are ~280 KB each and there are 639 of them, so re-reading the lot every sync
  is ~175 MB through a WAF that counts bytes (§2.6). There is no hash and no
  `Last-Modified` to gate on the way protocols have `xml_hash`, so the gate is
  age: `contact_is_stale`. See `CONTACT_TTL`.

  Keyed `<wahlperiode>:<internal id>`, and for the same reason the watermarks
  are keyed per stream: a shared key lets one run's success suppress a fetch a
  *different* run still needs. Contact blocks land on the mandate row, which is
  per period — so a bare-id stamp written by a historical backfill marked the
  current period fresh, and the chamber a reader is actually looking at went
  unenriched. See `contact_key`.

A file rather than a Convex table on purpose: it is operational state about
*fetching*, not data about parliament, and the sync must be able to decide what
to fetch before it can reach a deployment. Losing it costs a wider window, not
correctness — every write downstream is an upsert on a natural key.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
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

#: How long a fetched contact block stays fresh.
#:
#: Unlike the protocol XML, which publishes an `xml_hash` that makes "has this
#: changed?" a free question (§5.1), the biography pages offer nothing to
#: compare — so freshness here is age rather than identity. Thirty days is
#: chosen against what actually changes on those pages: a constituency office
#: address or a new social account, neither of which is time-critical, against
#: a re-read that costs ~280 KB per MP through a WAF that counts bytes (§2.6).
#: A daily sync therefore refreshes roughly a thirtieth of the roster.
CONTACT_TTL = timedelta(days=30)


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
    #: Ballots already ingested, per Wahlperiode, as `wp/sitzung/abstimmung`.
    #: The named-vote listing ignores every date parameter tried in research
    #: (§4.1), so an incremental run cannot ask the server for new ballots — it
    #: pages from the newest and stops at the first one in here.
    ingested_ballot_keys: dict[str, list[str]] = Field(default_factory=dict)
    #: `<wahlperiode>:<internal id>` → when that mandate's contact block was
    #: last fetched, ISO 8601. The gate on a ~280 KB-per-MP re-read — see
    #: `CONTACT_TTL`.
    #:
    #: ⚠ **Keyed by period, not by human.** An MP who sat in WP20 and sits in
    #: WP21 is two mandate rows (`mps` is keyed `(internalId, wahlperiode)`),
    #: and each carries its own contact block. A bare-id key made one stamp
    #: speak for both, so a historical backfill that fetched a member's page
    #: for WP20 marked the *current* period fresh and starved stage 3 of the
    #: period a reader is actually looking at. See `contact_key`.
    contact_fetched_at: dict[str, str] = Field(default_factory=dict)
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

    @staticmethod
    def contact_key(internal: str, wahlperiode: int) -> str:
        """What one mandate's contact freshness is remembered under.

        Period-scoped for the same reason `mps` is keyed `(internalId,
        wahlperiode)`: the row a contact block lands on is the *mandate*, not
        the human, and an MP re-elected into the next period has two of them.

        Before this, one bare-id stamp spoke for every period at once, and the
        consequence was not theoretical — a WP19 backfill running against
        production stamped members who also sit in WP21, so the next WP21 sync
        found them "fresh", fetched nothing, and left the current chamber's
        contact blocks unfilled. The period a reader is looking at was starved
        by a fetch for a period nobody was looking at.
        """
        return f"{wahlperiode}:{internal}"

    def contact_is_stale(
        self, internal: str, wahlperiode: int, *, now: datetime | None = None
    ) -> bool:
        """Whether this mandate's biography page is worth re-reading.

        True for a mandate never fetched, which is what makes a first run fetch
        everyone. After that it is age against `CONTACT_TTL` — the pages carry
        no hash or `Last-Modified` to ask a cheaper question with.

        An unparseable stamp is treated as stale rather than fresh: the cost of
        being wrong is one ~280 KB re-read, against a contact block that would
        otherwise never refresh again.

        A stamp written before the key carried a period is likewise read as
        stale rather than adopted into one. It genuinely is ambiguous — the
        same dict held stamps from a WP21 sync and a WP19 backfill alike — and
        of the two ways to be wrong, guessing "current" re-creates exactly the
        starvation this key exists to end, while guessing "stale" costs one
        wider fetch, once. That is the trade this file already makes for a lost
        state file (see the module docstring).
        """
        stamp = self.contact_fetched_at.get(self.contact_key(internal, wahlperiode))
        if not stamp:
            return True
        try:
            fetched = datetime.fromisoformat(stamp)
        except ValueError:
            logger.warning("Ignoring unparseable contact timestamp %r for %s", stamp, internal)
            return True
        return (now or datetime.now(UTC)) - fetched >= CONTACT_TTL

    def record_contact_fetch(
        self, internal: str, wahlperiode: int, *, now: datetime | None = None
    ) -> None:
        """Mark one mandate's contact block as fetched.

        ⚠ Only for a fetch that actually *parsed* a block — see
        `MPContact.is_empty` and the call site in `pipeline.sync._load_contacts`.
        A 200 carrying no contact block at all is a page this pipeline failed to
        read, not a member with nothing published, and stamping the two alike
        made the failures permanent: an unparsed page was marked fresh for 30
        days, so the MPs it affected never retried.
        """
        self.contact_fetched_at[self.contact_key(internal, wahlperiode)] = (
            now or datetime.now(UTC)
        ).isoformat()

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
