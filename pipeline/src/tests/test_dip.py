"""The DIP client, against recorded responses from the live API.

The fixtures are real pages fetched on 2026-07-26, trimmed to a couple of
documents each. That matters most for `person_page1.json`: the two OpenAPI spec
bugs in §6.1 are not hypothetical, and a hand-written fixture would encode the
spec rather than the API.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from bundestrack.api.dip import (
    API_KEY_PATTERN,
    PUBLISHED_API_KEY,
    DIPClient,
)
from bundestrack.models.dip import Person, Vorgangsposition
from tests.conftest import fixture_json, mock_client


def dip_client(handler, **kwargs: Any) -> DIPClient:
    return DIPClient(
        api_key="test-key",
        client=mock_client(handler),
        base_url="https://dip.test/api/v1",
        **kwargs,
    )


def serve(pages: dict[str, Any]):
    """Serve fixtures by endpoint path, recording every request."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        endpoint = request.url.path.rsplit("/", 1)[-1]
        payload = pages.get(endpoint)
        if payload is None:
            return httpx.Response(404, json={"code": 404, "message": f"no fixture for {endpoint}"})
        # Second call for the same endpoint returns the terminal page: same
        # cursor back, which is what stops pagination (§2.2).
        if any(r.url.path == request.url.path for r in seen[:-1]):
            return httpx.Response(
                200,
                json={
                    "numFound": payload["numFound"],
                    "cursor": payload["cursor"],
                    "documents": [],
                },
            )
        return httpx.Response(200, json=payload)

    handler.requests = seen  # type: ignore[attr-defined]
    return handler


# --- authentication --------------------------------------------------------


def test_the_key_goes_in_the_header_not_the_query_string(no_pacing: None) -> None:
    """§1.3: both work, but a key in a URL leaks into every log that echoes it."""
    handler = serve({"person": fixture_json("dip", "person_page1.json")})
    list(dip_client(handler).iter_personen(21))

    request = handler.requests[0]  # type: ignore[attr-defined]
    assert request.headers["Authorization"] == "ApiKey test-key"
    assert "apikey" not in str(request.url)


def test_a_rotated_key_is_healed_from_the_openapi_spec(no_pacing: None) -> None:
    """§1.2: the Bundestag publishes a working key inside its own spec.

    The spec is served unauthenticated, so a 401 does not block the route to
    fixing itself — which is what keeps an overnight rotation from taking the
    pipeline down until someone notices.
    """
    spec = (
        "components:\n  securitySchemes:\n    ApiKeyHeader:\n"
        "      description: 'Beispiel: *ApiKey NEWKEY1.abcdefghijklmnopqrstuvwxyz012345*'\n"
    )
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.path.endswith("openapi.yaml"):
            return httpx.Response(200, text=spec)
        if (
            request.headers.get("Authorization")
            == "ApiKey NEWKEY1.abcdefghijklmnopqrstuvwxyz012345"
        ):
            return httpx.Response(200, json=fixture_json("dip", "person_page1.json"))
        return httpx.Response(401, json={"code": 401, "message": "An API key is required"})

    client = dip_client(handler)
    people = list(client.iter_personen(21))

    assert people, "the healed key should have completed the request"
    assert client.api_key == "NEWKEY1.abcdefghijklmnopqrstuvwxyz012345"
    assert any("openapi.yaml" in c for c in calls)


def test_healing_is_attempted_once_rather_than_looped(no_pacing: None) -> None:
    # If the freshly published key is also rejected, this is not a rotation.
    # Retrying would just walk into the WAF (§2.6).
    spec = "securitySchemes: 'Beispiel: *ApiKey SAME123.abcdefghijklmnopqrstuvwxyz0*'"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("openapi.yaml"):
            return httpx.Response(200, text=spec)
        return httpx.Response(401, json={"code": 401, "message": "An API key is required"})

    from bundestrack.api.base import AuthenticationError

    with pytest.raises(AuthenticationError):
        list(dip_client(handler).iter_personen(21))


def test_the_published_key_is_the_one_the_spec_advertises() -> None:
    # A regression guard on the constant: it must be parseable by the same
    # pattern used to heal, or healing would produce a key shape we reject.
    assert API_KEY_PATTERN.search(f"Beispiel: *ApiKey {PUBLISHED_API_KEY}*")


def test_healing_can_be_disabled(no_pacing: None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"code": 401, "message": "An API key is required"})

    from bundestrack.api.base import AuthenticationError

    client = dip_client(handler, self_heal_key=False)
    with pytest.raises(AuthenticationError):
        list(client.iter_personen(21))


# --- filters ---------------------------------------------------------------


def test_protocol_queries_are_scoped_to_the_bundestag_by_default(no_pacing: None) -> None:
    """§5.1: unfiltered protocol queries mix in Bundesrat rows.

    Three concrete consequences: BR rows carry no XML, so they yield zero
    speeches; their `dokumentnummer` is a bare running number that any
    `.split("/")` misparses; and they live under a different URL tree.
    """
    handler = serve({"plenarprotokoll": fixture_json("dip", "plenarprotokoll_page.json")})
    list(dip_client(handler).iter_plenarprotokolle(21))

    assert handler.requests[0].url.params["f.zuordnung"] == "BT"  # type: ignore[attr-defined]


def test_zuordnung_is_not_sent_to_endpoints_that_do_not_accept_it(no_pacing: None) -> None:
    # §2.4's matrix: `/vorgang` and `/person` take no `f.zuordnung`. Sending it
    # is ignored rather than rejected, which is how a filter comes to look
    # applied when it is not.
    handler = serve({"vorgang": fixture_json("dip", "vorgang_page.json")})
    list(dip_client(handler).iter_vorgaenge(21))

    assert "f.zuordnung" not in handler.requests[0].url.params  # type: ignore[attr-defined]


def test_an_explicit_zuordnung_overrides_the_default(no_pacing: None) -> None:
    handler = serve({"plenarprotokoll": fixture_json("dip", "plenarprotokoll_page.json")})
    list(dip_client(handler).iter_plenarprotokolle(21, **{"f.zuordnung": "BR"}))

    assert handler.requests[0].url.params["f.zuordnung"] == "BR"  # type: ignore[attr-defined]


def test_a_daily_sync_filters_on_aktualisiert_not_datum(no_pacing: None) -> None:
    # §2.5: documents are amended retroactively, so a `datum`-based sync misses
    # exactly the edits a daily run exists to catch.
    handler = serve({"aktivitaet": fixture_json("dip", "aktivitaet_page.json")})
    list(dip_client(handler).iter_aktivitaeten(21, updated_since="2026-07-01T00:00:00+02:00"))

    params = handler.requests[0].url.params  # type: ignore[attr-defined]
    assert params["f.aktualisiert.start"] == "2026-07-01T00:00:00+02:00"
    assert "f.datum.start" not in params


def test_page_size_is_ten_for_the_text_endpoints() -> None:
    # §2.2: declared as `maxItems` on the schemas, and it wrecks any request
    # estimate that assumes 100.
    assert DIPClient.page_size("plenarprotokoll") == 100
    assert DIPClient.page_size("plenarprotokoll-text") == 10
    assert DIPClient.page_size("drucksache-text") == 10


# --- the spec bugs ---------------------------------------------------------


def test_person_fields_typed_string_arrive_as_arrays(no_pacing: None) -> None:
    """Spec bug 1 (§6.1), re-verified live: 100/100 records had list `funktion`.

    A client generated faithfully from the spec rejects every real response.
    """
    handler = serve({"person": fixture_json("dip", "person_page1.json")})
    people = list(dip_client(handler).iter_personen(21))

    roth = next(p for p in people if p.id == "8190")
    assert roth.funktion == "MdB"  # unwrapped from ["MdB"]
    assert roth.fraktion == "BÜNDNIS 90/DIE GRÜNEN"
    assert isinstance(roth.funktion, str)


def test_person_roles_validate_without_the_required_funktion(no_pacing: None) -> None:
    """Spec bug 2 (§6.1): declared required, present in 0 of 2 503 role objects.

    Re-verified here at 0 of 33. A strict validator rejects every response.
    """
    handler = serve({"person": fixture_json("dip", "person_page1.json")})
    people = list(dip_client(handler).iter_personen(21))

    roles = [r for p in people for r in p.person_roles]
    assert roles, "the fixture should carry person_roles"
    assert all(r.funktion is None for r in roles)
    # The role kind is inferable from which fields are set instead (§6.1).
    assert any(r.ressort_titel for r in roles)


def test_unknown_fields_are_kept_rather_than_rejected() -> None:
    # `xml_hash` is the precedent: returned on every protocol, absent from the
    # spec. A model that raised on a new field would fail on the day the
    # Bundestag publishes more data.
    person = Person.model_validate(
        {
            "id": "1",
            "nachname": "Test",
            "vorname": "T",
            "typ": "Person",
            "titel": "T Test",
            "aktualisiert": "2026-01-01T00:00:00+01:00",
            "a_field_invented_tomorrow": "value",
        }
    )
    assert person.model_extra["a_field_invented_tomorrow"] == "value"


def test_a_person_without_wahlperiode_still_validates() -> None:
    # §6.1: eight records omit `wahlperiode`, `datum` and `basisdatum` entirely.
    person = Person.model_validate(
        {
            "id": "1",
            "nachname": "Test",
            "vorname": "T",
            "typ": "Person",
            "titel": "T Test",
            "aktualisiert": "2026-01-01T00:00:00+01:00",
        }
    )
    assert person.wahlperiode == []
    assert person.datum is None


def test_the_undocumented_xml_hash_is_captured(no_pacing: None) -> None:
    # §5.1: absent from the spec, present on every BT protocol, and the field a
    # sync needs to skip re-downloading ~1.2 MB of unchanged XML.
    handler = serve({"plenarprotokoll": fixture_json("dip", "plenarprotokoll_page.json")})
    protocols = list(dip_client(handler).iter_plenarprotokolle(21))

    assert all(p.xml_hash for p in protocols)
    assert all(p.xml_url for p in protocols)


def test_a_protocols_sitting_number_comes_from_its_dokumentnummer(no_pacing: None) -> None:
    handler = serve({"plenarprotokoll": fixture_json("dip", "plenarprotokoll_page.json")})
    protocol = next(iter(dip_client(handler).iter_plenarprotokolle(21)))

    assert protocol.dokumentnummer == "21/90"
    assert protocol.sitzungsnummer == 90


def test_a_bundesrat_dokumentnummer_yields_no_sitting_number() -> None:
    # §5.1: BR numbering is a bare running number. Returning None beats
    # returning nonsense from a `.split("/")` that found nothing to split.
    from bundestrack.models.dip import Plenarprotokoll

    protocol = Plenarprotokoll.model_validate(
        {
            "id": "1",
            "dokumentart": "Plenarprotokoll",
            "typ": "Dokument",
            "dokumentnummer": "1067",
            "herausgeber": "BR",
            "datum": "2026-01-01",
            "aktualisiert": "2026-01-01T00:00:00+01:00",
            "titel": "BR-Protokoll",
        }
    )
    assert protocol.sitzungsnummer is None


# --- entity semantics ------------------------------------------------------


def test_an_aktivitaet_carries_the_dip_person_id_directly(no_pacing: None) -> None:
    # §3.5: the only DIP source that needs no name matching, which is why the
    # activity score is built on it.
    handler = serve({"aktivitaet": fixture_json("dip", "aktivitaet_page.json")})
    activity = next(iter(dip_client(handler).iter_aktivitaeten(21)))

    assert activity.person_id
    # ⚠ `titel` is the person's name, not a description of the action.
    assert "MdB" in activity.titel
    assert activity.vorgangsbezug[0].titel != activity.titel


def test_a_roll_call_step_is_detectable_from_its_beschlussfassung() -> None:
    # §3.2: `Beschlussfassung` says *that* a named vote happened. The per-MP
    # data is elsewhere entirely — this is only how ballots are discovered.
    position = Vorgangsposition.model_validate(
        {
            "id": "1",
            "vorgangsposition": "Antrag",
            "zuordnung": "BT",
            "gang": True,
            "fortsetzung": False,
            "nachtrag": False,
            "vorgangstyp": "Antrag",
            "typ": "Vorgangsposition",
            "titel": "T",
            "dokumentart": "Plenarprotokoll",
            "vorgang_id": "1",
            "datum": "2026-01-01",
            "aktualisiert": "2026-01-01T00:00:00+01:00",
            "beschlussfassung": [
                {"beschlusstenor": "Annahme", "abstimmungsart": "Namentliche Abstimmung"}
            ],
        }
    )
    assert position.is_namentliche_abstimmung


def _position(**overrides: object) -> Vorgangsposition:
    """A minimal procedure step, for the join-key properties below."""
    document: dict[str, object] = {
        "id": "1",
        "vorgangsposition": "3. Beratung",
        "zuordnung": "BT",
        "gang": True,
        "fortsetzung": False,
        "nachtrag": False,
        "vorgangstyp": "Gesetzgebung",
        "typ": "Vorgangsposition",
        "titel": "T",
        "dokumentart": "Plenarprotokoll",
        "vorgang_id": "1",
        "datum": "2026-07-10",
        "aktualisiert": "2026-07-10T00:00:00+02:00",
    }
    document.update(overrides)
    return Vorgangsposition.model_validate(document)


def _fundstelle(dokumentnummer: str, dokumentart: str = "Plenarprotokoll") -> dict[str, object]:
    return {
        "id": "5806",
        "dokumentnummer": dokumentnummer,
        "datum": "2026-07-10",
        "dokumentart": dokumentart,
        "herausgeber": "BT",
    }


def test_a_ballots_tally_is_read_from_the_head_of_free_text() -> None:
    """`abstimm_ergebnis_bemerkung` opens with `yes:no:abstain` and sometimes
    carries prose after it — a live WP21 value is
    `"539:56:1 (Annahme der Beschlussempfehlung auf Ablehnung)"`.

    This is the only field that tells two ballots in one sitting apart, so
    mis-slicing it would attach the wrong outcome to a vote.
    """
    plain = _position(
        beschlussfassung=[{"beschlusstenor": "A", "abstimm_ergebnis_bemerkung": "519:43:0"}]
    )
    annotated = _position(
        beschlussfassung=[
            {
                "beschlusstenor": "A",
                "abstimm_ergebnis_bemerkung": "539:56:1 (Annahme der Beschlussempfehlung)",
            }
        ]
    )

    assert plain.beschlussfassung[0].tally == (519, 43, 0)
    assert annotated.beschlussfassung[0].tally == (539, 56, 1)


def test_a_tally_behind_leading_prose_is_still_found() -> None:
    """Two live WP21 values put the prose *before* the counts —
    `"übrige Teile; 297:130:134"` and `"Artikel 3, 430:132:0"`.

    An anchored pattern misses both, and the failure is silent: the ballot
    simply keeps an empty outcome. That cost two of WP21's 68 before this.
    """
    for bemerkung, expected in (
        ("übrige Teile; 297:130:134", (297, 130, 134)),
        ("Artikel 3, 430:132:0", (430, 132, 0)),
    ):
        position = _position(
            beschlussfassung=[{"beschlusstenor": "A", "abstimm_ergebnis_bemerkung": bemerkung}]
        )
        assert position.beschlussfassung[0].tally == expected, bemerkung


def test_a_bemerkung_that_is_only_prose_has_no_tally() -> None:
    # The recorded fixture carries exactly this shape, so `split(":")` would
    # raise on real data rather than on a hypothetical.
    prose = _position(
        beschlussfassung=[
            {
                "beschlusstenor": "Überweisung",
                "abstimm_ergebnis_bemerkung": "Festlegung der Federführung gegen den Wunsch",
            }
        ]
    )
    absent = _position(beschlussfassung=[{"beschlusstenor": "Überweisung"}])

    assert prose.beschlussfassung[0].tally is None
    assert absent.beschlussfassung[0].tally is None


def test_the_sitting_key_comes_only_from_a_plenarprotokoll_fundstelle() -> None:
    """⚠ The sibling `beschlussfassung[].dokumentnummer` is a *Drucksache*
    number, and a step can be recorded against one too.

    So an unguarded parse of `"21/216"` yields "sitting 216" — not a parse
    failure but a plausible wrong join, which is the kind this codebase refuses
    to make.
    """
    protocol = _position(fundstelle=_fundstelle("21/90"))
    drucksache = _position(fundstelle=_fundstelle("21/216", "Drucksache"))

    assert protocol.sitzung == (21, 90)
    assert drucksache.sitzung is None
    assert _position().sitzung is None


def test_a_bundesrat_document_number_yields_no_sitting() -> None:
    # §5.1: a bare running number with no slash, which `.split("/")` misparses
    # into nonsense. `Plenarprotokoll.sitzungsnummer` guards the same way.
    assert _position(fundstelle=_fundstelle("1044")).sitzung is None


def test_committee_referrals_keep_the_lead_committee_flag(no_pacing: None) -> None:
    # §3.3: `federfuehrung` separates the lead committee from co-advising ones,
    # which is what lets a metric weight them differently.
    handler = serve({"vorgangsposition": fixture_json("dip", "vorgangsposition_page.json")})
    positions = list(dip_client(handler).iter_vorgangspositionen(21))

    referrals = [u for p in positions for u in p.ueberweisung]
    assert referrals, "the fixture should carry a committee referral"
    assert sum(u.federfuehrung for u in referrals) >= 1


def test_authorship_counts_come_from_anzahl_not_the_truncated_array(no_pacing: None) -> None:
    """§3.4: `autoren_anzeige` has `maxItems: 4`.

    A motion with 40 co-signatories yields 4 ids and `autoren_anzahl: 40`, so
    counting the array systematically under-counts every popular motion.
    """
    handler = serve({"drucksache": fixture_json("dip", "drucksache_page.json")})
    papers = list(dip_client(handler).iter_drucksachen(21))

    truncated = [d for d in papers if d.autoren_anzahl > len(d.autoren_anzeige)]
    assert truncated, "the fixture should include a paper with more authors than displayed"
    assert len(truncated[0].autoren_anzeige) <= 4


def test_pagination_walks_every_page_of_a_collection(no_pacing: None) -> None:
    handler = serve({"person": fixture_json("dip", "person_page1.json")})
    client = dip_client(handler)

    first = fixture_json("dip", "person_page1.json")
    second = fixture_json("dip", "person_page2.json")
    pages = iter([first, second, {"numFound": 803, "cursor": second["cursor"], "documents": []}])

    def paging_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=next(pages))

    client = dip_client(paging_handler)
    people = list(client.iter_personen(21))

    assert len(people) == len(first["documents"]) + len(second["documents"])
