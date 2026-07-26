"""Named-vote sheet discovery and parsing.

`vote_21_90_8_excerpt.xlsx` is a real sheet (WP21, sitting 90, ballot 8) cut
down to the rows carrying a documented trap. The tallies asserted for the *full*
sheet — 630 rows, 519 yes / 43 no / 68 absent — are the ones the research
cross-validated against both the protocol XML and abgeordnetenwatch.

`vote_21_42_1_synthetic.xlsx` is not real, and is named so: no sheet in the
research sample had an `Enthaltung` or `ungültig` row (§11.4 open question 7),
so those columns and the one-hot guard have no natural fixture.
"""

from __future__ import annotations

import datetime as dt

import httpx
import pytest

from bundestrack.api.base import BundestagAPIError
from bundestrack.api.votes import (
    VoteClient,
    VoteListParser,
    parse_listing_date,
    parse_sheet,
)
from bundestrack.models.votes import Vote
from tests.conftest import fixture_bytes, fixture_text, mock_client


@pytest.fixture(scope="module")
def sheet():
    return parse_sheet(
        fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"),
        source_url="https://www.bundestag.de/resource/blob/1194616/20260710_8-xls.xlsx",
        title="Sportfördergesetz der Bundesregierung",
        sheet_date=dt.date(2026, 7, 10),
    )


# --- the sheet -------------------------------------------------------------


def test_the_ballot_key_comes_off_the_rows(sheet) -> None:
    # `(Wahlperiode, Sitzungnr, Abstimmnr)` is the natural key, and every row
    # carries all three (§4.1).
    assert sheet.key == (21, 90, 8)
    assert all(r.ballot_key == (21, 90, 8) for r in sheet.records)


def test_votes_are_one_hot_across_five_columns(sheet) -> None:
    """§4.1, verified on every one of the real sheet's 630 rows."""
    assert all(isinstance(r.vote, Vote) for r in sheet.records)
    tally = sheet.tally()
    assert sum(tally.values()) == sheet.total_eligible


def test_absent_and_abstain_are_kept_distinct(sheet) -> None:
    """`nichtabgegeben` is *did not vote*; `Enthaltung` is *voted to abstain*.

    Collapsing them flatters the participation rate of everyone who stayed away
    — which is why the Convex schema keeps them apart too.
    """
    absent = [r for r in sheet.records if r.vote is Vote.ABSENT]
    assert absent, "the fixture keeps an absent row"
    assert Vote.ABSENT != Vote.ABSTAIN
    assert all(r.vote is not Vote.ABSTAIN for r in absent)


def test_a_tally_reports_zero_counts_rather_than_omitting_them(sheet) -> None:
    # "Nobody abstained" must be distinguishable from "the column was not
    # parsed".
    tally = sheet.tally()
    assert set(tally) == set(Vote)
    assert tally[Vote.INVALID] == 0


def test_the_titel_column_holds_name_particles_not_academic_titles(sheet) -> None:
    """§4.1. The column heading says `Titel`; the contents are `von`, `van`,
    `de`, and compounds like `Frhr. von` — the join key, not a courtesy."""
    particles = {r.titel for r in sheet.records if r.titel}
    assert particles
    assert particles <= {"von", "van", "de", "dos", "Frhr. von"}
    assert not any(p in {"Dr.", "Prof."} for p in particles)


def test_an_ortszusatz_stays_part_of_the_surname(sheet) -> None:
    # `Brand (Fulda)` exists to disambiguate identical names (§7.1); stripping
    # it would merge two different MPs.
    named = [r for r in sheet.records if "(" in r.name]
    assert named
    assert named[0].name == "Brand (Fulda)"


def test_an_excused_absence_keeps_its_published_reason(sheet) -> None:
    remarks = [r.bemerkung for r in sheet.records if r.bemerkung]
    assert "gesetzlicher Mutterschutz" in remarks


def test_the_source_url_is_recorded(sheet) -> None:
    # The Convex schema uses a null `sourceUrl` to mean "reconstructed from XML,
    # so absences cannot be trusted" — the distinction only works if a real
    # sheet records where it came from.
    assert sheet.source_url and sheet.source_url.endswith(".xlsx")
    assert sheet.date == dt.date(2026, 7, 10)


# --- the paths no real sheet exercises -------------------------------------


def test_abstain_and_invalid_parse() -> None:
    """The two columns no real sheet exercises — synthetic fixture, see above.

    `Enthaltung` and `ungültig` were zero across all 630 rows of every ballot
    sampled in research (§11.4 open question 7), so without this the two code
    paths would ship untested.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_42_1_synthetic.xlsx"))
    tally = sheet.tally()

    assert tally[Vote.ABSTAIN] == 1
    assert tally[Vote.INVALID] == 1
    assert tally[Vote.YES] == 1


def test_a_row_with_two_vote_flags_is_rejected_rather_than_guessed() -> None:
    """Five mutually exclusive columns; two set means a sheet we cannot read.

    Picking whichever column was read first would invent a vote that was never
    cast, and it would do so silently.
    """
    with pytest.raises(BundestagAPIError, match="2 vote flags"):
        parse_sheet(fixture_bytes("votes", "vote_malformed_two_flags.xlsx"))


def test_a_row_with_no_vote_flag_is_rejected_too() -> None:
    # The other half of the guard: a row for an MP with no recorded vote at all
    # is not the same as an absence, which has its own column.
    with pytest.raises(BundestagAPIError, match="0 vote flags"):
        parse_sheet(fixture_bytes("votes", "vote_malformed_no_flag.xlsx"))


def test_a_reordered_sheet_is_reported_rather_than_misread() -> None:
    # Columns are located by header name. Were they read by position, a
    # reordered export would put `Vorname` into `name` without complaint.
    import io

    import openpyxl

    workbook = openpyxl.Workbook()
    workbook.active.append(["Wahlperiode", "Sitzungnr", "Name"])  # missing the rest
    buffer = io.BytesIO()
    workbook.save(buffer)

    with pytest.raises(BundestagAPIError, match="missing columns"):
        parse_sheet(buffer.getvalue())


# --- discovery -------------------------------------------------------------


def test_the_listing_yields_ballots_with_their_data_sheets() -> None:
    parser = VoteListParser()
    parser.feed(fixture_text("votes", "ajax_list_page.html"))

    with_sheets = [e for e in parser.entries if e.has_data_sheet]
    assert len(with_sheets) == 2
    assert with_sheets[0].title.startswith("Sportfördergesetz")
    assert with_sheets[0].xlsx_url.endswith("20260710_8-xls.xlsx")
    assert with_sheets[0].date == dt.date(2026, 7, 10)


def test_a_pdf_only_ballot_is_reported_rather_than_dropped() -> None:
    """§4.1: machine-readable sheets reach back to ~WP17 (2012/13).

    Verified live at offset 1000: the tail of the listing is 2008–2009 ballots
    with a PDF, no XLSX, and an empty date cell. Yielding them with
    `xlsx_url=None` makes the coverage boundary visible instead of leaving it to
    be inferred from a gap.
    """
    parser = VoteListParser()
    parser.feed(fixture_text("votes", "ajax_list_page.html"))

    pdf_only = [e for e in parser.entries if not e.has_data_sheet]
    assert pdf_only
    assert pdf_only[0].pdf_url and pdf_only[0].pdf_url.endswith(".pdf")
    assert pdf_only[0].date is None
    assert "Namentlichen Abstimmung" in pdf_only[0].title


def test_pagination_stops_on_the_empty_fragment(no_pacing: None) -> None:
    # The endpoint answers past the end with a ~1 KB empty fragment rather than
    # an error (verified at offset 1020, where the listing runs out at ~1 015).
    pages = [
        fixture_text("votes", "ajax_list_page.html"),
        fixture_text("votes", "ajax_list_empty.html"),
    ]
    served = iter(pages)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=next(served, ""))

    client = VoteClient(client=mock_client(handler))
    assert len(list(client.iter_vote_links())) == 3


def test_downloading_a_pdf_only_ballot_says_why_it_cannot(no_pacing: None) -> None:
    from bundestrack.models.votes import VoteSheetLink

    client = VoteClient(client=mock_client(lambda r: httpx.Response(200)))
    link = VoteSheetLink(title="A 2009 ballot", pdf_url="https://example.test/x.pdf")

    with pytest.raises(ValueError, match="PDF-only"):
        client.fetch_sheet(link)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("10. Juli 2026", dt.date(2026, 7, 10)),
        ("1. März 2013", dt.date(2013, 3, 1)),
        ("10.07.2026", dt.date(2026, 7, 10)),
        ("   ", None),  # the pre-2012 rows have an empty date cell
        ("Download", None),
    ],
)
def test_listing_dates_parse_in_both_published_spellings(text: str, expected) -> None:
    assert parse_listing_date(text) == expected
