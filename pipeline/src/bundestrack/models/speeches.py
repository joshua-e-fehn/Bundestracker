"""Models for plenary protocol speech data.

There is no endpoint that returns structured, speaker-attributed speeches. The
DIP `-text` endpoints return one flat string per sitting, and regex-segmenting
it inflates word counts by **+53.6 %** and misses 35 speakers against the XML
ground truth (docs/api-research.md §5.1). Speeches come from the protocol XML,
parsed by `api.protocols`.

The unit here is a **segment**, not a `<rede>` element. That distinction is the
research's biggest trap (§5.2) and the reason `Speech` is shaped as it is: one
`<rede>` can hold several distinct speakers, because a Zwischenfrage or
Kurzintervention puts another MP inside the same element. Protocol 21/90 has
112 `<rede>` but 197 speaker paragraphs, 8 of them genuinely multi-speaker;
21/90's `ID219001100` alone contains a minister and three interveners, and
attributing the whole element to its first speaker would credit her with all
1 841 words instead of her 1 599.

⚠ **Rank by words, not speech count.** Question time fragments one minister's
turn into dozens of short replies: on 20177.xml Habeck has 36 `<rede>` for
4 826 words against Scholz's 1 for 3 874 (§5.2). A "most active speaker" metric
keyed on count ranks Habeck 36× above Scholz for saying 25 % less, and
systematically favours ministers over backbenchers for reasons that have
nothing to do with parliamentary activity.
"""

from __future__ import annotations

# `datetime.date` is imported qualified because `Protocol` has a field *named*
# `date`, which would otherwise shadow the type in its own annotation namespace.
import datetime as dt

from pydantic import BaseModel, ConfigDict, Field

from bundestrack.models.votes import Vote, tally_votes

#: `<p klasse="…">` values that carry speech text inside a `<rede>` (§5.2).
#: `redner` is excluded — it is the speaker header. `<kommentar>` is not a `<p>`
#: at all and is excluded structurally: it holds applause and heckling *by other
#: people*, so counting it attributes other MPs' interjections to the speaker.
SPEECH_PARAGRAPH_CLASSES = frozenset({"J", "J_1", "O", "Z", "J_Abstand"})

#: The speaker-header paragraph class. Every occurrence re-attributes the
#: segment — this is the multi-speaker fix (§5.2).
SPEAKER_PARAGRAPH_CLASS = "redner"


class Speaker(BaseModel):
    """Who was speaking.

    `id` is the 8-digit **Stammdaten** id, not a DIP person id — `GET
    /person/11004011` is a 404 while `11004011` is Steffen Bilger's `<MDB><ID>`
    (§5.2, §7). This is what makes speeches joinable to the roster by id with no
    name matching at all.
    """

    model_config = ConfigDict(frozen=True)

    id: str | None = None
    vorname: str | None = None
    nachname: str | None = None
    #: ⚠ Contains non-breaking spaces in the source (`BÜNDNIS\xa090/DIE GRÜNEN`);
    #: `api.protocols` normalises them before this is populated (§4.2).
    fraktion: str | None = None
    #: `Bundesministerin für Gesundheit` — set for government members, None for
    #: backbenchers. Its presence is why flat-text parsing misses ministers:
    #: their speaker label has no `(Fraktion)` suffix to match on (§5.1).
    rolle: str | None = None

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.vorname, self.nachname) if p)


class Speech(BaseModel):
    """One speaker's continuous turn within one `<rede>` — a *segment*.

    Several segments can share a `rede_id`: either the same speaker resumed
    after the chair interrupted (21 such elements in 21/90), or a different MP
    intervened (8 elements). Aggregate on `(rede_id, speaker.id)` for the "one
    speech" unit, or on `speaker.id` alone for per-MP daily totals (§5.2).
    """

    rede_id: str | None = None
    speaker: Speaker
    text: str
    wahlperiode: int
    sitzungnr: int
    protocol_date: dt.date | None = None
    #: Position of this segment in the sitting, in document order. Part of the
    #: natural key the Convex `speeches` table indexes on.
    speech_index: int = 0
    #: Agenda context from the enclosing `<tagesordnungspunkt top-id>`, e.g.
    #: `Tagesordnungspunkt 22` or `Zusatzpunkt 28, 29` (a merged debate).
    #: None for a speech under `<anlagen>`, which has no agenda item.
    topic: str | None = None
    #: A *zu Protokoll gegebene Rede* — submitted for the record, never
    #: delivered aloud. 17 of 112 in protocol 21/90, 0 of 191 in 20/177, so the
    #: share varies by sitting (§5.2). Tagged either way so that whether these
    #: count toward an activity score stays a decision rather than an accident.
    zu_protokoll: bool = False

    @property
    def word_count(self) -> int:
        """The measure scoring should use — see the module docstring."""
        return len(self.text.split())


class BallotName(BaseModel):
    """One MP's name in a roll-call list inside the protocol appendix (§4.2)."""

    model_config = ConfigDict(frozen=True)

    #: Full display name as printed (`Dr. Reza Asghari`) — **not** split into
    #: surname and forename, unlike the XLSX sheets.
    name: str
    #: ⚠ Normalised: the source spells these with non-breaking spaces
    #: (`BÜNDNIS\xa090/ DIE GRÜNEN`), which breaks naive matching (§4.2).
    fraktion: str | None = None
    #: The vote, in the same vocabulary the XLSX route uses — so the two can be
    #: compared without a translation step at every call site. ⚠ Never
    #: `Vote.ABSENT`: this route lists only MPs who cast a vote (§4.2).
    vote: Vote
    #: The label as printed (`Ja`, `Nein`, `Enthalten`), kept so a mismatch
    #: against the block's own header can be reported in the source's words.
    vote_label: str


class BallotBlock(BaseModel):
    """One roll-call vote reconstructed from the protocol XML appendix.

    ⚠ **Absences are not recoverable from this route.** The XML lists only MPs
    who *cast* a vote, so `nichtabgegeben` — 68 MPs in the cross-validated
    ballot — is simply missing (§4.2). The XLSX sheets are the only source with
    absences, which is why they remain authoritative and this route is for
    coverage: every sitting with XML, without scraping opaque blob URLs.

    The header counts (`announced_*`) are parsed alongside the names precisely
    so a caller can check the two agree; the research's 8 blocks and 4 736 names
    on 21/90 tallied exactly.
    """

    wahlperiode: int
    sitzungnr: int
    protocol_date: dt.date | None = None
    #: `Endgültiges Ergebnis` — the appendix's own label for the block.
    title: str | None = None
    announced_total: int | None = None
    announced_yes: int | None = None
    announced_no: int | None = None
    announced_abstain: int | None = None
    names: list[BallotName] = Field(default_factory=list)

    def tally(self) -> dict[Vote, int]:
        """Counted from the names — the same shape the XLSX route reports.

        Sharing `tally_votes` with `votes.VoteSheet` is what makes the two
        routes directly comparable, which is the whole point of having both.
        """
        return tally_votes(entry.vote for entry in self.names)

    def matches_announced(self) -> bool:
        """Whether the counted names agree with the block's own header.

        A disagreement means the parse dropped or double-counted names, and it
        is worth surfacing: the state machine walks a flat paragraph sequence
        with no nesting to validate it against.
        """
        counted = self.tally()
        for announced, vote in (
            (self.announced_yes, Vote.YES),
            (self.announced_no, Vote.NO),
            (self.announced_abstain, Vote.ABSTAIN),
        ):
            if announced is not None and counted[vote] != announced:
                return False
        return True


class Protocol(BaseModel):
    """A parsed plenary protocol: its sitting metadata, speeches and ballots.

    `wahlperiode` and `sitzungnr` come from the **root element's attributes**,
    never from parsing `<rede id>`: that id is `ID{wp:02d}{sitzung}{seq:05d}`
    with the sitting *not* zero-padded, so `ID219000100` and `ID2017700100` are
    genuinely ambiguous to split (§5.2).
    """

    wahlperiode: int
    sitzungnr: int
    date: dt.date | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    speeches: list[Speech] = Field(default_factory=list)
    ballots: list[BallotBlock] = Field(default_factory=list)

    @property
    def speaker_ids(self) -> set[str]:
        return {s.speaker.id for s in self.speeches if s.speaker.id}

    def words_by_speaker(self) -> dict[str, int]:
        """Per-MP word totals — the ranking input (see the module docstring)."""
        totals: dict[str, int] = {}
        for speech in self.speeches:
            if speech.speaker.id:
                totals[speech.speaker.id] = totals.get(speech.speaker.id, 0) + speech.word_count
        return totals
