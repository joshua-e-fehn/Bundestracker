"""Speech extraction and roll-call parsing from protocol XML.

The fixture is a real excerpt of protocol 21/90, keeping the two `<rede>`
elements that carry the traps — `ID219001100`, which holds a minister and three
interveners, and `ID219000100`, where the chair interrupts — one roll-call
block, and one *zu Protokoll gegebene Rede* from `<anlagen>`.

The numbers asserted below were measured against the **full** protocol before
trimming, and reproduce the research's figures exactly: 197 segments, 108
speakers, 8 multi-speaker elements, 4 736 ballot names, 17 written speeches.
"""

from __future__ import annotations

import datetime as dt

import pytest

from bundestrack.api.protocols import (
    FIRST_XML_WAHLPERIODE,
    ProtocolClient,
    normalise_text,
    protocol_xml_url,
)
from tests.conftest import fixture_bytes


@pytest.fixture(scope="module")
def protocol():
    return ProtocolClient.parse(fixture_bytes("protocols", "21090_excerpt.xml"))


# --- sitting metadata ------------------------------------------------------


def test_sitting_metadata_comes_from_the_root_attributes(protocol) -> None:
    """§5.2: never parse `<rede id>` for these.

    Its format is `ID{wp:02d}{sitzung}{seq:05d}` with the sitting *not*
    zero-padded, so `ID219000100` (WP21/90) and `ID2017700100` (WP20/177) cannot
    be split unambiguously.
    """
    assert protocol.wahlperiode == 21
    assert protocol.sitzungnr == 90
    assert protocol.date == dt.date(2026, 7, 10)
    assert protocol.start_time == "09:00"


def test_the_xml_url_formula_reproduces_the_published_one() -> None:
    # §8. Prefer `fundstelle.xml_url` from the API; this is for validation.
    assert protocol_xml_url(21, 90) == "https://dserver.bundestag.de/btp/21/21090.xml"
    assert protocol_xml_url(20, 177) == "https://dserver.bundestag.de/btp/20/20177.xml"


def test_fetching_a_pre_xml_period_fails_with_an_explanation() -> None:
    # §5.2: XML exists from WP18; WP1–17 are PDF-only. Better to say so than to
    # 404 against a URL that was never going to exist.
    client = ProtocolClient()
    with pytest.raises(ValueError, match=f"WP{FIRST_XML_WAHLPERIODE}"):
        client.fetch_for_sitting(17, 1)


# --- the multi-speaker trap ------------------------------------------------


def test_one_rede_can_hold_several_distinct_speakers(protocol) -> None:
    """§5.2's biggest trap, on the element the research names.

    `ID219001100` contains a minister and three interveners. Taking
    `rede.find(".//redner")` — the first speaker — credits all four to her.
    """
    segments = [s for s in protocol.speeches if s.rede_id == "ID219001100"]
    speakers = {s.speaker.id for s in segments}

    assert speakers == {"11004437", "11005527", "11004773", "11005018"}
    assert len(segments) > len(speakers), "the minister resumes between interventions"


def test_each_speakers_words_are_attributed_to_them(protocol) -> None:
    words: dict[str, int] = {}
    for segment in protocol.speeches:
        if segment.rede_id == "ID219001100":
            words[segment.speaker.id] = words.get(segment.speaker.id, 0) + segment.word_count

    # The interveners' contributions, measured against the full protocol.
    assert words["11005527"] == 48
    assert words["11004773"] == 134
    assert words["11005018"] == 60
    # …and the minister keeps only her own.
    assert words["11004437"] == 1435


def test_a_speech_segment_is_not_a_rede_element(protocol) -> None:
    # The unit is a segment. Aggregating on `(rede_id, speaker)` gives the "one
    # speech" unit; on speaker alone, per-MP totals (§5.2).
    rede_ids = {s.rede_id for s in protocol.speeches}
    assert len(protocol.speeches) > len(rede_ids)


# --- the presidential interruption -----------------------------------------


def test_the_chairs_words_are_not_credited_to_the_previous_speaker(protocol) -> None:
    """A finding beyond the research, found by reading the XML.

    §5.2 says presidents "self-exclude" because they sit outside any `<rede>`,
    and the 31 in 21/90 that do are handled by walking `<rede>` alone. But when
    the chair interrupts *mid-speech* they appear as a bare `<name>` child
    **inside** the `<rede>`, with no `<redner id>`, and the paragraphs after it
    are theirs.

    Measured on the full protocols: 145 such paragraphs in 21/90 (1 683 words,
    2.7 %) and 177 in 20/177 (1 990 words, 3.4 %) — silently credited to
    whoever spoke before the chair, always in their favour.
    """
    chair_phrases = [
        "Jetzt hat die Ministerin das Wort",
        "Einen Moment, bitte",
        "lassen Sie eine Zwischenfrage zu",
    ]
    for segment in protocol.speeches:
        for phrase in chair_phrases:
            assert phrase not in segment.text, (
                f"the chair's words leaked into {segment.speaker.id}'s segment"
            )


def test_a_name_child_ends_the_current_speech_rather_than_starting_one(protocol) -> None:
    # The chair has no `<redner id>`, so they must not become a speaker either —
    # otherwise the leak turns into a phantom MP with an empty id.
    assert all(s.speaker.id for s in protocol.speeches)
    assert all(len(s.speaker.id) == 8 and s.speaker.id.isdigit() for s in protocol.speeches)


def test_interjections_are_not_counted_as_the_speakers_words(protocol) -> None:
    # `<kommentar>` holds applause and heckling *by other people* (§5.2).
    for segment in protocol.speeches:
        assert "Beifall bei" not in segment.text


# --- speech scope ----------------------------------------------------------


def test_speeches_outside_the_agenda_tree_are_found_and_tagged(protocol) -> None:
    """§5.2: 17 of 112 speeches in 21/90 live under `<anlagen>`.

    *Zu Protokoll gegebene Reden* — submitted for the record, never delivered.
    Iterating `<tagesordnungspunkt>` alone drops them silently; `root.iter` finds
    them, and the tag makes counting them a decision rather than an accident.
    """
    written = [s for s in protocol.speeches if s.zu_protokoll]
    assert written, "the fixture keeps one written speech"
    assert all(s.topic is None for s in written), "an appendix speech has no agenda item"

    spoken = [s for s in protocol.speeches if not s.zu_protokoll]
    assert spoken and any(s.topic for s in spoken)


def test_the_agenda_item_is_attached_to_each_speech(protocol) -> None:
    # `<top-titel>` is never populated (0/17 checked, §5.2), so `@top-id` is the
    # available label.
    topics = {s.topic for s in protocol.speeches if s.topic}
    assert "Tagesordnungspunkt 22" in topics


def test_a_government_speakers_role_is_captured(protocol) -> None:
    # The reason flat-text parsing misses ministers: their speaker label reads
    # `Nina Warken, Bundesministerin für Gesundheit:` with no `(Fraktion)`
    # suffix to match on (§5.1).
    minister = next(s for s in protocol.speeches if s.speaker.id == "11004437")
    assert minister.speaker.rolle
    assert "Bundesministerin" in minister.speaker.rolle


def test_the_speaker_id_is_a_stammdaten_id_not_a_dip_one(protocol) -> None:
    # §5.2/§7: `GET /person/11004011` is a 404, while `11004011` is Steffen
    # Bilger's `<MDB><ID>`. This is what makes speeches joinable without names.
    bilger = next(s for s in protocol.speeches if s.speaker.nachname == "Bilger")
    assert bilger.speaker.id == "11004011"


# --- roll-call name lists --------------------------------------------------


def test_a_ballot_block_is_read_out_of_the_appendix(protocol) -> None:
    # §4.2. Valuable because it covers every sitting with XML, with no scraping
    # of opaque blob URLs.
    assert protocol.ballots
    ballot = protocol.ballots[0]
    assert ballot.title == "Endgültiges Ergebnis"
    assert ballot.announced_total == 606
    assert (ballot.announced_yes, ballot.announced_no, ballot.announced_abstain) == (318, 284, 4)


def test_ballot_names_carry_their_vote_and_party(protocol) -> None:
    from bundestrack.models.votes import Vote

    ballot = protocol.ballots[0]
    first = ballot.names[0]

    assert first.name == "Knut Abraham"
    assert first.fraktion == "CDU/CSU"
    # Mapped onto the shared vocabulary, so this route's counts are directly
    # comparable with the XLSX route's rather than needing translating first.
    assert first.vote is Vote.YES
    assert first.vote_label == "Ja"  # …and the source's own word is kept


def test_a_ballot_never_reports_an_absence(protocol) -> None:
    # §4.2, structurally: the appendix has no paragraph class for an absence, so
    # `Vote.ABSENT` cannot arise here however the parse goes.
    from bundestrack.models.votes import Vote

    tally = protocol.ballots[0].tally()
    assert tally[Vote.ABSENT] == 0
    assert tally[Vote.INVALID] == 0


def test_an_unknown_vote_label_skips_its_names_rather_than_guessing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # The appendix's vocabulary is small and closed. Filing names under a
    # guessed vote would fabricate ballot records that look authoritative.
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <dbtplenarprotokoll wahlperiode="21" sitzung-nr="90" sitzung-datum="10.07.2026">
      <sitzungsverlauf><tagesordnungspunkt top-id="TOP 1">
        <p klasse="AL_Vorspann_1">Endgültiges Ergebnis</p>
        <p klasse="AL_Ja-Nein-Enth">Vielleicht</p>
        <p klasse="AL_Partei">CDU/CSU</p>
        <p klasse="AL_Namen">Someone Unknown</p>
        <p klasse="AL_Ja-Nein-Enth">Ja</p>
        <p klasse="AL_Namen">Someone Known</p>
      </tagesordnungspunkt></sitzungsverlauf>
    </dbtplenarprotokoll>"""

    parsed = ProtocolClient.parse(xml)

    assert [n.name for n in parsed.ballots[0].names] == ["Someone Known"]
    assert "Vielleicht" in caplog.text


def test_non_breaking_spaces_are_normalised_out_of_party_labels(protocol) -> None:
    """§4.2's parsing trap: the source spells this `BÜNDNIS\xa090/ DIE GRÜNEN`.

    Left in, it breaks every match against a party name from any other source.
    """
    parties = {n.fraktion for b in protocol.ballots for n in b.names if n.fraktion}
    assert parties
    assert not any("\xa0" in p for p in parties)
    assert any(p.startswith("BÜNDNIS 90") for p in parties)


def test_names_are_normalised_too(protocol) -> None:
    # `Dr.\xa0Reza Asghari` in the source.
    names = [n.name for b in protocol.ballots for n in b.names]
    assert not any("\xa0" in n for n in names)


def test_a_ballot_can_report_whether_its_tally_matches_its_header(protocol) -> None:
    # The state machine walks a flat paragraph sequence with no nesting to check
    # itself against, so the announced counts are the available cross-check.
    ballot = protocol.ballots[0]
    assert ballot.tally()  # counted from the names
    # The fixture keeps only two names per party, so it deliberately disagrees.
    assert not ballot.matches_announced()


def test_normalise_text_collapses_every_kind_of_whitespace() -> None:
    assert normalise_text("Dr.\xa0Reza  Asghari\n") == "Dr. Reza Asghari"
    assert normalise_text(None) == ""
    assert normalise_text("   ") == ""
