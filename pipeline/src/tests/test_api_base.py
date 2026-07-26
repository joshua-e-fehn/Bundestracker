"""The transport contract: sequential, non-redirecting, and paced.

These are the properties docs/api-research.md §2.6 says an IP block depends on,
so they are tested as behaviour rather than trusted to review.
"""

from __future__ import annotations

import threading

import httpx
import pytest

from bundestrack.api.base import (
    AuthenticationError,
    BundestagAPIError,
    BundestagClient,
    ConcurrentFetchError,
    NotFound,
    RateLimited,
    paginate_cursor,
)
from tests.conftest import mock_client


def _responder(*responses: httpx.Response):
    """Serve a queued list of responses, recording the requests."""
    queue = list(responses)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0) if queue else httpx.Response(200, json={})

    handler.requests = seen  # type: ignore[attr-defined]
    return handler


# --- the WAF ---------------------------------------------------------------


def test_enodia_challenge_is_not_followed_and_not_read_as_data(no_pacing: None) -> None:
    """A 303 to the challenge must raise, not return an HTML page as JSON.

    §2.6's diagnostic tell is a `JSONDecodeError` on line 1 — what a client that
    followed the redirect sees. The whole point of `follow_redirects=False` is
    that the caller learns it was blocked instead.
    """
    challenge = httpx.Response(
        303, headers={"location": "/.enodia/challenge?redirect=%2Fapi%2Fv1%2Fperson"}
    )
    handler = _responder(*[challenge] * 6)
    client = BundestagClient(
        base_url="https://search.dip.bundestag.de", client=mock_client(handler)
    )

    with pytest.raises(RateLimited, match="blocked after"):
        client.get_json("person")


def test_a_challenge_that_clears_is_retried_rather_than_failing(no_pacing: None) -> None:
    # A single challenge should cost a backoff, not the run — §2.6's backoff
    # schedule exists precisely for the case that has not yet escalated.
    handler = _responder(
        httpx.Response(303, headers={"location": "/.enodia/challenge"}),
        httpx.Response(200, json={"numFound": 1, "documents": [], "cursor": "x"}),
    )
    client = BundestagClient(base_url="https://example.test", client=mock_client(handler))

    assert client.get_json("person")["numFound"] == 1
    assert len(handler.requests) == 2  # type: ignore[attr-defined]


def test_an_ordinary_redirect_is_still_refused(no_pacing: None) -> None:
    # These hosts do not legitimately redirect. One that is *not* the WAF is
    # still not a document, and following it would be how an HTML error page
    # gets parsed as data.
    handler = _responder(
        httpx.Response(302, headers={"location": "https://example.test/elsewhere"})
    )
    client = BundestagClient(base_url="https://example.test", client=mock_client(handler))

    with pytest.raises(BundestagAPIError, match="Unexpected 302"):
        client.get_json("person")


def test_a_timeout_is_treated_as_the_waf_escalating(no_pacing: None) -> None:
    # §2.6: once escalated the WAF stops answering rather than challenging, so a
    # timeout here is more likely a block than a slow server.
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    client = BundestagClient(
        base_url="https://example.test", client=mock_client(handler), max_retries=1
    )

    with pytest.raises(RateLimited):
        client.get_json("person")


# --- sequential fetching ---------------------------------------------------


def test_a_concurrent_fetch_is_refused_rather_than_serialised(no_pacing: None) -> None:
    """Two threads fetching at once must raise.

    Blocking on a lock would make a threaded caller *look* correct while
    doubling the request rate — the arithmetic that IP-blocked every
    bundestag.de host in research (§2.6).
    """
    entered = threading.Event()
    release = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        entered.set()
        release.wait(timeout=5)
        return httpx.Response(200, json={})

    client = BundestagClient(base_url="https://example.test", client=mock_client(handler))
    errors: list[Exception] = []

    first = threading.Thread(target=lambda: client.get_json("a"))
    first.start()
    entered.wait(timeout=5)
    try:
        client.get_json("b")
    except ConcurrentFetchError as error:  # expected
        errors.append(error)
    finally:
        release.set()
        first.join(timeout=5)

    assert errors, "a second concurrent request should have been refused"
    assert "sequentially" in str(errors[0])


def test_requests_are_spaced_by_the_configured_interval() -> None:
    handler = _responder(*[httpx.Response(200, json={})] * 3)
    client = BundestagClient(
        base_url="https://example.test", client=mock_client(handler), min_interval=0.05
    )

    import time

    start = time.monotonic()
    for _ in range(3):
        client.get_json("person")
    elapsed = time.monotonic() - start

    # Two gaps between three requests. Asserting a lower bound only: the point
    # is that the delay happens, not how precisely the clock lands.
    assert elapsed >= 0.09


# --- error taxonomy --------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "body", "expected", "message"),
    [
        (401, {"code": 401, "message": "An API key is required"}, AuthenticationError, "API key"),
        (404, {"code": 404, "message": "ID not found: 11004011"}, NotFound, "11004011"),
        (400, {"code": 400, "message": "Invalid cursor"}, BundestagAPIError, "Invalid cursor"),
    ],
)
def test_errors_carry_the_apis_own_message(
    no_pacing: None, status: int, body: dict, expected: type[Exception], message: str
) -> None:
    # DIP's message distinguishes an expired key from an absent one and names
    # the id that was not found (§1.4) — more use than the status alone.
    handler = _responder(httpx.Response(status, json=body))
    client = BundestagClient(base_url="https://example.test", client=mock_client(handler))

    with pytest.raises(expected, match=message):
        client.get_json("person")


def test_html_where_json_was_expected_names_the_likely_cause(no_pacing: None) -> None:
    handler = _responder(httpx.Response(200, text="<html><title>Enodia Verification</title>"))
    client = BundestagClient(base_url="https://example.test", client=mock_client(handler))

    with pytest.raises(BundestagAPIError, match="WAF challenge"):
        client.get_json("person")


# --- cursor pagination -----------------------------------------------------


def test_pagination_stops_when_the_cursor_stops_changing() -> None:
    """§2.2's only reliable termination rule, verified live.

    The terminal page returns the *same* cursor it was sent — confirmed against
    `/person?f.person=Bilger Steffen`, which answered `numFound: 1` with an
    unchanged cursor and zero documents on page two.
    """
    pages = [
        {"documents": [{"id": "1"}, {"id": "2"}], "cursor": "AAA"},
        {"documents": [{"id": "3"}], "cursor": "BBB"},
        {"documents": [], "cursor": "BBB"},  # unchanged -> done
    ]
    seen_cursors: list[str | None] = []

    def fetch(cursor: str | None) -> dict:
        seen_cursors.append(cursor)
        return pages[len(seen_cursors) - 1]

    assert [d["id"] for d in paginate_cursor(fetch)] == ["1", "2", "3"]
    assert seen_cursors == [None, "AAA", "BBB"]


def test_a_short_page_does_not_end_pagination() -> None:
    """`len(documents) < 100` is the wrong condition and §2.2 says so.

    It is wrong on *every* page of the two `-text` endpoints, which page at 10.
    """
    pages = [
        {"documents": [{"id": "1"}], "cursor": "AAA"},  # short, but not the last
        {"documents": [{"id": "2"}], "cursor": "BBB"},
        {"documents": [{"id": "3"}], "cursor": "BBB"},
    ]
    calls = iter(pages)

    assert len(list(paginate_cursor(lambda _cursor: next(calls)))) == 3


def test_an_empty_page_mid_stream_does_not_end_pagination() -> None:
    # The other wrong condition from §2.2: terminating on an empty page.
    pages = [
        {"documents": [], "cursor": "AAA"},
        {"documents": [{"id": "1"}], "cursor": "BBB"},
        {"documents": [], "cursor": "BBB"},
    ]
    calls = iter(pages)

    assert [d["id"] for d in paginate_cursor(lambda _cursor: next(calls))] == ["1"]


def test_a_missing_cursor_ends_pagination_rather_than_looping() -> None:
    calls = iter([{"documents": [{"id": "1"}], "cursor": None}])

    assert len(list(paginate_cursor(lambda _cursor: next(calls)))) == 1
