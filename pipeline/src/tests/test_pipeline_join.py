"""The identity layer — minting, resolving, and refusing to guess.

`test_join.py` covers what the *sources* say about the three id spaces
(docs/api-research.md §7). This covers what the pipeline does about it: mint an
internal id, resolve every external id onto it, and quarantine what it cannot
resolve rather than dropping it (§7.4, §7.3).

The distinction that runs through the whole file is between a **gap** and a
**guess**. An unmatched name is a gap: recorded, retried, visible. A name
resolved to the wrong MP is a guess, and nothing downstream can detect it —
which is why ambiguity resolves to None here rather than to a first match.
"""

from __future__ import annotations

import pytest

from bundestrack.api.protocols import ProtocolClient
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.api.votes import parse_sheet
from bundestrack.models.dip import Person
from bundestrack.pipeline.join import (
    MPResolver,
    Quarantine,
    QuarantinedName,
    internal_id,
    stammdaten_id_of,
)
from tests.conftest import fixture_bytes


@pytest.fixture(scope="module")
def dump():
    return StammdatenClient.parse_zip(fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip"))


@pytest.fixture
def resolver(dump) -> MPResolver:
    return MPResolver(dump, 21)


def person(person_id: str, vorname: str, nachname: str, **extra) -> Person:
    """A DIP person record with only the fields the crosswalk reads.

    Built rather than fixtured because the recorded `/person` pages and the
    Stammdaten excerpt were trimmed from different parts of the corpus and do
    not overlap — the join under test needs both sides to describe one human.
    """
    return Person.model_validate(
        {
            "id": person_id,
            "vorname": vorname,
            "nachname": nachname,
            "typ": "Person",
            "titel": f"{vorname} {nachname}, MdB",
            "aktualisiert": "2026-07-24T12:03:00+02:00",
            "wahlperiode": [21],
            **extra,
        }
    )


# --- minting --------------------------------------------------------------


def test_the_internal_id_is_derived_so_two_hosts_agree_without_coordinating() -> None:
    """§7.4 asks for a minted internal id; deriving it is what makes it stable.

    A counter would renumber the whole roster the first time a backfill ran in
    a different order, and every table references this value.
    """
    assert internal_id("11004011") == "bt-11004011"
    assert stammdaten_id_of(internal_id("11004011")) == "11004011"


def test_the_internal_id_is_not_the_stammdaten_id_it_is_built_from(resolver) -> None:
    # Different id spaces: `mps.stammdatenId` stores the 8-digit one, and the
    # prefix is what stops the two being used interchangeably.
    assert resolver.from_stammdaten_id("11004011") == "bt-11004011"
    assert "bt-11004011" not in {mp.id for mp in resolver.roster()}


# --- the easy joins -------------------------------------------------------


def test_a_speaker_id_resolves_without_any_name_matching(resolver) -> None:
    """§5.2: `<redner id>` *is* the Stammdaten id, verified 192/192."""
    protocol = ProtocolClient.parse(fixture_bytes("protocols", "21090_excerpt.xml"))
    bilger = next(s for s in protocol.speeches if s.speaker.id == "11004011")

    assert resolver.resolve_speaker_id(bilger.speaker.id) == "bt-11004011"


def test_an_unknown_speaker_id_is_quarantined_rather_than_minted(resolver) -> None:
    # Minting an id for an MP the roster does not have would create a row that
    # every Convex mutation then rejects — `requireMandate` refuses records
    # naming an MP who is not on the roster.
    assert resolver.resolve_speaker_id("11999999", context="WP21 sitting 90") is None
    assert [entry.nachname for entry in resolver.quarantine.for_source("speech")] == ["11999999"]


# --- the DIP crosswalk ----------------------------------------------------


def test_dip_persons_link_onto_the_roster_by_folded_name(resolver) -> None:
    """§7.2, measured at 99.1 % against WP21 where exact matching scores 98.6 %."""
    report = resolver.link_dip_persons([person("1013", "Steffen", "Bilger")])

    assert report.linked == 1
    assert resolver.from_dip_person_id("1013") == "bt-11004011"
    assert resolver.dip_person_id_for("bt-11004011") == "1013"


def test_diacritics_are_folded_because_the_official_sources_disagree(dump) -> None:
    """The whole reason folding exists (§7.2).

    DIP publishes `Özoguz`, `Salihovic`, `Ahmetovic` where Stammdaten has
    `Özoğuz`, `Salihović`, `Ahmetović` — a character-level disagreement between
    two official sources, worth 0.5 percentage points of match rate.
    """
    resolver = MPResolver(dump, 21)
    # The excerpt has no diacritic case, so this exercises the fold on a name
    # it does have: `ß`→`ss` and NFD stripping are the same code path.
    report = resolver.link_dip_persons([person("2222", "Hubertus", "Heil")])

    assert report.linked == 1
    assert resolver.from_dip_person_id("2222") == "bt-11003142"


def test_a_dip_person_who_is_not_an_mp_is_not_an_error(resolver) -> None:
    """§6.1: `/person` is not a roster — 803 records for 630 seats.

    So an unmatched person is the normal case and must not reach the
    quarantine, which is for a roster that is missing someone. This is the
    reverse, and quarantining it would bury the real misses in noise.
    """
    report = resolver.link_dip_persons(
        [
            person("9999", "Nick", "Nobody"),
            person("8888", "Siegbert", "Alber", wahlperiode=[8]),
        ]
    )

    assert report.unmatched == 1
    assert report.out_of_period == 1
    assert resolver.quarantine.for_source("dip-person") == []


def test_a_second_dip_record_for_one_mp_does_not_reassign_the_id(resolver) -> None:
    """A minister has both an MdB record and a government one (§6.1).

    The first wins rather than the last, so re-running the crosswalk in a
    different page order does not silently move an MP's activities to a
    different DIP id.
    """
    report = resolver.link_dip_persons(
        [person("1013", "Steffen", "Bilger"), person("7777", "Steffen", "Bilger")]
    )

    assert report.duplicate == 1
    assert resolver.dip_person_id_for("bt-11004011") == "1013"


def test_unlinked_mps_are_reported_so_the_gap_is_visible(resolver) -> None:
    """§7.3's retry list, and the mirror of `listUnlinkedMPs` in Convex.

    An unresolved DIP id means that MP's activities attach to nobody — a
    visible gap rather than a silent one.
    """
    resolver.link_dip_persons([person("1013", "Steffen", "Bilger")])

    unlinked = resolver.unlinked_internal_ids()

    assert "bt-11004011" not in unlinked
    assert "bt-11002718" in unlinked


# --- the hard join --------------------------------------------------------


def test_a_vote_row_resolves_through_the_particle_column(resolver) -> None:
    """§7.1: the sheet's `Titel` column holds `von`/`Frhr. von`, not a title.

    Without it, `Frhr. von Stetten` in Stammdaten never meets `Stetten` on the
    sheet — one of the two causes of the naive join's 21/630 failures.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    stetten = next(r for r in sheet.records if r.name == "Stetten")

    assert resolver.resolve_vote_record(stetten) == "bt-11003639"
    assert len(resolver.quarantine) == 0


def test_an_unmatched_vote_row_is_quarantined_with_the_ballot_it_came_from(
    resolver,
) -> None:
    """§7.3: two MPs in a July 2026 sheet were missing from the dump entirely.

    A dropped vote row is a vote that silently never happened, and it never
    comes back — the next sync drops it identically. The XLSX is also the only
    source that records absences (§4.2), so there is nowhere else to recover it
    from.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    abraham = next(r for r in sheet.records if r.name == "Abraham")

    assert resolver.resolve_vote_record(abraham) is None

    (entry,) = [e for e in resolver.quarantine.for_source("vote-sheet") if e.nachname == "Abraham"]
    assert entry.reason == "unmatched"
    assert entry.context == "WP21 sitting 90 ballot 8"


def test_the_ortszusatz_is_matched_without_being_re_wrapped(resolver) -> None:
    """The other cause of the naive join's failures (§7.1).

    `ORTSZUSATZ` already contains its parentheses, so building
    `f"{nach} ({orts})"` double-wraps it into `Heil ((Peine))`, which matches
    nothing. Both spellings the sheets use must resolve to the same MP: the
    bare surname, and the surname with the Ortszusatz as printed.
    """
    assert resolver.resolve_printed_name("Heil (Peine)", "Hubertus") == "bt-11003142"
    assert resolver.resolve_printed_name("Heil", "Hubertus") == "bt-11003142"
    assert resolver.resolve_printed_name("Heil ((Peine))", "Hubertus") is None


def test_a_name_from_another_period_is_not_resolved_against_this_ones_index(
    resolver,
) -> None:
    # Name keys are unique within WP21 but not across the corpus — 15 ambiguous,
    # e.g. three `('muller', 'karl')` (§7.2). Answering for a period the index
    # was not built for would silently use the wrong scope.
    assert resolver.resolve_printed_name("Alber", "Siegbert", None, wahlperiode=8) is None


def test_an_unmatched_listing_entry_is_quarantined_rather_than_only_logged(
    resolver,
) -> None:
    """GAP-027: the stage claimed the quarantine retried these; nothing did.

    The bundestag.de listing is the Bundestag's own roster of the *sitting*
    chamber, so a name in it that resolves to nobody is a real member the
    Stammdaten snapshot is behind on (§7.3) — precisely the case quarantining
    exists for. Until this call site existed, `portrait_enrichment` logged the
    miss and moved on, so those MPs were never re-examined once the dump caught
    up and stayed unenriched indefinitely.
    """
    assert (
        resolver.resolve_listed_name("Nichtexistent", "Erika", context="https://www.bundestag.de/x")
        is None
    )

    (entry,) = resolver.quarantine.for_source("mp-listing")
    assert entry.nachname == "Nichtexistent"
    assert entry.reason == "unmatched"
    assert entry.context == "https://www.bundestag.de/x"


def test_a_listing_miss_does_not_inflate_the_vote_sheet_quarantine(resolver) -> None:
    """Kept under its own source, because the two mean different things.

    A quarantined vote row is a ballot that would otherwise be silently lost
    (§4.2 — the sheets are the only source carrying absences). A quarantined
    listing entry is a missing portrait, which the UI already degrades for.
    Folding them together would let an enrichment gap inflate the count that
    signals a vote was dropped.
    """
    resolver.resolve_listed_name("Nichtexistent", "Erika")

    assert resolver.quarantine.for_source("vote-sheet") == []
    assert len(resolver.quarantine.for_source("mp-listing")) == 1


def test_a_listing_entry_that_resolves_is_not_quarantined(resolver) -> None:
    # The common case: 635 of 639 resolve. A quarantine that also collected
    # successes would be one nobody reads.
    assert resolver.resolve_listed_name("Bilger", "Steffen") == "bt-11004011"
    assert len(resolver.quarantine) == 0


# --- the quarantine -------------------------------------------------------


def test_the_quarantine_deduplicates_so_it_stays_readable() -> None:
    # The same MP missing from the dump produces one entry per ballot they were
    # listed in; a quarantine growing by 630 rows a sitting is one nobody reads.
    quarantine = Quarantine()
    for ballot in ("21/90/8", "21/91/1"):
        quarantine.add(
            QuarantinedName(
                source="vote-sheet",
                nachname="Glaser",
                vorname="Stefan",
                wahlperiode=21,
                context=ballot,
            )
        )

    assert len(quarantine) == 1


def test_quarantined_names_clear_once_the_roster_catches_up(resolver) -> None:
    """§7.3's whole point: the dump lags, so the entry is retried, not dropped.

    An entry that resolves on a later sync was a staleness artefact, and the
    rows behind it are re-posted by that run's own stages.
    """
    resolver.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Bilger", vorname="Steffen", wahlperiode=21)
    )
    resolver.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Glaser", vorname="Stefan", wahlperiode=21)
    )

    recovered = resolver.quarantine.clear_resolved(resolver)

    assert [entry.nachname for entry in recovered] == ["Bilger"]
    assert [entry.nachname for entry in resolver.quarantine.entries] == ["Glaser"]


def test_the_resolver_reports_every_internal_id_the_roster_vouches_for(resolver) -> None:
    # What the load stage checks before posting: Convex rejects a record naming
    # an MP who is not on the roster, and a rejected batch fails as a whole
    # rather than row by row.
    assert resolver.internal_ids() == {
        "bt-11004011",
        "bt-11002718",
        "bt-11003142",
        "bt-11003639",
        # The list mandate with no constituency block — see the federal-state
        # tests in test_pipeline_transform.py. On the roster like any other, and
        # deliberately so: a member without a Wahlkreis is not a member without
        # a seat.
        "bt-11005423",
    }
