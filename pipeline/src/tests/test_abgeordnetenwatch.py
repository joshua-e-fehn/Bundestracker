"""The supplementary vote source.

Community-run and CC0, with the stable numeric ids the official sheets lack —
but a *curated* poll set (63 for WP21 against ~1 015 official named votes), so
it validates and supplements rather than replaces (docs/api-research.md §4.3).
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from bundestrack.api.abgeordnetenwatch import (
    LEGISLATURE_IDS,
    AbgeordnetenwatchClient,
    parse_votes,
    tally,
)
from bundestrack.models.votes import Vote
from tests.conftest import fixture_json, mock_client


@pytest.fixture(scope="module")
def poll() -> dict[str, Any]:
    return fixture_json("abgeordnetenwatch", "poll_6606.json")


def test_votes_map_onto_the_shared_vocabulary(poll) -> None:
    rows = parse_votes(poll["data"]["related_data"]["votes"])

    assert rows
    assert {r["vote"] for r in rows} <= set(Vote)
    assert all(isinstance(r["vote"], Vote) for r in rows)


def test_a_no_show_is_an_absence_not_an_abstention(poll) -> None:
    """The same distinction the XLSX sheets draw (§4.1).

    `no_show` is *did not vote*; `abstain` is *voted to abstain*. Mapping the
    first onto the second would flatter the participation rate of everyone who
    stayed away.
    """
    rows = parse_votes(poll["data"]["related_data"]["votes"])
    absences = [r for r in rows if r["vote"] is Vote.ABSENT]

    assert absences
    assert all(r["vote"] is not Vote.ABSTAIN for r in absences)


def test_a_structured_absence_reason_is_kept(poll) -> None:
    # The official sheets record this only as free text in `Bemerkung`; here it
    # is a structured value, which is part of what makes this a useful check.
    rows = parse_votes(poll["data"]["related_data"]["votes"])
    reasons = {r["reason_no_show"] for r in rows if r["reason_no_show"]}

    assert "maternity_protection" in reasons


def test_the_mandate_id_is_preserved_for_the_crosswalk(poll) -> None:
    # §4.3: the stable ids are the whole reason to keep this source. The vote
    # sheets have no id column at all.
    rows = parse_votes(poll["data"]["related_data"]["votes"])

    assert all(r["mandate_id"] for r in rows)
    assert all(isinstance(r["mandate_id"], int) for r in rows)


def test_the_period_suffix_is_stripped_from_names(poll) -> None:
    # Labels read `Sanae Abdi (Bundestag 2025 - 2029)`; the suffix would defeat
    # any comparison against a sheet's printed name.
    rows = parse_votes(poll["data"]["related_data"]["votes"])

    assert all("(" not in r["name"] for r in rows)
    assert any(r["name"] == "Sanae Abdi" for r in rows)


def test_an_unknown_vote_value_is_skipped_with_a_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # The vocabulary is the API's and can grow. Guessing would invent a vote;
    # dropping silently would lose one without trace.
    rows = parse_votes([{"id": 1, "vote": "something_new", "mandate": {"id": 1, "label": "X"}}])

    assert rows == []
    assert "something_new" in caplog.text


def test_a_tally_reports_zero_counts(poll) -> None:
    counts = tally(parse_votes(poll["data"]["related_data"]["votes"]))

    assert set(counts) == set(Vote)
    assert counts[Vote.YES] >= 1


def test_the_legislature_ids_cover_the_documented_periods() -> None:
    # §4.3, verified live: WP21 = 161 is the id the poll filter needs.
    assert LEGISLATURE_IDS[21] == 161
    assert LEGISLATURE_IDS[20] == 132


def test_an_unknown_wahlperiode_is_named_in_the_error(no_pacing: None) -> None:
    client = AbgeordnetenwatchClient(client=mock_client(lambda r: httpx.Response(200, json={})))

    with pytest.raises(ValueError, match="Wahlperiode 99"):
        list(client.iter_polls(99))


def test_polls_are_filtered_with_field_legislature(no_pacing: None) -> None:
    """`legislature` is accepted by the router and answers 500 — verified live.

    The working parameter is `field_legislature`.
    """
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": [{"id": 6606}], "meta": {"result": {"total": 1}}})

    client = AbgeordnetenwatchClient(client=mock_client(handler))
    assert len(list(client.iter_polls(21))) == 1
    assert seen[0].url.params["field_legislature"] == "161"


def test_poll_votes_arrive_in_one_request(no_pacing: None, poll) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=poll)

    client = AbgeordnetenwatchClient(client=mock_client(handler))
    votes = client.get_poll_votes(6606)

    assert votes
    assert len(seen) == 1
    assert seen[0].url.params["related_data"] == "votes"
