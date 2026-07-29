"""Source models → Convex payloads, and the findings the mapping encodes.

Every transform is pure, so each of these runs against a recorded fixture with
no network and no clock. That matters more here than anywhere else in the
suite: the failures this file guards against do not raise. They produce a
plausible wrong number — an MP credited with an intervener's words, a chair
counted as two committee seats, a question filed under a title that is actually
the MP's own name — and the only place to catch that is at the boundary where
the mapping is made.

The Convex contract these assert against is webapp/convex/schema.ts:
`null` never a missing key, ISO dates, internal ids, short-form Fraktion names.
"""

from __future__ import annotations

import datetime as dt

import pytest

from bundestrack.api.protocols import ProtocolClient
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.api.votes import parse_sheet
from bundestrack.models.dip import Aktivitaet, Drucksache, Person, Vorgang
from bundestrack.models.enrichment import MPContact
from bundestrack.models.votes import Vote
from bundestrack.pipeline import transform
from bundestrack.pipeline.join import MPResolver
from tests.conftest import fixture_bytes, fixture_json


@pytest.fixture(scope="module")
def dump():
    return StammdatenClient.parse_zip(fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip"))


@pytest.fixture
def resolver(dump) -> MPResolver:
    return MPResolver(dump, 21)


@pytest.fixture
def linked_resolver(resolver) -> MPResolver:
    """A resolver with the DIP crosswalk populated, through the real join.

    The DIP persons are constructed rather than fixtured because the recorded
    `/person` pages and the Stammdaten excerpt were trimmed from different
    parts of the corpus and describe no common human — and every DIP-sourced
    transform needs both sides of the join. Running them through
    `link_dip_persons` rather than writing the crosswalk directly means these
    tests break if the matching does.
    """
    report = resolver.link_dip_persons(
        [
            Person.model_validate(
                {
                    "id": dip_id,
                    "vorname": vorname,
                    "nachname": nachname,
                    "typ": "Person",
                    "titel": f"{vorname} {nachname}, MdB",
                    "aktualisiert": "2026-07-24T12:03:00+02:00",
                    "wahlperiode": [21],
                    "funktion": ["MdB"],
                }
            )
            for dip_id, vorname, nachname in (
                ("1013", "Steffen", "Bilger"),
                ("2222", "Hubertus", "Heil"),
            )
        ]
    )
    assert report.linked == 2, "the fixture roster should match both DIP persons"
    return resolver


def aktivitaeten(*, person_ids: tuple[str, ...] = ("1013", "2222")) -> list[Aktivitaet]:
    """The recorded `/aktivitaet` page, re-pointed at the fixture roster."""
    documents = fixture_json("dip", "aktivitaet_page.json")["documents"]
    records = [Aktivitaet.model_validate(doc) for doc in documents]
    for record, person_id in zip(records, person_ids, strict=False):
        record.person_id = person_id
    return records


# --- the Fraktion vocabulary ---------------------------------------------


def test_stammdatens_long_form_becomes_the_short_form_everything_else_uses() -> None:
    """§6.4: the two vocabularies do not overlap at all, so a mapping is required.

    Stammdaten spells the group out; the vote sheets, DIP and the UI all say
    `CDU/CSU`. Unmapped, an MP's Fraktion matches nothing in the seating order,
    the rankings filter or the roster query.
    """
    long_form = "Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union"

    assert transform.normalise_fraktion(long_form) == "CDU/CSU"
    assert transform.normalise_fraktion("CDU/CSU") == "CDU/CSU"
    assert (
        transform.normalise_fraktion("Fraktion der Sozialdemokratischen Partei Deutschlands")
        == "SPD"
    )


def test_no_group_is_a_status_rather_than_missing_data() -> None:
    # Three WP21 MPs sit without one (§9), and `Fraktionslos` is what
    # webapp/convex/seating.ts places at the edges of the arc.
    assert transform.normalise_fraktion(None) == "Fraktionslos"
    assert transform.normalise_fraktion("  ") == "Fraktionslos"
    assert transform.normalise_fraktion("fraktionslos") == "Fraktionslos"


def test_an_unmapped_group_is_passed_through_and_warned_about(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Passing it through beats both alternatives.

    Mapping it to `Fraktionslos` would quietly move an MP out of their group;
    dropping it would empty the field the roster is filtered by. A warning
    makes it a question rather than a silence.
    """
    with caplog.at_level("WARNING"):
        assert transform.normalise_fraktion("Fraktion der Neuen Partei") == (
            "Fraktion der Neuen Partei"
        )

    assert "Unmapped Fraktion" in caplog.text


# --- MPs ------------------------------------------------------------------


def test_the_roster_payload_matches_the_convex_mp_shape(resolver) -> None:
    """Every nullable *Stammdaten* field is present as null, never omitted.

    The Convex validators require it (webapp/convex/schema.ts): a forgotten key
    is a 400 naming the field, which is the point — but only if the transform
    emits the key at all.

    The enrichment columns are the deliberate exception and are asserted
    separately below: they come from sources a given run may not have reached,
    and the same upsert that makes a present key authoritative makes a null one
    destructive. Stammdaten, by contrast, is re-read in full every run, so
    these keys are always both present and authoritative.
    """
    payloads = {p["internalId"]: p for p in transform.roster_payloads(resolver)}
    bilger = payloads["bt-11004011"]

    assert bilger["stammdatenId"] == "11004011"
    assert bilger["dipPersonId"] is None
    assert bilger["fraktion"] == "CDU/CSU"
    assert bilger["party"] == "CDU"
    assert bilger["wahlperiode"] == 21
    # An open `end` means still serving, and must stay distinguishable from a
    # date — that is how §6.2 reconciles 635 mandate rows to 630 seats.
    assert bilger["datesInOffice"] == {"start": "2025-03-25", "end": None}
    for nullable in ("ortsZusatz", "praefix", "constituency"):
        assert nullable in bilger, nullable


def test_an_unenriched_roster_payload_omits_the_enrichment_columns(resolver) -> None:
    """The inverse of the rule above, and the one that broke production.

    `roster_payloads` is called by stage 1 with a resolver that holds no
    enrichment yet — every run starts that way. The Convex upsert patches the
    keys present (`webapp/convex/lib/ingest.ts:123`), so emitting these as null
    made that opening write erase what earlier runs had learned: on 2026-07-29
    it took 633 stored portraits to 0 and left the live site rendering initials
    for the whole chamber.
    """
    payloads = {p["internalId"]: p for p in transform.roster_payloads(resolver)}
    bilger = payloads["bt-11004011"]

    for enriched in ("photoUrl", "photoCredit", "education", "occupation", "contact"):
        assert enriched not in bilger, enriched


def test_an_empty_contact_block_is_omitted_rather_than_sent_as_null(resolver) -> None:
    """A fetched-but-empty page must read as "nothing to say", not as "clear it".

    The trap is that `MPContact` is a pydantic model with no `__bool__`, so an
    empty one is **truthy** while `contact_payload` maps it to None. Guarding
    on the model rather than on the built payload therefore emits
    `contact: None` — which the Convex `patch` applies as an erasure — for the
    one case where the pipeline knows least.

    Asserted at this boundary as well as in `test_pipeline_sync.py` because
    this is where the value is built: a sync-level test can only observe the
    payload the transform chose to emit.
    """
    resolver.attach_enrichment(
        [transform.contact_enrichment("bt-11004011", MPContact())],
    )

    payloads = {p["internalId"]: p for p in transform.roster_payloads(resolver)}

    assert "contact" not in payloads["bt-11004011"]


def test_a_contact_block_with_only_a_form_url_is_still_written(resolver) -> None:
    """Sparse is not empty — the boundary the omission must not swallow.

    Roughly half of MPs list no constituency office and many list no socials,
    so a block holding nothing but the Bundestag's own contact form is the
    *typical* answer rather than a degenerate one: 623 of 635 carried one. An
    omission rule that keyed on "fewer than N fields" would drop the majority
    case, so it keys on `MPContact.is_empty` alone.
    """
    resolver.attach_enrichment(
        [
            transform.contact_enrichment(
                "bt-11004011",
                MPContact(
                    form_url="https://www.bundestag.de/services/formular/contactform?mdbId=1"
                ),
            )
        ],
    )

    payloads = {p["internalId"]: p for p in transform.roster_payloads(resolver)}
    contact = payloads["bt-11004011"]["contact"]

    assert contact["formUrl"].endswith("mdbId=1")
    assert contact["constituencyOffice"] is None
    assert contact["socials"] == []


def test_the_display_name_carries_the_ortszusatz_because_it_disambiguates(
    resolver,
) -> None:
    # `ORTSZUSATZ` exists precisely to tell identical names apart (§7.1), so
    # dropping it from the display name would render two MPs identically.
    payloads = {p["internalId"]: p for p in transform.roster_payloads(resolver)}

    assert payloads["bt-11003142"]["name"] == "Hubertus Heil (Peine)"
    assert payloads["bt-11003142"]["ortsZusatz"] == "(Peine)"


def test_the_particle_and_the_nobiliary_prefix_are_stored_together(resolver) -> None:
    # The sheets print them together (`Frhr. von Stetten`) under a column
    # headed `Titel`, which does *not* hold academic titles (§4.1).
    payloads = {p["internalId"]: p for p in transform.roster_payloads(resolver)}

    assert payloads["bt-11003639"]["praefix"] == "Frhr. von"
    assert payloads["bt-11003639"]["name"] == "Christian Frhr. von Stetten"


def test_the_dip_id_reaches_the_roster_row_once_the_crosswalk_resolves(
    linked_resolver,
) -> None:
    payloads = {p["internalId"]: p for p in transform.roster_payloads(linked_resolver)}

    assert payloads["bt-11004011"]["dipPersonId"] == "1013"
    assert transform.dip_link_payloads(linked_resolver) == [
        {"internalId": "bt-11003142", "wahlperiode": 21, "dipPersonId": "2222"},
        {"internalId": "bt-11004011", "wahlperiode": 21, "dipPersonId": "1013"},
    ]


# --- enrichment -----------------------------------------------------------


def test_occupation_joins_by_stammdaten_id(resolver) -> None:
    """`ext_id_bundestagsverwaltung` is the Stammdaten id verbatim, so this is
    the one external join that needs no name matching at all."""
    enriched = transform.politician_enrichment(
        {"11004011": {"occupation": "Diplom-Verwaltungswirt", "education": "Jura"}}, resolver
    )

    assert [entry.internal_id for entry in enriched] == ["bt-11004011"]
    assert enriched[0].occupation == "Diplom-Verwaltungswirt"


def test_a_politician_outside_the_period_is_not_enriched(resolver) -> None:
    """`from_stammdaten_id` indexes the whole dump — 4 614 MPs across every
    period against 635 WP21 seats — because `speech_payloads` needs to resolve
    a `<redner id>` from a sitting outside the period being loaded.

    So it answers with an internal id for someone this roster does not have,
    and abgeordnetenwatch carries every member since 2005. Without the roster
    check the stage reported enriching 1 790 of 635 MPs against live data:
    former members attached to mandate rows that do not exist.
    """
    # 11000019 is in the Stammdaten excerpt but holds no WP21 mandate.
    enriched = transform.politician_enrichment(
        {"11000019": {"occupation": "Rechtsanwalt", "education": None}}, resolver
    )

    assert enriched == []


def test_a_politician_with_neither_field_yields_no_entry(resolver) -> None:
    """An entry carrying nothing would overwrite nothing, but it would count —
    and the stage reports its length as "MPs with occupation or education"."""
    enriched = transform.politician_enrichment(
        {"11004011": {"occupation": None, "education": None}}, resolver
    )

    assert enriched == []


# --- committees -----------------------------------------------------------


def test_a_chair_listed_twice_counts_as_one_seat(resolver) -> None:
    """§6.3: Stammdaten lists a chair as both `Vorsitzender` and
    `Ordentliches Mitglied`, so any finer key double-counts every chair."""
    payloads = transform.committee_payloads(resolver)
    keys = [(p["mpInternalId"], p["committeeName"]) for p in payloads]

    assert len(keys) == len(set(keys))


def test_committee_dates_are_day_level_and_open_ended(resolver) -> None:
    # Finer than anything DIP offers (§6.3), and an open `endDate` means still
    # serving rather than "unknown".
    laschet = next(
        p for p in transform.committee_payloads(resolver) if p["mpInternalId"] == "bt-11002718"
    )

    assert laschet["startDate"] == "2025-05-21"
    assert laschet["endDate"] is None
    assert laschet["role"] == "Ordentliches Mitglied"


def test_an_older_period_has_no_committee_data_at_all(dump) -> None:
    """§6.4: all committee entries belong to the current Wahlperiode.

    So an empty result for WP8 means *nothing was published* — the caller has
    to say so, or every past MP looks like they sat on no committees.
    """
    assert transform.committee_payloads(MPResolver(dump, 8)) == []


# --- votes ----------------------------------------------------------------


def test_the_ballot_records_absences_because_nothing_else_does(resolver) -> None:
    """§4.2: the protocol XML lists only MPs who *cast* a vote.

    So `absentCount` is recoverable from the XLSX and nowhere else, and a
    participation rate built on any other route is silently wrong in everyone's
    favour.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))

    payload = transform.vote_sheet_payload(
        sheet, title="Sportfördergesetz", sheet_date=dt.date(2026, 7, 10)
    )

    assert payload["absentCount"] == 1
    assert payload["yesCount"] == 6
    assert payload["noCount"] == 1
    # The denominator a participation rate needs: voters and absentees alike.
    assert payload["totalEligible"] == 8
    assert payload["date"] == "2026-07-10"


def test_abstain_and_absent_stay_distinct(resolver) -> None:
    """`Enthaltung` is a vote; `nichtabgegeben` is not.

    Collapsing them flatters everyone who stayed away, which is the specific
    distinction §4.1 verifies the sheets encode one-hot.
    """
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_42_1_synthetic.xlsx"))

    payload = transform.vote_sheet_payload(
        sheet, title="Testabstimmung", sheet_date=dt.date(2026, 1, 1)
    )

    assert payload["abstainCount"] == 1
    assert payload["invalidCount"] == 1
    assert payload["absentCount"] == 0


def test_vote_records_carry_the_party_as_printed_on_the_ballot(resolver) -> None:
    # Six WP21 MPs changed group mid-period (§6.4), so a historical ballot must
    # render as it was rather than as things later became.
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))

    payload = transform.vote_record_payloads(sheet, resolver)

    (stetten,) = payload["records"]
    assert stetten == {
        "mpInternalId": "bt-11003639",
        "vote": Vote.YES.value,
        "partyAtVote": "CDU/CSU",
        "remark": None,
    }
    assert payload["wahlperiode"] == 21
    assert payload["sitzungnr"] == 90
    assert payload["abstimmnr"] == 8


def test_an_unresolvable_vote_row_is_quarantined_not_dropped(resolver) -> None:
    # §7.3. The sheet is the only source of absences, so a dropped row is
    # unrecoverable from anywhere else.
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))

    transform.vote_record_payloads(sheet, resolver)

    assert len(resolver.quarantine.for_source("vote-sheet")) == 7


def test_a_ballot_with_no_date_is_refused_rather_than_backdated(resolver) -> None:
    # The schema requires a date and sorts on it lexicographically; a guessed
    # one puts the ballot in the wrong month of every MP's contribution graph.
    sheet = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))

    with pytest.raises(transform.TransformError, match="date"):
        transform.vote_sheet_payload(sheet, title="Sportfördergesetz")


# --- speeches -------------------------------------------------------------


def test_one_row_per_segment_not_per_rede(resolver) -> None:
    """§5.2's biggest trap, and the reason the schema keys on `speechIndex`.

    One `<rede>` holds several distinct speakers because a Zwischenfrage nests
    inside the speech it interrupts — 21/90 has 112 `<rede>` against 197
    speaker paragraphs. Re-grouping here would credit the interveners' words to
    whoever spoke first.
    """
    protocol = ProtocolClient.parse(fixture_bytes("protocols", "21090_excerpt.xml"))
    # The fixture keeps a real multi-speaker element: several segments share
    # one `rede_id` because a Zwischenfrage nested inside it.
    shared = [s for s in protocol.speeches if s.rede_id == protocol.speeches[0].rede_id]
    assert len(shared) > 1, "the fixture should keep a multi-speaker <rede>"

    # Re-point every speaker at the one roster MP, so what is measured is the
    # transform's row-per-segment rule rather than the excerpt's coverage.
    for speech in protocol.speeches:
        speech.speaker = speech.speaker.model_copy(update={"id": "11004011"})

    payloads = transform.speech_payloads(protocol, resolver, protocol_id="5806")
    indices = [p["speechIndex"] for p in payloads]

    assert len(payloads) == len(protocol.speeches)
    assert len(indices) == len(set(indices)), "speechIndex is part of the natural key"


def test_the_word_count_is_the_measure_scoring_uses(resolver) -> None:
    """§5.2: ranking by row count puts Habeck 36 speeches above Scholz for
    saying 25 % less, because question time fragments a minister's turn."""
    protocol = ProtocolClient.parse(fixture_bytes("protocols", "21090_excerpt.xml"))

    (bilger,) = transform.speech_payloads(protocol, resolver, protocol_id="5806")

    assert bilger["mpInternalId"] == "bt-11004011"
    assert bilger["wordCount"] > 0
    assert bilger["protocolDate"] == "2026-07-10"
    assert bilger["protocolId"] == "5806"
    assert bilger["topic"] == "Tagesordnungspunkt 22"


def test_zu_protokoll_speeches_are_included_or_excluded_deliberately(resolver) -> None:
    """§11.3 asks for this to be a decision rather than an accident.

    A *zu Protokoll gegebene Rede* was submitted for the record and never
    delivered — 17 of 112 in 21/90, 0 of 191 in 20/177.
    """
    protocol = ProtocolClient.parse(fixture_bytes("protocols", "21090_excerpt.xml"))
    for speech in protocol.speeches:
        speech.zu_protokoll = True

    assert transform.speech_payloads(protocol, resolver, include_zu_protokoll=False) == []
    assert transform.speech_payloads(protocol, resolver, include_zu_protokoll=True)


def test_the_feed_aggregates_a_sitting_rather_than_listing_every_segment() -> None:
    """Four rows in `speeches` is right; four feed entries on one day is not.

    An MP interrupted three times produced four segments — which is what
    `wordCount` needs — but the timeline would read as four separate speeches.
    """
    segments = [
        {
            "mpInternalId": "bt-11004011",
            "protocolDate": "2026-07-10",
            "wahlperiode": 21,
            "sitzungnr": 90,
            "wordCount": 100,
        },
        {
            "mpInternalId": "bt-11004011",
            "protocolDate": "2026-07-10",
            "wahlperiode": 21,
            "sitzungnr": 90,
            "wordCount": 250,
        },
    ]

    (event,) = transform.speech_event_payloads(segments, sitting_title="90. Sitzung")

    assert event["eventType"] == "speech"
    assert "350" in event["description"]
    assert event["referenceId"] == "21/90", "de-duplicates a re-ingested sitting"


# --- activities -----------------------------------------------------------


def test_the_activity_description_is_the_document_not_the_mps_own_name(
    linked_resolver,
) -> None:
    """§3.5: `aktivitaet.titel` holds the *person's* name.

    Used as a description it renders every entry in an MP's feed as the MP's
    own name — which looks like data rather than like a bug.
    """
    (first, _) = list(transform.activity_payloads(aktivitaeten(), linked_resolver))

    assert first["description"].startswith("Umsetzung des VN-Waffenembargos")
    assert "MdB" not in first["description"]
    assert first["mpInternalId"] == "bt-11004011"
    assert first["dipAktivitaetId"] == "1793259"
    assert first["date"] == "2026-07-24"


def test_the_activity_kind_is_passed_through_as_an_open_string(
    linked_resolver,
) -> None:
    """§3.5: no enum, no value list, no catalogue endpoint.

    Closing the set here would delete a whole class of parliamentary work from
    every MP's score with no error anywhere; Convex buckets unknown kinds into
    a counted `other` instead.
    """
    records = aktivitaeten()
    records[0].aktivitaetsart = "Eine völlig neue Aktivitätsart"

    (first, _) = list(transform.activity_payloads(records, linked_resolver))

    assert first["aktivitaetsart"] == "Eine völlig neue Aktivitätsart"


def test_an_activity_whose_person_has_not_been_linked_is_skipped(resolver) -> None:
    # Not quarantined: it means the DIP crosswalk has not run for that person,
    # which `unlinked_internal_ids` already tracks from the other side and
    # which resolves when `/person` is re-matched on the next sync.
    assert list(transform.activity_payloads(aktivitaeten(), resolver)) == []


# --- questions ------------------------------------------------------------


def test_a_kleine_anfrage_becomes_a_minor_question(linked_resolver) -> None:
    """The Große/Kleine split is constitutional — who must answer, and how —
    which is why the schema makes it a closed union unlike `aktivitaetsart`."""
    (first, second) = list(transform.question_payloads(aktivitaeten(), linked_resolver))

    assert first["type"] == "minor"
    assert second["type"] == "minor"
    assert first["subject"].startswith("Umsetzung des VN-Waffenembargos")


def test_a_grosse_anfrage_becomes_a_major_question(linked_resolver) -> None:
    records = aktivitaeten()
    records[0].aktivitaetsart = "Große Anfrage"

    (first, _) = list(transform.question_payloads(records, linked_resolver))

    assert first["type"] == "major"


def test_an_activity_that_is_not_an_anfrage_is_not_a_question(linked_resolver) -> None:
    # A Rede is an activity and is scored as one; forcing it into a union with
    # no value for it would be a claim the source does not make.
    records = aktivitaeten()
    for record in records:
        record.aktivitaetsart = "Rede"

    assert list(transform.question_payloads(records, linked_resolver)) == []


# --- motions --------------------------------------------------------------


def test_papers_sharing_a_procedure_collapse_to_the_originating_one() -> None:
    """Convex keys a motion on `dipVorgangId` first (webapp/convex/motions.ts).

    A Kleine Anfrage and the government's answer share one procedure, so
    posting both unmerged patches one row twice and leaves it titled with the
    answer — and the sponsors attached to it are the *question's* signatories.
    """
    question = {
        "dipVorgangId": "337602",
        "dipDrucksacheId": "289866",
        "drucksacheNr": "21/7327",
        "title": "Umsetzung des VN-Waffenembargos gegen Libyen",
        "type": "Kleine Anfrage",
        "date": "2026-07-01",
        "wahlperiode": 21,
        "vorgangstyp": "Kleine Anfrage",
    }
    answer = {
        **question,
        "dipDrucksacheId": "289999",
        "drucksacheNr": "21/7400",
        "title": "Antwort auf die Kleine Anfrage",
        "type": "Antwort",
        "date": "2026-07-24",
    }

    (merged,) = transform.dedupe_motions([answer, question])

    assert merged["title"] == "Umsetzung des VN-Waffenembargos gegen Libyen"
    assert merged["date"] == "2026-07-01"


def test_a_paper_with_no_procedure_keeps_its_own_identity() -> None:
    # Nothing can merge it, and its Drucksache id is all the identity it has.
    standalone = {
        "dipVorgangId": None,
        "dipDrucksacheId": "289876",
        "drucksacheNr": "21/7331",
        "title": "Antwort",
        "type": "Antwort",
        "date": "2026-07-24",
        "wahlperiode": 21,
        "vorgangstyp": None,
    }

    assert transform.dedupe_motions([standalone]) == [standalone]


def test_a_drucksache_title_loses_the_line_breaks_dip_embeds_in_it() -> None:
    """DIP puts literal `\\r\\n` inside titles.

    They break a single-line UI, and inside `questions.subject` — part of that
    table's natural key — a re-export that changes one line break turns an
    upsert into an insert.
    """
    drucksache = Drucksache.model_validate(
        {
            "id": "289876",
            "typ": "Dokument",
            "dokumentart": "Drucksache",
            "drucksachetyp": "Antwort",
            "dokumentnummer": "21/7331",
            "herausgeber": "BT",
            "datum": "2026-07-24",
            "aktualisiert": "2026-07-24T12:03:00+02:00",
            "titel": "Haushaltsführung 2024\r\nÜber- und außerplanmäßige Ausgaben",
            "wahlperiode": 21,
        }
    )

    payload = transform.motion_from_drucksache(drucksache)

    assert payload["title"] == "Haushaltsführung 2024 Über- und außerplanmäßige Ausgaben"


def test_a_vorgang_becomes_a_motion_keyed_on_the_procedure() -> None:
    vorgang = Vorgang.model_validate(fixture_json("dip", "vorgang_page.json")["documents"][0])

    payload = transform.motion_from_vorgang(vorgang)

    assert payload["dipVorgangId"] == "337602"
    assert payload["dipDrucksacheId"] is None
    assert payload["date"] == "2026-07-24"
    assert payload["vorgangstyp"] == "Kleine Anfrage"


def test_sponsors_come_from_the_per_mp_feed_not_from_the_paper(
    linked_resolver,
) -> None:
    """§3.4: `autoren_anzeige` is capped at four with the real total in
    `autoren_anzahl`, so authorship computed from the paper under-counts.

    The recorded Drucksache says `autoren_anzahl: 11` and lists two — which is
    exactly the shape that makes this necessary.
    """
    drucksache = Drucksache.model_validate(
        fixture_json("dip", "drucksache_page.json")["documents"][0]
    )
    assert drucksache.autoren_anzahl > len(drucksache.autoren_anzeige)

    (group,) = transform.motion_sponsor_payloads(aktivitaeten(), linked_resolver, wahlperiode=21)

    assert group["dipVorgangId"] == "337602"
    assert {s["mpInternalId"] for s in group["sponsors"]} == {"bt-11004011", "bt-11003142"}


def test_one_mp_sponsoring_a_motion_twice_is_one_sponsorship(linked_resolver) -> None:
    # Convex keys `motionSponsors` on `(motionId, mpInternalId)`, so a repeat
    # is an upsert — but sending it twice in one batch is a wasted write and
    # makes the reported count disagree with the rows.
    records = aktivitaeten(person_ids=("1013", "1013"))

    (group,) = transform.motion_sponsor_payloads(records, linked_resolver, wahlperiode=21)

    assert len(group["sponsors"]) == 1


# --- the unified feed -----------------------------------------------------


def test_a_zwischenfrage_is_a_speech_not_a_question() -> None:
    """It contains `anfrage` as a substring but is a spoken intervention.

    Mirrors the ordering in `bucketFor` (webapp/lib/scoring.ts), where the same
    substring collision has the same answer — §5.2 counts the intervener's own
    words.
    """
    assert transform.event_type_for("Zwischenfrage") == "speech"
    assert transform.event_type_for("Kleine Anfrage") == "question"
    assert transform.event_type_for("Rede") == "speech"
    assert transform.event_type_for("Gesetzentwurf") == "bill"
    assert transform.event_type_for("Antrag") == "motion"


def test_an_unrecognised_activity_kind_still_reaches_the_feed() -> None:
    # It appears labelled generically rather than vanishing from the MP's
    # timeline — the same reasoning as the `other` bucket in scoring (§3.5).
    assert transform.event_type_for("Etwas ganz Neues") == "activity"


def test_feed_events_point_back_at_their_source_row(linked_resolver) -> None:
    """`referenceType`/`referenceId` is what makes re-deriving an upsert.

    An event with a null `referenceId` cannot be de-duplicated and a re-run
    appends it (webapp/convex/activityEvents.ts).
    """
    (first, _) = list(transform.activity_event_payloads(aktivitaeten(), linked_resolver))

    assert first["referenceId"] == "1793259"
    assert first["referenceType"] == "dipAktivitaet"
    assert first["eventType"] == "question"


def test_a_vote_event_is_emitted_for_an_absence_too(resolver) -> None:
    """ "Did not vote" is a fact about a sitting an MP's timeline should show,
    and the XLSX is the only source that records it (§4.2)."""
    parsed = parse_sheet(fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"))
    # Re-point the sheet's rows at the one MP the roster excerpt has, keeping
    # each row's own vote — so what is measured is that an absence produces an
    # event, not how much of the ballot the excerpt happens to cover.
    sheet = parsed.model_copy(
        update={
            "date": dt.date(2026, 7, 10),
            "records": [
                record.model_copy(update={"name": "Stetten", "vorname": "Christian"})
                for record in parsed.records
            ],
        }
    )

    events = transform.vote_event_payloads(sheet, resolver, title="Sportfördergesetz")

    assert {event["description"] for event in events} >= {"yes", "absent"}
    assert all(event["referenceId"] == "21/90/8" for event in events)
    assert all(event["eventType"] == "vote" for event in events)
