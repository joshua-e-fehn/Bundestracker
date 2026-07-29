"""Writing to Convex over its HTTP ingestion API.

Convex has no Python client, so the bridge is HTTP: the pipeline POSTs to
`/api/pipeline/*` on the deployment, routed by webapp/convex/http.ts to
internal mutations that upsert on a natural key. Authentication is a shared
secret in an `Authorization: Bearer` header — separate from Better Auth on
purpose, because a browser session is not a thing a cron job can obtain.

Four properties belong here rather than in each caller:

1. **The URL is the `.convex.site` host, not `.convex.cloud`.** Anything on the
   `httpRouter` is served from the site host; posting to the cloud host returns
   a 404 that looks exactly like a missing route. `config.require_convex_http_url`
   converts.

2. **Batches are chunked to `MAX_BATCH`.** Convex reads ~16 000 and writes
   ~8 000 documents per transaction, and webapp/convex/lib/ingest.ts sets the
   ceiling at 500 and *rejects* an oversized batch rather than truncating it —
   so an unchunked 80 537-record backfill is one 400, not a slow success.

3. **Retries are for the transport, not for the payload.** A 5xx or a timeout
   is retried with backoff; a 400 is not, because the ingestion mutations throw
   only on precondition failures (an unknown MP, a missing sheet, a malformed
   record) and retrying one produces the same 400 tomorrow. The distinction is
   what keeps a real data error visible instead of buried in retry noise.

4. **A dry run writes nothing and still counts.** `--dry-run` runs the whole
   fetch and transform and reports what *would* be written, which is what makes
   a transform change reviewable without a deployment.

The `inserted`/`updated` split every batch returns is worth logging: an
incremental sync that reports thousands of inserts every night is one whose
natural key has stopped matching, and that failure is otherwise silent.
"""

from __future__ import annotations

import json
import logging
import random
import time
from collections.abc import Iterable, Iterator, Sequence
from types import TracebackType
from typing import Any, Self

import httpx

from bundestrack.api.base import USER_AGENT

logger = logging.getLogger(__name__)

#: Rows per request. Mirrors `MAX_BATCH` in webapp/convex/lib/ingest.ts, which
#: rejects anything larger — the two must not drift, so the comment says so on
#: both sides.
MAX_BATCH = 500

DEFAULT_TIMEOUT = 120.0

#: Retries per request, for transport failures only. Convex is not behind the
#: Enodia WAF, so this is ordinary resilience rather than §2.6's backoff.
DEFAULT_MAX_RETRIES = 4
INITIAL_BACKOFF = 2.0
MAX_BACKOFF = 60.0

#: Statuses worth retrying. 429 is included for a deployment behind a proxy
#: that rate-limits; Convex itself does not send one for these routes.
RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})


class ConvexError(RuntimeError):
    """The ingestion API refused a request."""


class ConvexAuthError(ConvexError):
    """The shared key was missing, wrong, or unset on the deployment.

    Its own class because the fix is different and the message would otherwise
    be indistinguishable from a data error: `PIPELINE_API_KEY` must be set on
    *both* sides, and webapp/convex/http.ts denies rather than allows when the
    deployment's copy is missing.
    """


class BatchResult:
    """What a sequence of ingestion requests wrote.

    Accumulated across chunks so a caller posting 80 537 activities gets one
    number rather than 162 of them, and reported per stage by `sync`.
    """

    def __init__(self, unit: str = "records") -> None:
        self.unit = unit
        self.inserted = 0
        self.updated = 0
        self.requests = 0
        #: Rows that never left the pipeline — quarantined names, unresolved
        #: ids. Counted here so a stage's report adds up to what it was given.
        self.skipped = 0

    @property
    def written(self) -> int:
        return self.inserted + self.updated

    def record(self, response: dict[str, Any]) -> None:
        self.inserted += int(response.get("inserted", 0))
        self.updated += int(response.get("updated", 0))
        self.requests += 1

    def merge(self, other: BatchResult) -> None:
        self.inserted += other.inserted
        self.updated += other.updated
        self.requests += other.requests
        self.skipped += other.skipped

    def __str__(self) -> str:
        text = (
            f"{self.written} {self.unit} "
            f"({self.inserted} new, {self.updated} updated, {self.requests} requests)"
        )
        return f"{text}, {self.skipped} skipped" if self.skipped else text


def chunked(items: Sequence[Any], size: int = MAX_BATCH) -> Iterator[Sequence[Any]]:
    """Split a sequence into batches the ingestion API will accept.

    Yields nothing for an empty input, so a caller loops over "no work" without
    posting an empty batch — which would be a wasted round-trip that reports
    `0 inserted` and looks like a failed write.
    """
    for start in range(0, len(items), size):
        yield items[start : start + size]


class ConvexLoader:
    """Posts transformed records to the Convex ingestion API.

    One instance per run. `dry_run` short-circuits every write while still
    reporting what would have happened, so the two modes take the same code
    path up to the request itself.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        dry_run: bool = False,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.dry_run = dry_run
        self.max_retries = max_retries
        self._api_key = api_key
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT})

    def _headers(self) -> dict[str, str]:
        """Auth, per request rather than on the client.

        Same reason `DIPClient` does it this way: an injected client belongs to
        the caller, so setting the key on it would both mutate someone else's
        object and — worse — silently send *no* key when the caller supplied
        their own client. A per-request header cannot be lost that way.
        """
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    # -- transport ---------------------------------------------------------

    def health(self) -> bool:
        """Whether this key still opens the door.

        Called before a long sync so a rotated or missing `PIPELINE_API_KEY`
        surfaces as one clean 401 at the start rather than as several thousand
        of them an hour in — which is exactly what the endpoint exists for
        (webapp/convex/http.ts).
        """
        if self.dry_run:
            return True
        response = self._request("GET", "health")
        return bool(response.get("ok"))

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """One ingestion request.

        In a dry run the payload is validated as JSON-serialisable and
        discarded. That check is not ceremony: a `datetime.date` or a `set`
        left in a payload raises here, in a mode that touches nothing, instead
        of at 3 a.m. against a live deployment.
        """
        if self.dry_run:
            json.dumps(payload)
            return {"inserted": 0, "updated": 0, "dryRun": True}
        return self._request("POST", path, payload)

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        url = f"{self.base_url}/api/pipeline/{path.lstrip('/')}"
        backoff = INITIAL_BACKOFF
        last_error: Exception | None = None

        for attempt in range(self.max_retries + 1):
            try:
                response = self._client.request(method, url, json=payload, headers=self._headers())
            except httpx.HTTPError as error:
                last_error = error
                logger.warning(
                    "%s %s failed (attempt %d/%d): %s",
                    method,
                    url,
                    attempt + 1,
                    self.max_retries + 1,
                    error,
                )
                if attempt < self.max_retries:
                    time.sleep(_jittered(backoff))
                    backoff = min(backoff * 2, MAX_BACKOFF)
                continue

            if response.status_code == 401:
                raise ConvexAuthError(
                    f"401 from {url}. PIPELINE_API_KEY must be set here *and* on the "
                    'deployment: `bunx convex env set PIPELINE_API_KEY "…"`.'
                )
            if response.status_code in RETRYABLE_STATUSES:
                last_error = ConvexError(f"{response.status_code} from {url}: {_detail(response)}")
                logger.warning(
                    "%s from %s (attempt %d/%d) — retrying in %.0fs",
                    response.status_code,
                    url,
                    attempt + 1,
                    self.max_retries + 1,
                    backoff,
                )
                if attempt < self.max_retries:
                    time.sleep(_jittered(backoff))
                    backoff = min(backoff * 2, MAX_BACKOFF)
                continue
            if response.status_code >= 400:
                # Not retried. The ingestion mutations throw on precondition
                # failures — an MP not on the roster, a vote sheet not yet
                # ingested, a field the validator rejects — and every one of
                # those is deterministic. The message is passed through because
                # it names what was wrong.
                raise ConvexError(f"{response.status_code} from {url}: {_detail(response)}")

            try:
                body = response.json()
            except ValueError as error:
                raise ConvexError(
                    f"Expected JSON from {url}, got {response.text[:120]!r}"
                ) from error
            return body if isinstance(body, dict) else {"result": body}

        raise ConvexError(f"{method} {url} failed after {self.max_retries + 1} attempts") from (
            last_error
        )

    # -- batched writes ----------------------------------------------------

    def post_batches(
        self,
        path: str,
        key: str,
        records: Sequence[dict[str, Any]],
        *,
        unit: str | None = None,
        batch_size: int = MAX_BATCH,
    ) -> BatchResult:
        """Post records in chunks the API will accept.

        `key` is the argument name the mutation expects its array under — `mps`,
        `speeches`, `activities`. Named per call because the mutations differ,
        and a wrong one is a 400 naming the field rather than a silent no-op.
        """
        result = BatchResult(unit or key)
        for batch in chunked(records, batch_size):
            result.record(self.post(path, {key: list(batch)}))
        if result.requests:
            logger.info("%s → %s", path, result)
        return result

    def post_each(
        self, path: str, payloads: Iterable[dict[str, Any]], *, unit: str = "records"
    ) -> BatchResult:
        """Post one request per payload, for the mutations that take a single row.

        `vote-sheets`, `mps/link-dip` and `motion-sponsors` are per-record by
        design — each carries its own natural key rather than an array — so
        this is the shape they need, not a fallback.
        """
        result = BatchResult(unit)
        for payload in payloads:
            response = self.post(path, payload)
            # A single-row mutation reports `created`, not `inserted`/`updated`.
            if "created" in response:
                response = {"inserted": int(bool(response["created"])), "updated": 0}
                response["updated"] = 1 - response["inserted"]
            result.record(response)
        return result

    # -- named stages ------------------------------------------------------

    def upsert_mps(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        """The roster. First in §11.1's order — everything else joins to it."""
        return self.post_batches("mps", "mps", payloads, unit="MPs")

    def link_dip_persons(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_each("mps/link-dip", payloads, unit="DIP links")

    def upsert_committees(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_batches(
            "committee-memberships", "memberships", payloads, unit="committee seats"
        )

    def upsert_motions(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_batches("motions", "motions", payloads, unit="motions")

    def upsert_motion_sponsors(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        """Sponsors, one request per motion.

        Each request already carries its motion's DIP id and its own sponsor
        array, so the array is chunked rather than the requests: a motion with
        more than `MAX_BATCH` signatories would otherwise be a 400.
        """
        result = BatchResult("sponsorships")
        for payload in payloads:
            sponsors = payload.get("sponsors", [])
            for batch in chunked(sponsors):
                result.record(self.post("motion-sponsors", {**payload, "sponsors": list(batch)}))
        return result

    def upsert_committee_referrals(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        """Which committees a bill was referred to (§3.3).

        A different route and a different table from `upsert_committees` above,
        because they are claims about different subjects — a referral names no
        member. See webapp/convex/committeeReferrals.ts.
        """
        return self.post_batches(
            "committee-referrals", "referrals", payloads, unit="committee referrals"
        )

    def upsert_vote_explanations(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        """`Erklärung nach § 31 GO-BT` — a member's declared reason for a vote."""
        return self.post_batches(
            "vote-explanations", "explanations", payloads, unit="vote explanations"
        )

    def upsert_activities(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_batches("activities", "activities", payloads, unit="activities")

    def upsert_questions(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_batches("questions", "questions", payloads, unit="questions")

    def upsert_speeches(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_batches("speeches", "speeches", payloads, unit="speech segments")

    def add_activity_events(self, payloads: Sequence[dict[str, Any]]) -> BatchResult:
        return self.post_batches("activity-events", "events", payloads, unit="feed events")

    def upsert_vote_sheet(self, payload: dict[str, Any]) -> dict[str, Any]:
        """One ballot. Must land before its records — they have no ballot to
        belong to otherwise, and `upsertVoteRecords` throws rather than
        inserting a placeholder."""
        return self.post("vote-sheets", payload)

    def upsert_vote_records(self, payload: dict[str, Any]) -> BatchResult:
        """One ballot's per-MP records, chunked.

        A ballot is 630-odd rows, inside `MAX_BATCH` — but the chunking is
        unconditional rather than "630 < 500 is close enough", because the
        ceiling is the deployment's and this file should not be the place that
        assumes the chamber never grows.
        """
        result = BatchResult("vote records")
        records = payload.get("records", [])
        for batch in chunked(records):
            result.record(self.post("vote-records", {**payload, "records": list(batch)}))
        return result

    def missing_vote_vorgang(
        self,
        wahlperiode: int,
        cursor: dict[str, int] | None = None,
        *,
        limit: int = 200,
    ) -> dict[str, Any]:
        """One page of ballots in a period whose procedure is not yet known.

        The read half of the L3 backfill. Returns `{sheets, nextCursor, done}`
        — sheets carry sitting and tally so the caller can join back to the
        `_ballot_vorgaenge` map without a second Convex round-trip.
        """
        if self.dry_run:
            return {"sheets": [], "nextCursor": None, "done": True}
        payload: dict[str, Any] = {"wahlperiode": wahlperiode, "limit": limit}
        if cursor is not None:
            payload["cursor"] = cursor
        return self._request("POST", "votes/missing-vorgang", payload)

    def patch_vote_vorgang(
        self, wahlperiode: int, patches: Sequence[dict[str, Any]]
    ) -> dict[str, int]:
        """Batch-patch late `dipVorgangId` links onto ballots (L3).

        Idempotent by design: `backfillVoteSheetVorgang` counts `patched`,
        `unchanged`, `conflicts`, `unknown`. A conflict — a row already
        carrying a *different* Vorgang — is left alone; only a bulk migration
        should reassign one, and this route is deliberately not that.
        """
        response = self.post(
            "votes/backfill-vorgang",
            {"wahlperiode": wahlperiode, "patches": list(patches)},
        )
        return {
            key: int(response.get(key, 0))
            for key in ("patched", "unchanged", "conflicts", "unknown")
        }

    def backfill_vote_record_scope(
        self,
        *,
        batch_size: int = 500,
        max_slices: int = 2_000,
    ) -> int:
        """Copy each vote record's ballot period and date onto the record.

        The migration for the period-scoped vote index. A `voteRecords` row used
        to carry neither, so every per-MP question about votes read the member's
        whole career off an MP-only index and then fetched a `voteSheets` row per
        record to find out which period each vote belonged to — an unbounded scan
        with an N+1 on top, and 64 % of the transaction that exceeded Convex's
        read limit.

        ⚠ **Not period-scoped, and not per-period.** It walks whatever rows are
        un-migrated, across every Wahlperiode at once, so it is run *once per
        deployment* rather than once per backfill. That is why it takes no
        `wahlperiode`.

        Needs no cursor: the un-migrated rows are exactly the ones the index
        selects (Convex sorts a missing field below every value), and a migrated
        row leaves that range by being written. So each call asks for the next
        slice, and a crashed run resumes by being run again.

        Returns the rows migrated. A second run returns 0, which is the signal
        that the period-scoped reads are now complete — confirm with
        `votes:voteScopeCoverage`, which reads the same range.
        """
        migrated = 0
        for _ in range(max_slices):
            response = self.post(
                "votes/backfill-scope",
                {"batchSize": batch_size},
            )
            migrated += int(response.get("migrated", 0))
            orphaned = int(response.get("orphaned", 0))
            if orphaned:
                # A record whose ballot is gone. Left un-migrated deliberately —
                # there is nothing to copy — but it should be visible, because
                # the only thing that deletes a sheet without its records is a
                # manual intervention or a bug in `purgeSeedData`.
                logger.warning(
                    "%d vote record(s) reference a ballot that no longer exists; "
                    "they stay outside every period-scoped read",
                    orphaned,
                )
            if self.dry_run or response.get("done"):
                return migrated
        logger.warning(
            "Vote-record scope backfill stopped at the %d-slice limit — "
            "period-scoped vote reads are still incomplete",
            max_slices,
        )
        return migrated

    def backfill_dissent(
        self,
        wahlperiode: int,
        *,
        batch_size: int = 3,
        max_slices: int = 2_000,
    ) -> int:
        """Compute the dissent flags and period tally for a period's ballots.

        Whether a vote broke with the voter's own group is a property of the
        *ballot*, not of the record — it depends on how the other ~630 members
        voted in the same division — so it is decided once, when the ballot
        lands, and stored (webapp/convex/votes.ts). This walks the ballots that
        predate that: `upsertVoteRecords` maintains the tally from now on, but
        nothing has ever computed it for a ballot already in the database.

        Sliced for the same reason `recompute_scores` above is: one ballot's
        refresh reads all of its ~630 records plus the roster, so only a few fit
        in one Convex transaction. The route returns `done` and leaves
        continuing to the caller.

        Idempotent: the flags are derived from the ballot's own records and each
        member's tally is derived from those flags, so a second run arrives at
        the same numbers rather than doubling them. That is what makes it the
        repair for a tally that has drifted.

        The walk has two phases behind one integer cursor — the period's ballots,
        then its roster — and both schedule their work rather than doing it
        inline, so the route stays cheap regardless of `batch_size`. Returns the
        number of member tallies rolled up (`mpsRolledUp`); `records` is retained
        in the response shape but is now always 0, because the refreshes run in
        their own transactions and this route cannot count rows it did not write.
        """
        rolled_up = 0
        cursor = 0
        for _ in range(max_slices):
            response = self.post(
                "votes/backfill-dissent",
                {"wahlperiode": wahlperiode, "cursor": cursor, "batchSize": batch_size},
            )
            rolled_up += int(response.get("mpsRolledUp", 0))
            if self.dry_run or response.get("done"):
                return rolled_up
            next_cursor = response.get("nextCursor")
            if next_cursor is None:
                return rolled_up
            # Coerced before comparing, for `recompute_scores`' reason: a guard
            # that compares across types never fires, and this one is the only
            # thing stopping a stalled deployment from being walked 2 000 times.
            advanced = int(next_cursor)
            if advanced == cursor:
                return rolled_up
            cursor = advanced
        logger.warning(
            "Dissent backfill stopped at the %d-slice limit — the tally may be incomplete",
            max_slices,
        )
        return rolled_up

    def generate_seating(self, wahlperiode: int) -> dict[str, Any]:
        """Regenerate the synthetic hemicycle from the roster.

        ⚠ Not real seats. No machine-readable seat assignment exists anywhere
        (§9); Convex derives right-sized blocs on a standard arc from Fraktion
        sizes. Called after the roster changes because that is its only input.
        """
        return self.post("seating/generate", {"wahlperiode": wahlperiode})

    def recompute_scores(
        self,
        wahlperiode: int,
        *,
        month: str | None = None,
        batch_size: int = 50,
        max_slices: int = 1_000,
    ) -> int:
        """Rescore a period, walking the slices until it is done.

        Sliced because scoring one MP reads their activities, speeches, votes
        and committees, so the whole chamber does not fit in one Convex
        transaction (webapp/convex/scoreSweep.ts). The cursor loop is here
        because the HTTP route returns `hasMore` and leaves continuing to the
        caller — unlike the nightly cron, which self-schedules.

        `max_slices` bounds a loop whose termination depends on a remote
        answer: a deployment that always returned `hasMore` would otherwise
        spin forever.

        ⚠ The cursor is the **`internalId` the previous slice ended on**, not an
        offset — a string, or None to start. It changed because an offset had to
        be seeked to: the route's `take(cursor + batchSize + 1)` re-read every
        member already scored, so paging a 635-member roster cost ~25 000 row
        reads. A member id is a keyset seek and costs `batchSize + 1` wherever
        the slice starts. It is deliberately a *derivable* id rather than an
        opaque Convex pagination token, because `scripts/score-period.py` shards
        a period across workers by computing slice boundaries from the roster it
        already holds.
        """
        scored = 0
        cursor: str | None = None
        for _ in range(max_slices):
            response = self.post(
                "scores/recompute",
                {
                    "wahlperiode": wahlperiode,
                    "month": month,
                    "cursor": cursor,
                    "batchSize": batch_size,
                },
            )
            scored += int(response.get("scored", 0))
            if self.dry_run or not response.get("hasMore"):
                return scored
            next_cursor = response.get("nextCursor")
            if next_cursor is None:
                return scored
            # ⚠ Coerced *before* the comparison, not after. The guard catches a
            # slice that made no progress — without it the loop re-scores the
            # same members until `max_slices` — and it only works if both sides
            # are the same type. Comparing the raw response against the stored
            # cursor lets `0 == "0"` be false, which is exactly the case where
            # the deployment is telling us it has not moved.
            advanced = str(next_cursor)
            if advanced == cursor:
                return scored
            cursor = advanced
        logger.warning(
            "Score recomputation stopped at the %d-slice limit — scores may be incomplete",
            max_slices,
        )
        return scored


def _jittered(seconds: float) -> float:
    """Spread retries so a restarted pipeline does not re-synchronise with itself."""
    # `random` rather than `secrets`: this is request pacing, not a secret.
    return seconds * random.uniform(0.8, 1.2)


def _detail(response: httpx.Response) -> str:
    """The deployment's own error message, when it sent one.

    webapp/convex/http.ts answers `{"error": "…"}` and passes the mutation's
    message through, which names the offending field or the missing row — far
    more useful than the status alone.
    """
    try:
        body = response.json()
    except ValueError:
        return response.text[:300]
    if isinstance(body, dict) and "error" in body:
        return str(body["error"])
    return str(body)[:300]
