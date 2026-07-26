"""The join across sources — the one thing no single source can be tested for.

docs/api-research.md §7 calls this the central architectural finding: three
mutually incompatible MP identifier spaces, and two of the four sources with no
usable id at all.

| Source | Identifier | Steffen Bilger |
| --- | --- | --- |
| DIP `/person` | short numeric | `1013` |
| MdB-Stammdaten `<MDB><ID>` | 8-digit | `11004011` |
| Protocol XML `<redner id>` | 8-digit | `11004011` (= Stammdaten) |
| Named-vote XLSX | **none** | — |

So: speeches join to the roster by id (easy), activities join to DIP persons by
id (easy), and everything else is name matching.
"""

from __future__ import annotations

import pytest

from bundestrack.api.protocols import ProtocolClient
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.api.votes import parse_sheet
from bundestrack.models.stammdaten import NameIndex
from tests.conftest import fixture_bytes


@pytest.fixture(scope="module")
def dump():
    return StammdatenClient.parse_zip(fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip"))


@pytest.fixture(scope="module")
def protocol():
    return ProtocolClient.parse(fixture_bytes("protocols", "21090_excerpt.xml"))


def test_a_speech_joins_to_the_roster_by_id_with_no_name_matching(dump, protocol) -> None:
    """§7's one easy join, and the reason `<redner id>` matters so much.

    Verified in research at 192/192 across two protocols; here on the one MP
    present in both fixtures.
    """
    by_id = {mp.id: mp for mp in dump.mps}
    bilger_speech = next(s for s in protocol.speeches if s.speaker.id == "11004011")

    mp = by_id[bilger_speech.speaker.id]
    assert mp.current_name.nachname == bilger_speech.speaker.nachname == "Bilger"


def test_a_stammdaten_id_is_not_a_dip_person_id(dump) -> None:
    # §7, verified live: `GET /person/11004011` → 404, while DIP's id for the
    # same human is `1013`. The crosswalk has to be name-derived because DIP's
    # person record carries no external identifier field of any kind.
    bilger = next(m for m in dump.mps if m.id == "11004011")

    assert len(bilger.id) == 8
    assert bilger.id.isdigit()
    assert bilger.id != "1013"


def test_a_vote_row_joins_to_the_roster_only_by_name(dump) -> None:
    """The hard join: the sheets have no id column at all (§4.1).

    Measured on the *full* dump and a real 630-row ballot, this algorithm scores
    **628/630** where a naive `(surname, forename)` join scores 609. The two
    residual misses are MPs absent from the dump entirely (§7.1, §7.3), not
    matching failures.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    index = NameIndex(dump, wahlperiode=21)

    # Every sheet row whose MP is in the roster excerpt must resolve, and each
    # of these carries a different trap.
    expected = {"Stetten": "11003639", "Heil (Peine)": "11003142"}
    for surname, stammdaten_id in expected.items():
        row = next((r for r in sheet.records if r.name == surname), None)
        if row is None:
            continue
        assert index.lookup(row.name, row.vorname, row.titel) == stammdaten_id

    # …and a name the roster excerpt does not contain resolves to nothing,
    # rather than to whichever MP happened to be nearest.
    abraham = next(r for r in sheet.records if r.name == "Abraham")
    assert index.lookup(abraham.name, abraham.vorname, abraham.titel) is None


def test_the_vote_sheet_particle_column_is_what_makes_the_join_work(dump) -> None:
    # Without the `Titel` column as a surname prefix, `Frhr. von Stetten` in
    # Stammdaten does not meet `Stetten` on the sheet (§7.1).
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    index = NameIndex(dump, wahlperiode=21)
    stetten = next(r for r in sheet.records if r.name == "Stetten")

    assert stetten.titel == "Frhr. von"
    assert index.lookup(stetten.name, stetten.vorname, stetten.titel) == "11003639"


def test_the_two_vote_routes_agree_on_how_each_mp_voted(protocol) -> None:
    """Routes A and B cross-validate exactly (§4.1 vs §4.2).

    Both fixtures cover the same ballot — WP21, sitting 90, ballot 8 — and the
    MPs they share must agree on both the vote and the party. Research checked
    this at the tally level (519/43/0 from each); this checks it per MP, which
    is what the pipeline actually stores.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    xml_votes = {n.name: n for n in protocol.ballots[0].names}

    compared = 0
    for record in sheet.records:
        entry = xml_votes.get(record.bezeichnung or "")
        if entry is None:
            continue
        # Both routes speak the same vocabulary, so this is a direct comparison
        # rather than one mediated by a translation table that could itself be
        # wrong.
        assert entry.vote is record.vote, record.bezeichnung
        assert entry.fraktion == record.fraktion, record.bezeichnung
        compared += 1

    assert compared >= 2, "the fixtures should overlap on at least two MPs"


def test_only_the_xlsx_route_records_absences(protocol) -> None:
    """The asymmetry that keeps route A authoritative (§4.2).

    The protocol XML lists only MPs who *cast* a vote, so a ballot
    reconstructed from XML alone reports all 68 absences in this ballot as if
    they never happened — and a participation rate computed from it would be
    silently wrong in everyone's favour.
    """
    from bundestrack.models.votes import Vote

    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    xml_names = {n.name for n in protocol.ballots[0].names}
    absent = {r.bezeichnung for r in sheet.records if r.vote is Vote.ABSENT}

    assert absent, "the sheet excerpt keeps an absent MP"
    assert not (xml_names & absent), "an absence cannot appear in the XML name lists"
    # No AL_ paragraph class carries absences either — there is nothing to parse.
    assert all(n.vote is not Vote.ABSENT for n in protocol.ballots[0].names)


def test_party_names_differ_between_sources_and_need_mapping(dump, protocol) -> None:
    """§6.4: Stammdaten spells the group out; the sheets and DIP say `CDU/CSU`.

    Asserted rather than fixed here because the mapping is a pipeline concern —
    but a client that silently normalised one into the other would hide the fact
    that a mapping table is needed at all.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    sheet_parties = {r.fraktion for r in sheet.records if r.fraktion}
    stammdaten_parties = {m.fraktion() for mp in dump.mps for m in mp.mandates if m.fraktion()}

    assert "CDU/CSU" in sheet_parties
    assert not any(p.startswith("Fraktion der") for p in sheet_parties)
    assert any(p.startswith("Fraktion der") for p in stammdaten_parties)
    assert not (sheet_parties & stammdaten_parties), "the two vocabularies do not overlap"
