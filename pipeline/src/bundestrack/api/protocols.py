"""Plenary protocol XML — speeches and roll-call name lists.

`dserver.bundestag.de/btp/<wp>/<wp><sitzung:03d>.xml`, ~1.2 MB per sitting, no
authentication. This is the only source of speaker-attributed speech data: the
DIP `-text` endpoint returns one flat string per sitting, and segmenting it with
regexes inflates word counts by +53.6 % and misses 35 speakers
(docs/api-research.md §5.1).

Prefer `fundstelle.xml_url` from a DIP `/plenarprotokoll` record over building
the URL — the API supplies it, Bundesrat protocols do not have one at all, and
there is no browsable directory to enumerate (§5.2).

**Coverage:** XML exists from WP18 (22.10.2013) onward; WP1–17 are PDF-only.

The parser walks *direct children of `<rede>` in document order*, which is what
makes the two attribution rules work:

1. **Re-attribute on every `klasse="redner"` paragraph.** One `<rede>` can hold
   several distinct speakers — Zwischenfragen and Kurzinterventionen — so
   `rede.find(".//redner")` credits the interveners' words to the main speaker.
   Protocol 21/90 has 112 `<rede>` but 197 speaker paragraphs (§5.2).

2. **A bare `<name>` child ends the current speech.** This one is *not* in the
   research, and it was found by reading the XML rather than the document: when
   the chair interrupts mid-`<rede>`, they appear as a `<name>` element —
   `Präsidentin Julia Klöckner:` — with **no `<redner id>`**, and the paragraphs
   that follow are the chair's words, not the speaker's. §5.2 states that
   presidents "self-exclude" because they sit outside any `<rede>`, and 31 of
   them in 21/90 do. But 145 more paragraphs in 21/90 and 177 in 20/177 follow a
   `<name>` *inside* a `<rede>`, and attributing them to the previous speaker
   inflates that sitting by 1 683 and 1 990 words respectively — ~3 %, silently,
   and always in favour of whoever spoke before the chair. `<name>` therefore
   clears the current speaker, and its text is discarded.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import date
from typing import Any

from bundestrack.api.base import BundestagClient
from bundestrack.models.speeches import (
    SPEAKER_PARAGRAPH_CLASS,
    SPEECH_PARAGRAPH_CLASSES,
    BallotBlock,
    BallotName,
    Protocol,
    Speaker,
    Speech,
)
from bundestrack.models.stammdaten import parse_german_date
from bundestrack.models.votes import Vote

logger = logging.getLogger(__name__)

DOCUMENT_SERVER = "https://dserver.bundestag.de"

#: First Wahlperiode with protocol XML, per the spec's own note on `xml_url`
#: (§5.2). Earlier periods are PDF-only.
FIRST_XML_WAHLPERIODE = 18

#: The appendix's roll-call markers (§4.2). The block is a flat `<p>` sequence
#: with no nesting, so it is read as a state machine.
BALLOT_HEADER = "AL_Vorspann_1"  # starts a new vote block
BALLOT_TOTALS = "AL_Vorspann_2"  # "Abgegebene Stimmen: 606;"
BALLOT_BREAKDOWN = "AL_Vorspann_3"  # "ja: 318"
BALLOT_VOTE = "AL_Ja-Nein-Enth"  # sets the current vote value
BALLOT_PARTY = "AL_Partei"  # sets the current party
BALLOT_NAME = "AL_Namen"  # one MP

#: Vote labels as printed in the appendix → the shared vocabulary.
#: ⚠ There is deliberately no `absent` entry: the XML lists only MPs who *cast*
#: a vote, so absences are unrecoverable from this route (§4.2).
BALLOT_VOTE_VALUES = {"Ja": Vote.YES, "Nein": Vote.NO, "Enthalten": Vote.ABSTAIN}

_NUMBER = re.compile(r"(\d+)")


def normalise_text(value: str | None) -> str:
    """Collapse whitespace, including the non-breaking spaces this source uses.

    `\xa0` appears inside party labels (`BÜNDNIS\xa090/ DIE GRÜNEN`), names
    (`Dr.\xa0Reza Asghari`) and agenda ids, and breaks naive matching wherever it
    survives (§4.2). `.split()` treats it as whitespace, so this normalises and
    collapses in one pass.
    """
    if not value:
        return ""
    return " ".join(value.split())


def protocol_xml_url(wahlperiode: int, sitzungnr: int) -> str:
    """Reconstruct a protocol XML URL (§8).

    For validation and for the rare record with no `fundstelle.xml_url`; the API
    is the source of truth otherwise.
    """
    return f"{DOCUMENT_SERVER}/btp/{wahlperiode}/{wahlperiode}{sitzungnr:03d}.xml"


class ProtocolClient(BundestagClient):
    """Fetches and parses plenary protocol XML.

    Parsing is a pure function of the bytes, so `parse` is a static method and
    every test runs against a recorded fixture rather than the network.
    """

    def fetch(self, url: str) -> Protocol:
        """Download and parse one protocol."""
        return self.parse(self.get_bytes(url))

    def fetch_for_sitting(self, wahlperiode: int, sitzungnr: int) -> Protocol:
        if wahlperiode < FIRST_XML_WAHLPERIODE:
            raise ValueError(
                f"No protocol XML exists for Wahlperiode {wahlperiode}; "
                f"XML starts at WP{FIRST_XML_WAHLPERIODE} (docs/api-research.md §5.2)."
            )
        return self.fetch(protocol_xml_url(wahlperiode, sitzungnr))

    # -- parsing -----------------------------------------------------------

    @staticmethod
    def parse(data: bytes | str) -> Protocol:
        """Parse a protocol into speeches and ballot blocks."""
        root = ET.fromstring(data) if isinstance(data, str) else ET.fromstring(data.decode("utf-8"))
        return ProtocolClient.parse_root(root)

    @staticmethod
    def parse_root(root: ET.Element) -> Protocol:
        # From the root attributes, never from `<rede id>`: that id packs the
        # sitting number without zero-padding, so `ID219000100` (WP21/90) and
        # `ID2017700100` (WP20/177) cannot be split unambiguously (§5.2).
        wahlperiode = int(root.get("wahlperiode") or 0)
        sitzungnr = int(root.get("sitzung-nr") or 0)
        sitting_date = parse_german_date(root.get("sitzung-datum"))

        return Protocol(
            wahlperiode=wahlperiode,
            sitzungnr=sitzungnr,
            date=sitting_date,
            start_time=root.get("sitzung-start-uhrzeit"),
            end_time=root.get("sitzung-ende-uhrzeit"),
            location=root.get("sitzung-ort"),
            speeches=ProtocolClient._parse_speeches(root, wahlperiode, sitzungnr, sitting_date),
            ballots=ProtocolClient._parse_ballots(root, wahlperiode, sitzungnr, sitting_date),
        )

    @staticmethod
    def _parse_speeches(
        root: ET.Element, wahlperiode: int, sitzungnr: int, sitting_date: date | None
    ) -> list[Speech]:
        """Extract one segment per speaker turn.

        `root.iter("rede")` rather than `.//tagesordnungspunkt/rede`: 17 of 112
        speeches in 21/90 live under `<anlagen>` instead — *zu Protokoll gegebene
        Reden*, submitted for the record and never delivered — and iterating the
        agenda tree alone silently drops them (§5.2). They are tagged rather than
        filtered, so whether they count stays the caller's decision.
        """
        topics = _topic_by_rede(root)
        written = {id(r) for r in root.findall(".//anlagen//rede")}
        speeches: list[Speech] = []
        index = 0

        for rede in root.iter("rede"):
            speaker: Speaker | None = None
            buffer: list[str] = []

            def flush(speaker: Speaker | None, buffer: list[str], rede: ET.Element) -> None:
                nonlocal index
                if speaker is None or not buffer:
                    return
                speeches.append(
                    Speech(
                        rede_id=rede.get("id"),
                        speaker=speaker,
                        text=" ".join(buffer),
                        wahlperiode=wahlperiode,
                        sitzungnr=sitzungnr,
                        protocol_date=sitting_date,
                        speech_index=index,
                        topic=topics.get(id(rede)),
                        zu_protokoll=id(rede) in written,
                    )
                )
                index += 1

            # Direct children only, in document order — the ordering is the
            # attribution. `<kommentar>` (applause and heckling by *other*
            # people) and `<zitat>` are skipped by not matching any branch.
            for child in rede:
                if child.tag == "p" and child.get("klasse") == SPEAKER_PARAGRAPH_CLASS:
                    flush(speaker, buffer, rede)
                    buffer = []
                    speaker = _parse_speaker(child)
                elif child.tag == "name":
                    # The chair, interrupting mid-speech. Everything after this
                    # belongs to them, not to the speaker — see the module
                    # docstring, finding 2. Clearing the speaker discards it.
                    flush(speaker, buffer, rede)
                    buffer = []
                    speaker = None
                elif child.tag == "p" and child.get("klasse") in SPEECH_PARAGRAPH_CLASSES:
                    text = normalise_text("".join(child.itertext()))
                    if text:
                        buffer.append(text)
            flush(speaker, buffer, rede)

        return speeches

    @staticmethod
    def _parse_ballots(
        root: ET.Element, wahlperiode: int, sitzungnr: int, sitting_date: date | None
    ) -> list[BallotBlock]:
        """Read the roll-call name lists out of the appendix (§4.2).

        A state machine over a flat `<p>` sequence: `AL_Vorspann_1` opens a
        block, `AL_Ja-Nein-Enth` sets the current vote, `AL_Partei` the current
        party, and each `AL_Namen` is one MP under both.

        ⚠ Absences are **not** here. The list covers only MPs who cast a vote,
        so a ballot reconstructed from XML alone reports every absence as if it
        never happened — the XLSX sheets remain authoritative (§4.2).
        """
        blocks: list[BallotBlock] = []
        current: dict[str, Any] | None = None
        vote_label: str | None = None
        party: str | None = None

        for paragraph in root.iter("p"):
            klasse = paragraph.get("klasse") or ""
            if not klasse.startswith("AL_"):
                continue
            text = normalise_text("".join(paragraph.itertext()))

            if klasse == BALLOT_HEADER:
                if current:
                    blocks.append(_finish_block(current, wahlperiode, sitzungnr, sitting_date))
                current = {"title": text, "names": []}
                vote_label = party = None
            elif current is None:
                # Names before any header would have no block to belong to.
                continue
            elif klasse == BALLOT_TOTALS:
                if (match := _NUMBER.search(text)) and "total" not in current:
                    current["total"] = int(match.group(1))
            elif klasse == BALLOT_BREAKDOWN:
                _record_breakdown(current, text)
            elif klasse == BALLOT_VOTE:
                vote_label = text
                if text not in BALLOT_VOTE_VALUES:
                    # The appendix's vocabulary is small and closed (§4.2), so an
                    # unknown label means the format moved. Log it and drop the
                    # block's remaining names rather than file them under a
                    # guessed vote.
                    logger.warning(
                        "Unknown ballot vote label %r — names under it are skipped", text
                    )
            elif klasse == BALLOT_PARTY:
                party = text
            elif klasse == BALLOT_NAME and vote_label in BALLOT_VOTE_VALUES:
                current["names"].append(
                    BallotName(
                        name=text,
                        fraktion=party,
                        vote=BALLOT_VOTE_VALUES[vote_label],
                        vote_label=vote_label,
                    )
                )

        if current:
            blocks.append(_finish_block(current, wahlperiode, sitzungnr, sitting_date))
        return blocks


def _parse_speaker(paragraph: ET.Element) -> Speaker | None:
    """Read the speaker out of a `klasse="redner"` paragraph.

    The id is the 8-digit **Stammdaten** id — the join key to the roster, and a
    404 against DIP `/person` (§5.2, §7).
    """
    redner = paragraph.find("redner")
    if redner is None:
        return None
    name = redner.find("name")
    if name is None:
        return Speaker(id=redner.get("id"))
    return Speaker(
        id=redner.get("id"),
        vorname=normalise_text(name.findtext("vorname")) or None,
        nachname=normalise_text(name.findtext("nachname")) or None,
        fraktion=normalise_text(name.findtext("fraktion")) or None,
        rolle=normalise_text(name.findtext("rolle/rolle_lang")) or None,
    )


def _topic_by_rede(root: ET.Element) -> dict[int, str]:
    """Map each `<rede>` to its agenda item.

    Keyed by `id()` because `ElementTree` elements are unhashable-by-value and
    two agenda items can carry the same `top-id` text. `<top-titel>` is never
    populated (0/17 checked, §5.2), so `@top-id` — `Tagesordnungspunkt 22`,
    `Zusatzpunkt 28, 29` for a merged debate — is the available label.
    """
    topics: dict[int, str] = {}
    for item in root.iter("tagesordnungspunkt"):
        label = normalise_text(item.get("top-id")) or None
        if not label:
            continue
        for rede in item.iter("rede"):
            topics[id(rede)] = label
    return topics


def _record_breakdown(block: dict[str, Any], text: str) -> None:
    """Parse one `ja:\t318` line from a ballot header."""
    match = _NUMBER.search(text)
    if not match:
        return
    count = int(match.group(1))
    label = text.split(":")[0].strip().casefold()
    if label.startswith("ja"):
        block["yes"] = count
    elif label.startswith("nein"):
        block["no"] = count
    elif label.startswith("enthalt"):
        block["abstain"] = count


def _finish_block(
    block: dict[str, Any], wahlperiode: int, sitzungnr: int, sitting_date: date | None
) -> BallotBlock:
    return BallotBlock(
        wahlperiode=wahlperiode,
        sitzungnr=sitzungnr,
        protocol_date=sitting_date,
        title=block.get("title"),
        announced_total=block.get("total"),
        announced_yes=block.get("yes"),
        announced_no=block.get("no"),
        announced_abstain=block.get("abstain"),
        names=block["names"],
    )
