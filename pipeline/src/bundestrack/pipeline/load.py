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
        """Fold one ingestion response into the running totals.

        Understands both shapes the API returns, because the routes differ: a
        batch mutation answers `{inserted, updated}` while a single-row one
        (`vote-sheets`, `mps/link-dip`) answers `{created}`. Converting here
        rather than at each call site is what lets a stage's report add up
        regardless of which kind of route it used.
        """
        if "created" in response and "inserted" not in response:
            created = bool(response["created"])
            self.inserted += int(created)
            self.updated += int(not created)
        else:
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
            # `BatchResult.record` handles the `{created}` shape these routes
            # return — see its docstring.
            result.record(self.post(path, payload))
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
        """
        scored = 0
        cursor = 0
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
            if next_cursor is None or next_cursor == cursor:
                return scored
            cursor = int(next_cursor)
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
