"""Shared HTTP transport for every Bundestag source.

All `*.bundestag.de` hosts sit behind an "Enodia" bot-protection WAF, and
docs/api-research.md §2.6 records what it does when provoked: it IP-blocks
*every* Bundestag host at once — the DIP API, the document server, the
unauthenticated OpenAPI spec — and did not clear across an hour of backoff.
Six concurrent workers tripped it in minutes; one sequential worker tripped it
in a few dozen requests.

So this module is deliberately unfashionable. It is a **synchronous** client
that fetches **one request at a time**, and the three properties that keep the
pipeline alive are enforced here rather than left to each caller's discipline:

1. **Redirects are never followed.** The challenge arrives as `303` with a
   `Location` of `/.enodia/challenge?…`. Following it returns an HTML
   proof-of-work page where the caller expects JSON, and the resulting
   `JSONDecodeError: Expecting value: line 1 column 1` is what a block looks
   like from the inside — §2.6 calls that out as the diagnostic tell. Here it
   raises `RateLimited` instead, which says what actually happened.

2. **Requests are paced.** Every request sleeps out the remainder of
   `min_interval` since the previous one, process-wide.

3. **Concurrency is refused, not merely discouraged.** A second thread entering
   `request()` raises `ConcurrentFetchError` rather than quietly doubling the
   request rate — the failure mode that costs an IP block is exactly the one a
   comment does not prevent.

`BundestagClient` is the base every source client subclasses; they share one
`_Pacer` so that a sync touching the DIP API, the document server and
bundestag.de still adds up to one polite request stream against what is, from
the WAF's point of view, one origin.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from collections.abc import Iterator, Mapping
from types import TracebackType
from typing import Any, Self

import httpx

logger = logging.getLogger(__name__)

# A browser User-Agent does not bypass Enodia (§2.6), so this one is honest
# instead: it identifies the pipeline and gives an operator something to
# recognise in a log if the Bundestag ever wants to ask us to slow down.
USER_AGENT = "bundestrack-pipeline/0.1 (+https://github.com/joshua-e-fehn/Bundestrack)"

# §2.6 calls ~0.5–1 s "polite", and notes that a single worker inside any
# published limit still tripped the WAF. The default sits at the slow end.
DEFAULT_MIN_INTERVAL = 1.0

DEFAULT_TIMEOUT = 60.0

# The XML protocols are ~1.2 MB and the Stammdaten ZIP ~950 KB. Total bytes
# matter to the WAF as well as request count (§2.6), so a download gets a longer
# clock rather than a retry that fetches it all over again.
DOWNLOAD_TIMEOUT = 300.0

DEFAULT_MAX_RETRIES = 5

# Backoff for a WAF challenge. §2.6 records 20 s → 90 s → 4 min failing to
# clear a *triggered* block, so these numbers cannot rescue one that has already
# escalated — they exist to let a single challenge pass without ending the run.
INITIAL_BACKOFF = 20.0
MAX_BACKOFF = 300.0

# Marker in the `Location` header that distinguishes a WAF challenge from a
# genuine redirect. Both are 303s; only one means "you are being blocked".
ENODIA_MARKER = "/.enodia/"


class BundestagAPIError(RuntimeError):
    """Base for every failure this package raises."""


class RateLimited(BundestagAPIError):
    """The Enodia WAF challenged the request (§2.6).

    Not a redirect and not an auth failure, though it is easily mistaken for
    both: §1.3 records an earlier research pass reading this as a 401 and
    concluding the API key scheme was wrong.
    """


class ConcurrentFetchError(BundestagAPIError):
    """Two threads tried to fetch at once.

    Raised rather than serialised behind a lock. Blocking would make the
    pipeline *look* correct while a caller quietly holds a thread pool open, and
    §2.6's block took an hour of downtime to discover the first time.
    """


class NotFound(BundestagAPIError):
    """The entity does not exist (HTTP 404)."""


class AuthenticationError(BundestagAPIError):
    """The API key was missing, invalid or expired (HTTP 401).

    Recoverable for the DIP API, which publishes a working key in its own
    OpenAPI spec — see `dip.DIPClient._heal_api_key`.
    """


class _Pacer:
    """Process-wide gate that serialises requests and spaces them out.

    Shared by every client so the interval is a property of the *pipeline*, not
    of each client: three clients each pacing themselves at 1 req/s would still
    put 3 req/s on one origin, which is the arithmetic that got an IP blocked.
    """

    def __init__(self, min_interval: float = DEFAULT_MIN_INTERVAL) -> None:
        self.min_interval = min_interval
        self._last_request_at: float | None = None
        # Guards `_last_request_at` only. `_in_flight` is what enforces the
        # one-at-a-time rule, and it must *fail* rather than wait.
        self._lock = threading.Lock()
        self._in_flight = False
        self._owner: int | None = None

    def __enter__(self) -> Self:
        with self._lock:
            if self._in_flight:
                raise ConcurrentFetchError(
                    "A second Bundestag request started while one was in flight. "
                    "The Enodia WAF IP-blocks every bundestag.de host on concurrent "
                    "access (docs/api-research.md §2.6) — fetch sequentially."
                )
            self._in_flight = True
            self._owner = threading.get_ident()
            last = self._last_request_at
        # Slept outside the lock: holding it would turn the pacing delay into a
        # queue, which is precisely the serialised concurrency this refuses.
        if last is not None:
            wait = self.min_interval - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        return self

    def __exit__(self, *_: object) -> None:
        with self._lock:
            self._last_request_at = time.monotonic()
            self._in_flight = False
            self._owner = None

    def sleep(self, seconds: float) -> None:
        """Back off, without releasing the in-flight gate.

        Used for retry waits: the request has not finished, so a second thread
        must still be refused rather than let in through the gap.
        """
        time.sleep(seconds)


_SHARED_PACER = _Pacer()


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Parse a `Retry-After` header, if the server sent one.

    RFC 7231 permits either a delta-seconds integer (`Retry-After: 30`) or an
    HTTP-date; we honour the delta form only, because none of the sources this
    client talks to actually sends a date and a partial parser is worse than no
    parser. abgeordnetenwatch sends neither form on its 429s (its own docs
    note the omission), so this returns None on that host and the caller falls
    back to the jittered exponential.
    """
    header = response.headers.get("retry-after")
    if header is None:
        return None
    header = header.strip()
    if not header.isdigit():
        return None
    return float(header)


def _is_enodia_challenge(response: httpx.Response) -> bool:
    """Is this the WAF challenge rather than a real redirect?

    Checked by `Location`, not by status alone: 303 is a legitimate status and
    the pipeline should not treat an ordinary redirect as a block. In practice
    §2.6 saw no genuine 303s from these hosts, so the status is also logged when
    the marker is absent.
    """
    if response.status_code not in (301, 302, 303, 307, 308):
        return False
    return ENODIA_MARKER in response.headers.get("location", "")


class BundestagClient:
    """A sequential, WAF-aware HTTP client.

    Subclassed by every source client. Callers get `request` (which raises on
    error statuses) and `get_bytes` / `get_json` / `get_text` on top of it.

    Not thread-safe by design — see `ConcurrentFetchError`.
    """

    def __init__(
        self,
        *,
        base_url: str = "",
        timeout: float = DEFAULT_TIMEOUT,
        min_interval: float | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        client: httpx.Client | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._pacer = _SHARED_PACER if min_interval is None else _Pacer(min_interval)
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout,
            # The whole point. `follow_redirects=True` would chase the challenge
            # and hand the caller an HTML page typed as JSON (§2.6).
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT, **(headers or {})},
        )

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
        # Only if we made it: an injected client belongs to the caller, who may
        # be sharing one connection pool across several source clients.
        if self._owns_client:
            self._client.close()

    # -- requests ----------------------------------------------------------

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        timeout: float | None = None,
    ) -> httpx.Response:
        """One paced, non-redirecting request, retried through WAF challenges.

        Raises `RateLimited` if the challenge outlasts `max_retries`,
        `AuthenticationError` on 401, `NotFound` on 404, and
        `BundestagAPIError` for anything else that is not a 2xx.
        """
        target = url if url.startswith("http") else f"{self.base_url}/{url.lstrip('/')}"
        backoff = INITIAL_BACKOFF
        last_error: Exception | None = None

        for attempt in range(self.max_retries + 1):
            with self._pacer as pacer:
                try:
                    response = self._client.request(
                        method,
                        target,
                        params=params,
                        headers=dict(headers) if headers else None,
                        timeout=timeout if timeout is not None else self._client.timeout,
                    )
                except (httpx.TimeoutException, httpx.NetworkError) as error:
                    # §2.6: once escalated, the WAF stops answering rather than
                    # challenging. A timeout here is more likely to be a block
                    # than a slow server, so it backs off on the same schedule.
                    #
                    # `NetworkError` — a reset, a dropped connection, a refused
                    # one — is retried on the same schedule and for the same
                    # reason. It was previously left to the `HTTPError` clause
                    # below, which raises: on 2026-07-29 a single
                    # `[Errno 104] Connection reset by peer`, 234 batches into
                    # WP19's activities, ended that stage and cost the rest of
                    # the period's ~115 000-record stream. A reset mid-stream is
                    # the ordinary hazard of an hours-long sequential fetch
                    # against a WAF-fronted host, and it is precisely what a
                    # retry loop is for; the alternative is a stage that fails
                    # on a hiccup one request from the end.
                    last_error = error
                    logger.warning(
                        "%s on %s (attempt %d/%d) — backing off %.0fs",
                        type(error).__name__,
                        target,
                        attempt + 1,
                        self.max_retries + 1,
                        backoff,
                    )
                    if attempt < self.max_retries:
                        pacer.sleep(_jittered(backoff))
                        backoff = min(backoff * 2, MAX_BACKOFF)
                    continue
                except httpx.HTTPError as error:
                    raise BundestagAPIError(f"{method} {target} failed: {error}") from error

                if _is_enodia_challenge(response):
                    last_error = RateLimited(
                        f"Enodia challenge on {target} "
                        f"(303 → {response.headers.get('location', '')[:80]})"
                    )
                    logger.warning(
                        "Enodia WAF challenge on %s (attempt %d/%d) — backing off %.0fs",
                        target,
                        attempt + 1,
                        self.max_retries + 1,
                        backoff,
                    )
                    if attempt < self.max_retries:
                        pacer.sleep(_jittered(backoff))
                        backoff = min(backoff * 2, MAX_BACKOFF)
                    continue

                # A 429 is retriable on the same jittered schedule as the WAF
                # challenge above — this client is the shared transport for
                # every source, and only one host answers 429 in practice
                # (abgeordnetenwatch — bundestag.de hosts escalate to Enodia
                # instead). Reusing the loop rather than lifting the retry
                # into each client keeps one policy for one class of failure,
                # and stops a WAF-adjacent 429 from ending the whole
                # enrichment stage on a hiccup one request from the end
                # (N4 in `/tmp/review-source-backed-ingestion-gaps.md`).
                #
                # `Retry-After` is honoured when present, capped at `MAX_BACKOFF`
                # so a hostile header cannot pin the run for hours; when absent
                # (the abgeordnetenwatch case, per its own docs) the jittered
                # exponential fallback takes over.
                if response.status_code == 429:
                    wait = _retry_after_seconds(response) or _jittered(backoff)
                    wait = min(wait, MAX_BACKOFF)
                    last_error = RateLimited(f"429 from {target}: {_error_detail(response)[:120]}")
                    logger.warning(
                        "429 from %s (attempt %d/%d) — backing off %.0fs",
                        target,
                        attempt + 1,
                        self.max_retries + 1,
                        wait,
                    )
                    if attempt < self.max_retries:
                        pacer.sleep(wait)
                        backoff = min(backoff * 2, MAX_BACKOFF)
                    continue

            self._raise_for_status(response, target)
            return response

        raise RateLimited(
            f"{method} {target} still blocked after {self.max_retries + 1} attempts. "
            "The Enodia WAF IP-blocks for extended periods once escalated "
            "(docs/api-research.md §2.6); stop the run and resume later."
        ) from last_error

    def _raise_for_status(self, response: httpx.Response, target: str) -> None:
        status = response.status_code
        if status < 400:
            # A redirect that reached here is not the WAF — but these hosts do
            # not legitimately redirect, so it is still not a document.
            if status >= 300:
                raise BundestagAPIError(
                    f"Unexpected {status} redirect from {target} to "
                    f"{response.headers.get('location', '(no Location)')}"
                )
            return
        detail = _error_detail(response)
        if status == 401:
            raise AuthenticationError(f"401 from {target}: {detail}")
        if status == 404:
            raise NotFound(f"404 from {target}: {detail}")
        raise BundestagAPIError(f"{status} from {target}: {detail}")

    def get_json(
        self,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Any:
        response = self.request("GET", url, params=params, headers=headers)
        try:
            return response.json()
        except ValueError as error:
            # §2.6's diagnostic tell, kept as a safety net: `request` already
            # raises `RateLimited` for a challenge it recognises, so reaching
            # here means an unrecognised one — say so rather than let a bare
            # JSONDecodeError send the reader hunting for malformed data.
            raise BundestagAPIError(
                f"Expected JSON from {url} but got {response.text[:120]!r}. "
                "An HTML body here usually means a WAF challenge page "
                "(docs/api-research.md §2.6)."
            ) from error

    def get_text(self, url: str, *, params: Mapping[str, Any] | None = None) -> str:
        return self.request("GET", url, params=params).text

    def get_bytes(self, url: str, *, params: Mapping[str, Any] | None = None) -> bytes:
        return self.request("GET", url, params=params, timeout=DOWNLOAD_TIMEOUT).content


def _jittered(seconds: float) -> float:
    """Spread retries so a restarted pipeline does not re-synchronise with itself."""
    # `random` rather than `secrets`: this is request pacing, not a secret.
    return seconds * random.uniform(0.8, 1.2)


def _error_detail(response: httpx.Response) -> str:
    """The API's own error message, when it sent one.

    DIP answers errors as `{"code": 401, "message": "…"}` (§1.4), and that
    message is more useful than the status: it distinguishes an expired key from
    an absent one, and names the id that was not found.
    """
    try:
        body = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(body, dict) and "message" in body:
        return str(body["message"])
    return str(body)[:200]


def paginate_cursor(
    fetch_page: Any,
    *,
    max_pages: int | None = None,
) -> Iterator[dict[str, Any]]:
    """Walk a DIP list endpoint to exhaustion, one page at a time.

    `fetch_page(cursor)` must return the raw list response. The termination rule
    is the one §2.2 insists on: **stop when the cursor stops changing**, because
    the last page returns the same cursor it was sent.

    The two intuitive conditions are both wrong and both fail silently:
    `len(documents) == 0` misses that the terminal page is where the cursor
    repeats (a non-empty page can be the last one), and `len(documents) < 100`
    is wrong at every page of the `-text` endpoints, which page at 10 (§2.2).

    Lives here rather than in `dip.py` so the contract is stated once, next to
    the transport it depends on.
    """
    cursor: str | None = None
    pages = 0
    while True:
        payload = fetch_page(cursor)
        documents = payload.get("documents") or []
        yield from documents
        pages += 1

        next_cursor = payload.get("cursor")
        if not next_cursor or next_cursor == cursor:
            return
        if max_pages is not None and pages >= max_pages:
            logger.info("Stopping pagination at the %d-page limit", max_pages)
            return
        cursor = next_cursor
