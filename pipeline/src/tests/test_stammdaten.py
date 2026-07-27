"""The MP roster, and the name join that everything without an id depends on.

`MdB-Stammdaten-excerpt.zip` holds five real `<MDB>` records chosen for what
each one breaks:

- **Bilger** (`11004011`) — the documented ID join: this is the protocol XML's
  `<redner id>`, and a 404 against DIP `/person`.
- **Laschet** — a committee chair, listed **twice** (§6.3).
- **Heil** — an `ORTSZUSATZ`, which already carries its parentheses (§7.1).
- **von Stetten** — `ADEL` + `PRAEFIX`, which the vote sheets print together as
  `Frhr. von` in a column headed `Titel`.
- **Alber** — two `<NAME>` entries, the historical-name case (§6.2).

The figures asserted for the *full* dump — 4 614 MPs, 635 WP21 mandate rows
reconciling to exactly 630 on the day of the sampled ballot, 628/630 name
matches — were measured before trimming and reproduce the research exactly.
"""

from __future__ import annotations

import datetime as dt

import pytest

from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.models.stammdaten import (
    MP,
    Mandate,
    MPName,
    NameIndex,
    StammdatenDump,
    fold_name,
    parse_german_date,
)
from tests.conftest import fixture_bytes


@pytest.fixture(scope="module")
def dump():
    return StammdatenClient.parse_zip(fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip"))


# --- parsing ---------------------------------------------------------------


def test_the_version_is_the_dumps_change_token(dump) -> None:
    # A Unix timestamp (§6.2) — the cheapest way to tell whether 15 MB of XML is
    # worth re-parsing.
    assert dump.version == "1777449783"
    assert dt.datetime.fromtimestamp(int(dump.version), tz=dt.UTC).year == 2026


def test_empty_elements_become_none_rather_than_empty_strings(dump) -> None:
    """§6.2: every element is always emitted, empty when unset.

    `<ORTSZUSATZ/>` is how this source says "no value", so it must not survive
    as `""` — a falsy string still joins differently from a missing one.
    """
    bilger = next(m for m in dump.mps if m.id == "11004011")
    name = bilger.current_name

    assert name.ortszusatz is None
    assert name.praefix is None
    assert name.nachname == "Bilger"


def test_dates_parse_from_the_german_format(dump) -> None:
    bilger = next(m for m in dump.mps if m.id == "11004011")
    assert bilger.geburtsdatum == dt.date(1979, 2, 16)


@pytest.mark.parametrize(
    ("value", "expected"),
    [("27.10.2009", dt.date(2009, 10, 27)), ("", None), (None, None), ("   ", None)],
)
def test_german_dates_treat_blank_as_absent(value, expected) -> None:
    assert parse_german_date(value) == expected


def test_the_current_name_is_the_one_with_an_open_history(dump) -> None:
    # 267 MDBs have more than one name — marriage, a forename change, an
    # acquired doctorate (§6.2).
    alber = next(m for m in dump.mps if len(m.names) > 1)

    assert alber.current_name.is_current
    assert alber.current_name.akad_titel == "Prof. Dr."
    assert any(not n.is_current for n in alber.names)


# --- the roster ------------------------------------------------------------


def test_a_mandate_knows_whether_it_was_serving_on_a_date(dump) -> None:
    """The operation that reconciles 635 mandate rows to 630 seats (§6.2).

    Five WP21 MPs departed mid-period and five joined late; only a date can tell
    them apart, which is why an open end date must stay distinguishable from a
    set one.
    """
    mandate = Mandate(
        wahlperiode=21, start_date=dt.date(2025, 3, 25), end_date=dt.date(2026, 1, 31)
    )
    assert mandate.was_serving_on(dt.date(2025, 6, 1))
    assert not mandate.was_serving_on(dt.date(2026, 7, 10))
    assert not mandate.was_serving_on(dt.date(2025, 1, 1))

    serving = Mandate(wahlperiode=21, start_date=dt.date(2025, 3, 25))
    assert serving.was_serving_on(dt.date(2026, 7, 10))


def test_the_roster_is_scoped_to_a_period(dump) -> None:
    assert dump.for_wahlperiode(21)
    assert all(mp.served_in(21) for mp in dump.for_wahlperiode(21))


def test_the_mandate_carries_the_constituency_and_election_method(dump) -> None:
    bilger = next(m for m in dump.mps if m.id == "11004011")
    mandate = bilger.mandate_for(21)

    assert mandate.mandatsart in {"Direktwahl", "Landesliste"}
    assert mandate.wahlperiode == 21


# --- committees ------------------------------------------------------------


def test_a_committee_chair_is_counted_once_not_twice(dump) -> None:
    """§6.3: a chair appears as `Vorsitzender` *and* `Ordentliches Mitglied`.

    Verified here on Laschet (Auswärtiger Ausschuss) — deduplicating on
    `(committee, start date)` is what stops every chair counting as two seats.
    """
    laschet = next(m for m in dump.mps if m.id == "11002718")
    mandate = laschet.mandate_for(21)

    raw = [i for i in mandate.institutions if i.is_committee]
    assert len(raw) == 2, "the fixture keeps both listings"
    assert {i.role for i in raw} == {"Vorsitzender", "Ordentliches Mitglied"}
    assert len(mandate.committees()) == 1


def test_deduplication_is_deterministic(dump) -> None:
    # Re-ingesting the same dump must not rewrite the stored role each time.
    laschet = next(m for m in dump.mps if m.id == "11002718")
    mandate = laschet.mandate_for(21)

    first = [(c.name, c.role) for c in mandate.committees()]
    assert first == [(c.name, c.role) for c in mandate.committees()]


def test_substitute_seats_are_distinguishable_from_full_ones(dump) -> None:
    # §6.3: the source separates them cleanly, which is what lets scoring avoid
    # crediting a `Stellvertretendes Mitglied` as much as a full member.
    stetten = next(m for m in dump.mps if m.id == "11003639")
    committees = stetten.mandate_for(21).committees()

    assert any(not c.is_full_member for c in committees)
    assert any(c.is_full_member for c in committees)


def test_parliamentary_groups_are_not_counted_as_committees(dump) -> None:
    # `Parlamentariergruppen` records leadership only, never membership (§6.3),
    # and `Fraktion/Gruppe` is a party group, not a committee.
    for mp in dump.mps:
        for mandate in mp.mandates:
            kinds = {c.kind for c in mandate.committees()}
            assert "Fraktion/Gruppe" not in kinds
            assert "Parlamentariergruppen" not in kinds


def test_committee_dates_are_day_level(dump) -> None:
    # Finer than anything DIP offers, whose `person_roles` has no dates at all
    # (§6.1) — this is what makes a mid-period committee change representable.
    laschet = next(m for m in dump.mps if m.id == "11002718")
    seat = laschet.mandate_for(21).committees()[0]

    assert seat.start_date == dt.date(2025, 5, 21)
    assert seat.end_date is None  # still serving


def test_the_fraktion_is_the_long_form_stammdaten_publishes(dump) -> None:
    # ⚠ §6.4: the vote sheets and DIP both say `CDU/CSU`. The pipeline needs an
    # explicit mapping, and it cannot build one without knowing they differ.
    bilger = next(m for m in dump.mps if m.id == "11004011")
    fraktion = bilger.mandate_for(21).fraktion()

    assert fraktion and fraktion.startswith("Fraktion der")
    assert fraktion != "CDU/CSU"


# --- the name join ---------------------------------------------------------


def test_diacritics_fold_so_the_two_official_sources_agree() -> None:
    """§7.2: DIP has `Özoguz` where Stammdaten has `Özoğuz`.

    Folding lifts the DIP↔Stammdaten match rate from 98.6 % to 99.1 %.
    """
    assert fold_name("Özoğuz") == fold_name("Özoguz")
    assert fold_name("Ahmetović") == fold_name("Ahmetovic")
    assert fold_name("Salihović") == fold_name("Salihovic")
    # `ß` has no combining form, so NFD alone would leave these different.
    assert fold_name("Strauß") == fold_name("Strauss")
    assert fold_name(None) == ""


def test_an_ortszusatz_is_not_wrapped_in_a_second_pair_of_parentheses() -> None:
    """One of the two causes of the naive join's 21/630 failures (§7.1).

    `ORTSZUSATZ` is published as `(Fulda)`, so `f"{nachname} ({ortszusatz})"`
    produces `Brand ((Fulda))` and matches nothing.
    """
    name = MPName(nachname="Brand", vorname="Michael", ortszusatz="(Fulda)")

    assert "Brand (Fulda)" in name.surname_variants()
    assert not any("((" in v for v in name.surname_variants())


def test_name_particles_are_indexed_as_surname_prefixes() -> None:
    # The other cause: the sheet files `von`/`van`/`de` under a column headed
    # `Titel` and splits them off the surname; Stammdaten may not.
    name = MPName(nachname="Stetten", vorname="Christian", adel="Frhr.", praefix="von")
    variants = name.surname_variants()

    assert "Stetten" in variants
    assert "von Stetten" in variants
    assert "Frhr. von Stetten" in variants


def test_the_index_resolves_every_kind_of_printed_name(dump) -> None:
    index = NameIndex(dump, wahlperiode=21)

    assert index.lookup("Bilger", "Steffen") == "11004011"
    assert index.lookup("Heil (Peine)", "Hubertus") == "11003142"
    assert index.lookup("Stetten", "Christian", "Frhr. von") == "11003639"


def test_historical_names_are_indexed_too(dump) -> None:
    # A ballot printed under a former name must still match (§6.2).
    index = NameIndex(dump)
    alber = next(m for m in dump.mps if len(m.names) > 1)

    for name in alber.names:
        assert index.lookup(name.nachname, name.vorname) == alber.id


def test_an_unmatched_name_returns_none_rather_than_a_guess(dump) -> None:
    # §7.3 asks for unmatched rows to be quarantined and retried on a later
    # sync, which requires the gap to be visible.
    index = NameIndex(dump, wahlperiode=21)
    assert index.lookup("Nichtvorhanden", "Niemand") is None


def test_an_ambiguous_name_is_reported_rather_than_resolved() -> None:
    """§7.2: 15 name keys are ambiguous across the corpus (three `Karl Müller`).

    A wrong MP is worse than a gap, so ambiguity returns no id — and names the
    candidates so the failure can be logged usefully.
    """
    from bundestrack.models.stammdaten import StammdatenDump

    twins = StammdatenDump(
        mps=[
            MP(
                id="11000001",
                names=[MPName(nachname="Müller", vorname="Karl")],
                mandates=[Mandate(wahlperiode=21)],
            ),
            MP(
                id="11000002",
                names=[MPName(nachname="Müller", vorname="Karl")],
                mandates=[Mandate(wahlperiode=21)],
            ),
        ]
    )
    index = NameIndex(twins, wahlperiode=21)
    match = index.resolve("Müller", "Karl")

    assert match.id is None
    assert not match.matched
    assert match.ambiguous == {"11000001", "11000002"}


def test_an_mp_the_snapshot_has_not_caught_up_with_still_matches(dump) -> None:
    """§7.3's staleness, measured: the dump records Michael Breilmann with WP20
    only although he sits in WP21, and he votes in a WP21 ballot.

    Scoped strictly, a real 630-row ballot matches 627. Falling back to the
    unscoped index recovers him — flagged `stale`, because a snapshot that is
    behind is worth re-checking, not worth sending a sitting MP to quarantine.
    """
    from bundestrack.models.stammdaten import StammdatenDump

    lagging = StammdatenDump(
        mps=[
            MP(
                id="11005032",
                names=[MPName(nachname="Breilmann", vorname="Michael")],
                mandates=[Mandate(wahlperiode=20)],  # WP21 not yet recorded
            )
        ]
    )
    match = NameIndex(lagging, wahlperiode=21).resolve("Breilmann", "Michael")

    assert match.id == "11005032"
    assert match.stale


def test_a_scoped_match_is_not_flagged_stale(dump) -> None:
    match = NameIndex(dump, wahlperiode=21).resolve("Bilger", "Steffen")

    assert match.id == "11004011"
    assert not match.stale


# --- the period window -----------------------------------------------------


def _period(wahlperiode: int, spans: list[tuple[str | None, str | None]]) -> StammdatenDump:
    """A dump of one mandate per span, for exercising the window arithmetic."""
    return StammdatenDump(
        mps=[
            MP(
                id=f"1100{index:04d}",
                names=[MPName(nachname=f"Test{index}", vorname="A")],
                mandates=[
                    Mandate(
                        wahlperiode=wahlperiode,
                        start_date=parse_german_date(start),
                        end_date=parse_german_date(end),
                    )
                ],
            )
            for index, (start, end) in enumerate(spans)
        ]
    )


def test_a_closed_period_spans_its_earliest_start_to_its_latest_end() -> None:
    """Mid-period replacements sit strictly inside the period, so the extremes
    of the mandate dates are the period itself."""
    dump = _period(
        20,
        [
            ("26.10.2021", "25.03.2025"),  # a full term
            ("14.02.2023", "25.03.2025"),  # a late replacement
            ("26.10.2021", "30.06.2024"),  # an early departure
        ],
    )

    assert dump.wahlperiode_window(20) == (dt.date(2021, 10, 26), dt.date(2025, 3, 25))


def test_an_unfinished_period_has_no_upper_bound() -> None:
    """An open `MDBWP_BIS` is someone still serving, so the period has not
    ended — and None must not be filled in with today's date, or a record
    dated tomorrow is silently excluded."""
    dump = _period(21, [("25.03.2025", None), ("25.03.2025", "01.06.2026")])

    assert dump.wahlperiode_window(21) == (dt.date(2025, 3, 25), None)


def test_a_period_the_dump_does_not_cover_has_no_window() -> None:
    # Answering with a bound here would filter a period's data down to nothing.
    assert StammdatenDump(mps=[]).wahlperiode_window(14) == (None, None)


def test_the_real_dump_gives_the_current_period_an_open_window(dump) -> None:
    start, end = dump.wahlperiode_window(21)

    assert start == dt.date(2025, 3, 25), "WP21's constitutive sitting"
    assert end is None, "WP21 has not ended"


# --- streaming -------------------------------------------------------------


def test_mps_can_be_streamed_without_holding_the_whole_dump(dump) -> None:
    # The real XML is ~15 MB, so a pipeline stage that transforms and posts as
    # it goes should not have to build 4 614 models first.
    import zipfile
    from io import BytesIO

    archive = zipfile.ZipFile(BytesIO(fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip")))
    xml = archive.read("MDB_STAMMDATEN.XML")

    streamed = list(StammdatenClient.iter_mps(xml))
    assert [m.id for m in streamed] == [m.id for m in dump.mps]
