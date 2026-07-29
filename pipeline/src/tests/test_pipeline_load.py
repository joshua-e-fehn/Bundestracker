"""Writing to Convex: batching, retries, and what must not be retried.

Nothing here touches the network — `MockTransport` stands in for it, as
everywhere else in this suite. What is under test is the pipeline's half of the
contract in webapp/convex/http.ts and webapp/convex/lib/ingest.ts: the batch
ceiling, the Bearer key, and the line between a transport failure worth
retrying and a data error that would fail identically tomorrow.
"""

from __future__ import annotations

import json

import httpx
import pytest

from bundestrack.pipeline.load import (
    MAX_BATCH,
    BatchResult,
    ConvexAuthError,
    ConvexError,
    ConvexLoader,
    chunked,
)
from tests.conftest import mock_client


def recording_loader(
    handler, *, dry_run: bool = False, max_retries: int = 2
) -> tuple[ConvexLoader, list[httpx.Request]]:
    """A loader whose requests are captured rather than sent."""
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    loader = ConvexLoader(
        "https://example.convex.site",
        "test-key",
        dry_run=dry_run,
        max_retries=max_retries,
        client=mock_client(record),
    )
    return loader, seen


def ok(inserted: int = 0, updated: int = 0):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"inserted": inserted, "updated": updated})

    return handler


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove the retry sleep.

    Patched at `time.sleep` inside the module rather than by lowering the
    constants, so the production backoff stays under test everywhere else —
    the same approach as the `no_pacing` fixture for the source clients.
    """
    import bundestrack.pipeline.load as load

    monkeypatch.setattr(load.time, "sleep", lambda _seconds: None)


# --- batching -------------------------------------------------------------


def test_batches_are_chunked_to_the_ceiling_convex_enforces() -> None:
    """`MAX_BATCH` mirrors webapp/convex/lib/ingest.ts, which *rejects* an
    oversized batch rather than truncating it — so an unchunked 80 537-record
    backfill is one 400, not a slow success."""
    assert [len(batch) for batch in chunked(list(range(1_200)))] == [500, 500, 200]
    assert list(chunked([])) == [], "an empty input posts nothing at all"


def test_a_large_roster_is_split_across_requests() -> None:
    loader, seen = recording_loader(ok(inserted=1))
    payloads = [{"internalId": f"bt-{i}"} for i in range(MAX_BATCH + 1)]

    result = loader.upsert_mps(payloads)

    assert result.requests == 2
    assert len(json.loads(seen[0].content)["mps"]) == MAX_BATCH
    assert len(json.loads(seen[1].content)["mps"]) == 1


def test_one_ballots_records_go_to_the_route_that_keys_on_the_ballot() -> None:
    # Keyed by `(wahlperiode, sitzungnr, abstimmnr)` rather than a Convex id,
    # so the pipeline posts a parsed sheet without a round-trip first.
    loader, seen = recording_loader(ok(inserted=2))

    loader.upsert_vote_records(
        {
            "wahlperiode": 21,
            "sitzungnr": 90,
            "abstimmnr": 8,
            "records": [{"mpInternalId": "bt-1"}, {"mpInternalId": "bt-2"}],
        }
    )

    body = json.loads(seen[0].content)
    assert seen[0].url.path == "/api/pipeline/vote-records"
    assert (body["wahlperiode"], body["sitzungnr"], body["abstimmnr"]) == (21, 90, 8)
    assert len(body["records"]) == 2


def test_a_single_row_mutations_created_flag_is_counted_as_a_batch_result() -> None:
    # `upsertVoteSheet` and `linkDipPersonId` answer `{created}`, not
    # `{inserted, updated}` — the pipeline's stage reports have to add up
    # regardless of which shape a route returns.
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"created": True})

    loader, _ = recording_loader(handler)

    result = loader.link_dip_persons([{"internalId": "bt-1"}, {"internalId": "bt-2"}])

    assert (result.inserted, result.updated) == (2, 0)


# --- authentication -------------------------------------------------------


def test_the_shared_key_is_sent_as_a_bearer_token() -> None:
    loader, seen = recording_loader(ok())

    loader.post("mps", {"mps": []})

    assert seen[0].headers["Authorization"] == "Bearer test-key"


def test_a_401_names_both_places_the_key_has_to_be_set() -> None:
    """webapp/convex/http.ts denies on an *unset* deployment key rather than
    allowing, so "the key is missing" is as likely to be the far side."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Unauthorized"})

    loader, seen = recording_loader(handler)

    with pytest.raises(ConvexAuthError, match="PIPELINE_API_KEY"):
        loader.post("mps", {"mps": []})
    assert len(seen) == 1, "a wrong key is not retried"


def test_health_checks_the_key_before_a_long_sync() -> None:
    # The endpoint exists so a rotated key surfaces as one clean 401 at the
    # start rather than as several thousand of them an hour in.
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    loader, seen = recording_loader(handler)

    assert loader.health() is True
    assert seen[0].url.path == "/api/pipeline/health"


# --- retries --------------------------------------------------------------


def test_a_5xx_is_retried() -> None:
    responses = [httpx.Response(503, text="upstream"), httpx.Response(200, json={"inserted": 1})]

    def handler(_request: httpx.Request) -> httpx.Response:
        return responses.pop(0)

    loader, seen = recording_loader(handler)

    assert loader.post("mps", {"mps": []}) == {"inserted": 1}
    assert len(seen) == 2


def test_a_400_is_not_retried_and_passes_the_message_through() -> None:
    """The ingestion mutations throw only on precondition failures — an MP not
    on the roster, a sheet not yet ingested, a field the validator rejects.

    Every one is deterministic, so retrying produces the same 400 tomorrow
    while burying the message that names what was wrong.
    """

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "MP not found: bt-11009999 in Wahlperiode 21."})

    loader, seen = recording_loader(handler)

    with pytest.raises(ConvexError, match="MP not found: bt-11009999"):
        loader.post("mps", {"mps": []})
    assert len(seen) == 1


def test_a_transport_failure_is_retried_then_reported() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    loader, seen = recording_loader(handler, max_retries=2)

    with pytest.raises(ConvexError, match="after 3 attempts"):
        loader.post("mps", {"mps": []})
    assert len(seen) == 3


# --- dry runs -------------------------------------------------------------


def test_a_dry_run_sends_nothing() -> None:
    loader, seen = recording_loader(ok(inserted=99), dry_run=True)

    result = loader.upsert_mps([{"internalId": "bt-1"}])

    assert seen == []
    assert result.written == 0


def test_a_dry_run_still_catches_an_unserialisable_payload() -> None:
    """Not ceremony: a `datetime.date` or a `set` left in a payload raises
    here, in a mode that touches nothing, rather than at 3 a.m. against a live
    deployment."""
    import datetime as dt

    loader, _ = recording_loader(ok(), dry_run=True)

    with pytest.raises(TypeError):
        loader.post("mps", {"date": dt.date(2026, 7, 10)})


# --- score recomputation --------------------------------------------------


def test_score_recomputation_walks_every_slice() -> None:
    """Sliced because scoring one MP reads their activities, speeches, votes
    and committees, so the whole chamber does not fit in one Convex
    transaction (webapp/convex/scoreSweep.ts).

    ⚠ The cursor is the `internalId` the previous slice ended on, not an offset.
    It starts as `None` — "the beginning of the roster" — because the route seeks
    with `.gt("internalId", cursor)`, and there is no member to start after.
    """
    pages = [
        {"scored": 50, "nextCursor": "bt-0050", "hasMore": True},
        {"scored": 30, "nextCursor": "bt-0080", "hasMore": False},
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pages.pop(0))

    loader, seen = recording_loader(handler)

    assert loader.recompute_scores(21) == 80
    assert [json.loads(request.content)["cursor"] for request in seen] == [
        None,
        "bt-0050",
    ]


def test_a_cursor_that_stops_moving_ends_the_loop() -> None:
    # The loop's termination depends on a remote answer, so a deployment that
    # kept saying `hasMore` with an unchanged cursor would otherwise spin.
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"scored": 1, "nextCursor": "bt-0008", "hasMore": True})

    loader, seen = recording_loader(handler)

    # Two, not one: the first slice advances the cursor from None to "bt-0008",
    # which is real progress. The second is handed the same answer it already
    # holds, and *that* is what stops the walk.
    assert loader.recompute_scores(21) == 2
    assert len(seen) == 2


def test_the_stall_guard_survives_a_cursor_of_a_different_type() -> None:
    """The guard must compare like with like, or it never fires.

    The bug this exists for: coercing the response *after* comparing it against
    the stored cursor makes `"bt-1" == "bt-1"` the only case that stops the loop
    and `0 == "0"` slip through — so a deployment answering with an unchanged
    cursor in the other representation would be walked `max_slices` times. Both
    sides are stringified before the comparison for exactly this reason.
    """

    def handler(_request: httpx.Request) -> httpx.Response:
        # A number where a string is expected — what an older deployment, or a
        # half-rolled-back one, would answer with.
        return httpx.Response(200, json={"scored": 1, "nextCursor": 8, "hasMore": True})

    loader, seen = recording_loader(handler)

    assert loader.recompute_scores(21) == 2
    assert len(seen) == 2
    # The second request carries the *coerced* cursor, so the deployment sees a
    # string wherever it looks.
    assert json.loads(seen[1].content)["cursor"] == "8"


# --- reporting ------------------------------------------------------------


def test_the_insert_update_split_is_what_makes_a_bad_key_visible() -> None:
    """An incremental sync reporting thousands of inserts every night is one
    whose natural key has stopped matching — otherwise a silent failure."""
    result = BatchResult("MPs")
    result.record({"inserted": 3, "updated": 627})
    result.skipped = 2

    assert result.written == 630
    assert "3 new, 627 updated" in str(result)
    assert "2 skipped" in str(result)
