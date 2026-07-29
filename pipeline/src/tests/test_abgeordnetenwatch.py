"""The supplementary roster source.

Community-run and CC0, and consulted for exactly two things the official
sources answer late or not at all: mid-period successions, and the
occupation/education enrichment that joins to the roster by Stammdaten id
(docs/api-research.md §4.3, §7.3).

The `/polls` endpoint is deliberately not used, and
`test_the_dead_poll_endpoints_are_gone` is the guard on that decision rather
than a comment asserting it.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from bundestrack.api import abgeordnetenwatch as module
from bundestrack.api.abgeordnetenwatch import (
    LEGISLATURE_IDS,
    AbgeordnetenwatchClient,
    parse_mandates,
    parse_politicians,
    politician_stammdaten_index,
)
from tests.conftest import fixture_json, mock_client


@pytest.fixture(scope="module")
def mandate_page() -> dict[str, Any]:
    return fixture_json("abgeordnetenwatch", "candidacies_mandates_page.json")


@pytest.fixture(scope="module")
def politician_page() -> dict[str, Any]:
    return fixture_json("abgeordnetenwatch", "politicians_page.json")


# --- the retired poll route ------------------------------------------------


def test_the_dead_poll_endpoints_are_gone() -> None:
    """§4.3: the poll set is curated, and nothing consumed it.

    `iter_polls` and `get_poll_votes` were built, tested, and never called from
    any pipeline stage — the same class of bug as `ef687e5`. Measured
    2026-07-29, the endpoint offers 63 polls against ~1 015 official named
    votes, and what it adds beyond the official sheets is volunteer-written
    prose (`field_intro`) plus restatements of DIP fields Bundestrack already
    takes from DIP.

    This asserts the removal rather than trusting a comment: a future re-add
    should be a deliberate act that fails this test and has to answer for
    itself.
    """
    for dead in ("iter_polls", "get_poll_votes"):
        assert not hasattr(AbgeordnetenwatchClient, dead), (
            f"{dead} was removed as dead code — see the module docstring. "
            "Re-adding it needs a caller and a reason."
        )
    for dead in ("parse_votes", "tally", "VOTE_VALUES"):
        assert not hasattr(module, dead), f"{dead} existed only to serve the poll route"


# --- legislature ids -------------------------------------------------------


def test_the_legislature_ids_cover_the_documented_periods() -> None:
    # §4.3, verified live: WP21 = 161 is the id the mandate filter needs.
    assert LEGISLATURE_IDS[21] == 161
    assert LEGISLATURE_IDS[20] == 132


def test_a_period_this_source_does_not_cover_is_named_in_the_error(no_pacing: None) -> None:
    """Coverage starts at WP16; Bundestrack backfills to WP14 (§4.3).

    So this is a routine outcome of a historical backfill rather than a bug, and
    the caller in `sync._reconcile_mandates` turns it into a note. It still has
    to be an exception rather than an empty iterator: an empty mandate list is
    indistinguishable from "the roster is complete", which is the opposite
    conclusion.
    """
    client = AbgeordnetenwatchClient(client=mock_client(lambda r: httpx.Response(200, json={})))

    with pytest.raises(ValueError, match="Wahlperiode 14"):
        list(client.get_mandates(14))


# --- the mandate feed ------------------------------------------------------


def test_mandates_are_filtered_to_one_parliament_and_to_mandates(no_pacing: None) -> None:
    """Two filters, both load-bearing, both verified live.

    `parliament_period` — not `field_legislature`, which answers **500** here
    even though it is what `/polls` required. Unfiltered, the collection returns
    every German parliament abgeordnetenwatch tracks (its first page holds
    Rheinland-Pfalz and Nordrhein-Westfalen rows), so a dropped filter does not
    narrow badly, it silently mixes chambers.

    `type=mandate` — the collection is *candidacies*-mandates. Without it the
    response also carries people who merely stood for election, and reporting a
    losing candidate as a sitting member is exactly the error this stage exists
    to prevent.
    """
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": [{"id": 1}], "meta": {"result": {"total": 1}}})

    client = AbgeordnetenwatchClient(client=mock_client(handler))
    assert len(list(client.get_mandates(21))) == 1
    assert seen[0].url.params["parliament_period"] == "161"
    assert seen[0].url.params["type"] == "mandate"


def test_the_stammdaten_bridge_joins_by_politician_id(mandate_page, politician_page) -> None:
    """§7: the join runs `politician.id` → `ext_id_bundestagsverwaltung`.

    That is the whole reason this source is usable at all — it is the one
    external source that reaches the roster by id rather than by name, so none
    of §7.1's name-matching failure modes apply.
    """
    index = politician_stammdaten_index(politician_page["data"])
    mandates = parse_mandates(mandate_page["data"], index)

    resolved = {m["name"]: m["stammdaten_id"] for m in mandates if m["stammdaten_id"]}
    assert resolved["Katrin Zschau"] == "11005268"
    assert resolved["Michael Breilmann"] == "11005032"
    # 8-digit, i.e. the Stammdaten id space — not abgeordnetenwatch's own.
    assert all(len(value) == 8 for value in resolved.values())


def test_a_mandate_without_a_stammdaten_id_is_kept_as_unresolved(
    mandate_page, politician_page
) -> None:
    """Preserved, never guessed at.

    Christoph Naser and Stefan Glaser both entered on 2026-05-27 and carry no
    `ext_id_bundestagsverwaltung` (measured 2026-07-29, and reproduced by this
    fixture pair). A name match would turn a visible "cannot resolve" into an
    invisible "resolved to whoever fuzzy-matched", which is strictly worse.
    """
    index = politician_stammdaten_index(politician_page["data"])
    mandates = parse_mandates(mandate_page["data"], index)

    unresolved = {m["name"] for m in mandates if m["stammdaten_id"] is None}
    assert unresolved == {"Christoph Naser", "Stefan Glaser"}


def test_the_id_external_administration_is_not_the_stammdaten_id(mandate_page) -> None:
    """The trap this fixture exists to pin down.

    Every mandate carries `id_external_administration`, it is numeric, and it is
    populated on 629 of 630 — so it looks exactly like the key to join on. It is
    a 3–4 digit id from a different space. Bilger's mandate carries `1566` while
    his Stammdaten id is `11004011` and his DIP person id is `1013` (§7), so
    joining on it matches the *wrong member* rather than failing.
    """
    external = [
        row.get("id_external_administration")
        for row in mandate_page["data"]
        if row.get("id_external_administration")
    ]
    assert external, "the fixture should carry at least one"
    assert all(len(str(value)) < 8 for value in external)


def test_a_succession_keeps_the_published_note_and_date(mandate_page, politician_page) -> None:
    """§7.3's whole point: this source is *fresher* than the Stammdaten ZIP.

    The note names the predecessor and the date — *"ist am 20.07.2026 für Frank
    Junge in den Deutschen Bundestag nachgerückt"* — which is what tells an
    operator how far behind the snapshot has fallen. Kept whole rather than
    parsed for the predecessor's name: it is free prose, and a regex over it
    would invent a person.
    """
    index = politician_stammdaten_index(politician_page["data"])
    mandates = parse_mandates(mandate_page["data"], index)
    zschau = next(m for m in mandates if m["name"] == "Katrin Zschau")

    assert zschau["start_date"] == "2026-07-20"
    assert "Frank Junge" in zschau["info"]
    assert zschau["entered_mid_period"] is True


def test_entering_mid_period_comes_from_the_source_not_from_the_date(
    politician_page,
) -> None:
    """`mandate_won == "moved_up"` is the source's own claim, and is what is read.

    A date-based rule — "started after the period began" — would mark every
    member of a period whose start date the snapshot records imprecisely, and
    would be Bundestrack asserting a succession nobody published.
    """
    index = politician_stammdaten_index(politician_page["data"])
    ordinary = parse_mandates(
        [
            {
                "id": 1,
                "label": "Someone (Bundestag 2025 - 2029)",
                "politician": {"id": 184332},
                "start_date": "2026-01-01",
                "electoral_data": {"mandate_won": "won"},
            }
        ],
        index,
    )
    assert ordinary[0]["entered_mid_period"] is False
    assert ordinary[0]["start_date"] == "2026-01-01"


def test_the_period_suffix_is_stripped_from_a_mandate_label(mandate_page, politician_page) -> None:
    # Labels read `Katrin Zschau (Bundestag 2025 - 2029)`; the suffix would
    # defeat any comparison against a roster name.
    index = politician_stammdaten_index(politician_page["data"])
    mandates = parse_mandates(mandate_page["data"], index)

    assert all("(" not in m["name"] for m in mandates)
    assert any(m["name"] == "Katrin Zschau" for m in mandates)


# --- enrichment ------------------------------------------------------------


def test_politicians_are_keyed_by_the_stammdaten_id(politician_page) -> None:
    # §7: keyed by what the roster is keyed by, which is the whole reason this
    # source beats a name-matched one for enrichment.
    enriched = parse_politicians(politician_page["data"])

    assert "11005268" in enriched
    assert set(next(iter(enriched.values()))) == {"occupation", "education"}


def test_a_politician_with_no_stammdaten_id_is_skipped(politician_page) -> None:
    # It has nothing to enrich and no key to enrich it under.
    enriched = parse_politicians([{"id": 1, "occupation": "Anwalt"}])
    assert enriched == {}
