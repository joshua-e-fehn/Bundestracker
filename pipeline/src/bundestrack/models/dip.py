"""Pydantic models for the DIP API's wire format.

Generated from the live OpenAPI spec 1.5 and then corrected against real
responses, because the spec is wrong in two ways that break a client generated
from it faithfully (docs/api-research.md §6.1, both re-verified on 2026-07-26
against `/person?f.wahlperiode=21`):

1. **Five `Person` fields typed `string` come back as arrays** — `funktion`,
   `funktionszusatz`, `fraktion`, `ressort`, `bundesland`. Always length 1 in
   all 5 623 records, but a `str` annotation rejects every one of them.
   `UnwrappedStr` below accepts either shape. Note the asymmetry the spec gets
   *right*: `wahlkreiszusatz` and `namenszusatz` really are plain strings, and
   inside `person_roles` all of these are plain strings.

2. **`PersonRole.funktion` is declared required and appears in nothing** — 0 of
   2 503 live role objects, confirmed again here at 0 of 33. It is optional.

Two smaller corrections come from the same comparison: `Plenarprotokoll`
carries an **undocumented `xml_hash`** (present on all 90 WP21 BT protocols,
§5.1) which the pipeline needs to skip unchanged XML, and eight `Person`
records omit `wahlperiode`/`datum`/`basisdatum` entirely (§6.1).

Every model sets `extra="allow"`. The DIP schema has grown fields without a
spec bump before — `xml_hash` is the proof — and a pipeline that raises on a
new one would go down on the day the Bundestag publishes more data, which is
the wrong direction to fail.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _unwrap_single(value: Any) -> Any:
    """Take the one element out of a single-element list (spec bug 1).

    A longer list keeps its first element rather than raising: the research
    measured every one of these at length 1, but a silent day-one crash is a
    poor trade for a field the pipeline can carry on without.
    """
    if isinstance(value, list):
        if not value:
            return None
        return value[0]
    return value


#: A field the spec types `string` and the API returns as `["…"]` (§6.1).
UnwrappedStr = Annotated[str | None, BeforeValidator(_unwrap_single)]


class DIPModel(BaseModel):
    """Base for every DIP entity. See the module docstring on `extra`."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


# --- shared sub-objects ---------------------------------------------------


class Fundstelle(DIPModel):
    """Where a record physically lives — the document it points at.

    `xml_url` is the field that makes speech extraction possible: it links a DIP
    protocol record straight to the structured XML, so the pipeline never has to
    reconstruct a document-server URL (§5.2). It is populated only for Bundestag
    plenary protocols, which is one of the reasons every protocol query passes
    `f.zuordnung=BT` (§5.1) — Bundesrat rows carry no XML at all.
    """

    id: str
    dokumentart: Literal["Drucksache", "Plenarprotokoll"]
    pdf_url: str | None = None
    xml_url: str | None = None
    dokumentnummer: str
    datum: date
    drucksachetyp: str | None = None
    herausgeber: str
    urheber: list[str] = Field(default_factory=list)
    verteildatum: date | None = None
    seite: str | None = None
    anfangsseite: int | None = None
    endseite: int | None = None
    anfangsquadrant: str | None = None
    endquadrant: str | None = None
    frage_nummer: str | None = None
    anlagen: str | None = None
    top: int | None = None
    top_zusatz: str | None = None


class Vorgangsbezug(DIPModel):
    """A reference to the procedure a document belongs to.

    ⚠ Capped at 4 entries by the API. The true count is in the sibling
    `vorgangsbezug_anzahl` field, never `len(vorgangsbezug)` (§3.4).
    """

    id: str
    titel: str
    vorgangstyp: str
    vorgangsposition: str | None = None


class Deskriptor(DIPModel):
    name: str
    typ: str | None = None
    fundstelle: bool | None = None


class Urheber(DIPModel):
    bezeichnung: str
    titel: str
    einbringer: bool | None = None
    rolle: str | None = None


class Ressort(DIPModel):
    federfuehrend: bool
    titel: str


class AutorAnzeige(DIPModel):
    """A displayed author, carrying a real DIP person id.

    ⚠ **Never count authorship from these.** The array is capped at 4 entries
    (§3.4), so a motion with 40 co-signatories yields 4 ids and
    `autoren_anzahl: 40`. Per-MP authorship comes from `/aktivitaet`, which
    emits one record per MP per document.
    """

    id: str | None = None
    titel: str | None = None
    autor_titel: str | None = None


class AktivitaetAnzeige(DIPModel):
    aktivitaetsart: str
    titel: str
    pdf_url: str | None = None
    seite: str | None = None


class Ueberweisung(DIPModel):
    """A committee referral: which committees a bill was sent to (§3.3).

    ⚠ **A fact about the document, not about any member.** There is no person on
    this record and no field from which one could be derived, so it cannot yield
    an individual committee metric and is not a substitute for committee
    *membership* — which §6.4 records as published for the current Wahlperiode
    alone. §3.3 names this "the committee-work signal", which overstates it; the
    work it evidences is the chamber's, not a member's.

    `federfuehrung` separates the lead committee from the co-advising ones.
    Exactly one referral per step carried it in every period sampled.

    ⚠ `ueberweisungsart` is **always null in practice** — 0 of 754 referrals
    across WP14–21 carried a value (measured 2026-07-29). It is modelled because
    the field exists in the DIP schema, not because anything can be read off it.
    """

    ausschuss: str
    ausschuss_kuerzel: str | None = None
    federfuehrung: bool | None = None
    ueberweisungsart: str | None = None


class Beschlussfassung(DIPModel):
    """The decision taken at a procedure step.

    ⚠ This says *that* a named vote happened and how it came out. It contains
    **no individual MP votes** — those exist only in the XLSX sheets, the
    protocol XML appendix, or abgeordnetenwatch (§3.2, §4). Filtering
    `abstimmungsart == NAMENTLICHE_ABSTIMMUNG` is nonetheless the right way to
    *discover* which sittings to go and fetch per-MP data for.
    """

    beschlusstenor: str
    seite: str | None = None
    abstimmungsart: str | None = None
    abstimm_ergebnis_bemerkung: str | None = None
    grundlage: str | None = None
    dokumentnummer: str | None = None
    mehrheit: str | None = None


#: The `abstimmungsart` value that marks a roll-call vote (§3.2, complete enum).
NAMENTLICHE_ABSTIMMUNG = "Namentliche Abstimmung"


class PersonRole(DIPModel):
    """A secondary role held by a person.

    `funktion` is **optional here despite the spec marking it required** — it
    appeared in 0 of 2 503 live role objects (§6.1). Infer the role kind from
    which fields are set instead: `fraktion` → parliamentary, `ressort_titel` →
    federal government, `funktionszusatz` + `bundesland` → Land government.

    There are no date fields at all; validity is a coarse list of Wahlperiode
    numbers. Day-level precision comes from Stammdaten (§6.3).
    """

    funktion: str | None = None
    funktionszusatz: str | None = None
    fraktion: str | None = None
    nachname: str
    vorname: str
    namenszusatz: str | None = None
    wahlperiode_nummer: list[int] = Field(default_factory=list)
    wahlkreiszusatz: str | None = None
    ressort_titel: str | None = None
    bundesland: str | None = None


# --- entities -------------------------------------------------------------


class Person(DIPModel):
    """A DIP person record.

    ⚠ **Not an MP roster.** WP21 returns 803 records where the Bundestag has 630
    seats, and `funktion == "MdB"` both over- and under-counts: it includes
    Bundesrat members and guests, and *excludes* the 57 sitting MPs who are also
    ministers (§6.1). The roster comes from Stammdaten; this record exists to
    supply the `id` that `/aktivitaet` joins on.

    `wahlperiode`, `datum` and `basisdatum` are optional because eight records
    omit them (§6.1). `basisdatum`/`datum` are the person's first/last related
    document — not mandate dates.
    """

    id: str
    nachname: str
    vorname: str
    typ: str
    titel: str
    aktualisiert: datetime
    namenszusatz: str | None = None
    wahlperiode: list[int] = Field(default_factory=list)
    basisdatum: date | None = None
    datum: date | None = None
    # The five spec-bug fields (§6.1). Declared `string`, returned as arrays.
    funktion: UnwrappedStr = None
    funktionszusatz: UnwrappedStr = None
    fraktion: UnwrappedStr = None
    ressort: UnwrappedStr = None
    bundesland: UnwrappedStr = None
    # …and these two, which the spec gets right.
    wahlkreiszusatz: str | None = None
    person_roles: list[PersonRole] = Field(default_factory=list)

    @property
    def is_mdb(self) -> bool:
        """Whether DIP labels this person a sitting MP.

        ⚠ Do not use this to build a roster — see the class docstring. It is
        offered because it is the right *hint* when reconciling against
        Stammdaten, not because it is authoritative. Legacy variants such as
        `MdB 13. Wahlperiode` are matched too, since they are semantically MdB
        and a bare equality check misses all nine of them (§6.1).
        """
        return bool(self.funktion) and self.funktion.startswith("MdB")


class Aktivitaet(DIPModel):
    """One MP's one action — the backbone of the activity score (§3.5).

    The only DIP endpoint that emits a record per MP per document *and* carries
    `person_id`, so it needs no name matching, unlike everything else here.

    ⚠ `titel` is the **person's name**, not a description of the action; the
    document title is in `vorgangsbezug[].titel`.

    ⚠ `aktivitaetsart` is an **open string, not an enum** — the spec declares no
    enum and publishes no value list, and the values seen in research are a
    sample of 80 537 records (§3.5). Anything that maps it must route unknown
    values somewhere visible, because silently dropping one deletes a whole
    class of parliamentary work from every MP's score.
    """

    id: str
    aktivitaetsart: str
    typ: str
    dokumentart: Literal["Drucksache", "Plenarprotokoll"]
    wahlperiode: int
    datum: date
    aktualisiert: datetime
    titel: str
    person_id: str
    fundstelle: Fundstelle | None = None
    vorgangsbezug: list[Vorgangsbezug] = Field(default_factory=list)
    vorgangsbezug_anzahl: int = 0
    deskriptor: list[Deskriptor] = Field(default_factory=list)
    abstract: str | None = None

    @property
    def is_vote_explanation(self) -> bool:
        """Whether this is an `Erklärung nach § 31 GO-BT` — a member's own
        declared reason for how they voted.

        The one authoritative, machine-linkable *reason* attached to a named
        vote: the ballot's title says what was decided, and this says why one
        member decided it that way. `person_id` and `vorgangsbezug` were present
        on 100 % of the declarations sampled, which is what makes it linkable to
        the ballot rather than merely adjacent to it.

        Matched on the *paragraph* rather than the full string because the full
        string is not what this repo thought it was. DIP returns **`Schriftliche
        Erklärung gem. § 31 Geschäftsordnung BT`**; `docs/api-research.md` §5.1
        and webapp/lib/scoring.ts both recorded `§ 31 GO BT`, which matches no
        record the API has ever returned. `§ 31` is the part fixed by the
        Geschäftsordnung itself, so it is the part worth keying on — but only
        with a boundary. A bare substring lets `§ 31a`, `§ 310` and `§ 311`
        (real Geschäftsordnung paragraphs, all different) file declarations
        into the wrong bucket, and DIP has already changed the wording of this
        activity kind once, so tightening the predicate before that happens
        again matters more than shaving a character off the regex.
        """
        return re.search(r"§\s*31(?![0-9a-zA-Z])", self.aktivitaetsart) is not None


class Vorgang(DIPModel):
    """A legislative procedure — one bill, motion or enquiry, end to end."""

    id: str
    typ: str
    vorgangstyp: str
    wahlperiode: int
    aktualisiert: datetime
    titel: str
    beratungsstand: str | None = None
    initiative: list[str] = Field(default_factory=list)
    datum: date | None = None
    abstract: str | None = None
    sachgebiet: list[str] = Field(default_factory=list)
    deskriptor: list[Deskriptor] = Field(default_factory=list)
    gesta: str | None = None
    zustimmungsbeduerftigkeit: list[str] = Field(default_factory=list)
    kom: str | None = None
    ratsdok: str | None = None
    sek: str | None = None
    verkuendung: list[dict[str, Any]] = Field(default_factory=list)
    inkrafttreten: list[dict[str, Any]] = Field(default_factory=list)
    archiv: str | None = None
    mitteilung: str | None = None
    vorgang_verlinkung: list[dict[str, Any]] = Field(default_factory=list)


class Vorgangsposition(DIPModel):
    """One step within a procedure: a reading, a referral, a vote.

    Carries the two fields the pipeline mines for structure — `ueberweisung`
    (committee referrals, §3.3) and `beschlussfassung` (decisions, including
    which ones were roll-call votes, §3.2).
    """

    id: str
    vorgangsposition: str
    zuordnung: str
    gang: bool
    fortsetzung: bool
    nachtrag: bool
    vorgangstyp: str
    typ: str
    titel: str
    dokumentart: Literal["Drucksache", "Plenarprotokoll"]
    vorgang_id: str
    datum: date
    aktualisiert: datetime
    fundstelle: Fundstelle | None = None
    urheber: list[Urheber] = Field(default_factory=list)
    ueberweisung: list[Ueberweisung] = Field(default_factory=list)
    aktivitaet_anzeige: list[AktivitaetAnzeige] = Field(default_factory=list)
    aktivitaet_anzahl: int = 0
    ressort: list[Ressort] = Field(default_factory=list)
    beschlussfassung: list[Beschlussfassung] = Field(default_factory=list)
    ratsdok: str | None = None
    kom: str | None = None
    sek: str | None = None
    mitberaten: list[Vorgangsbezug] = Field(default_factory=list)
    abstract: str | None = None

    @property
    def is_namentliche_abstimmung(self) -> bool:
        """Whether this step recorded a roll-call vote (§3.2).

        How the pipeline *discovers* which sittings have per-MP vote data worth
        fetching — the votes themselves are not in DIP.
        """
        return any(b.abstimmungsart == NAMENTLICHE_ABSTIMMUNG for b in self.beschlussfassung)


class Drucksache(DIPModel):
    """A printed paper's metadata.

    ⚠ `autoren_anzeige` is capped at 4; `autoren_anzahl` is the real total
    (§3.4). `pdf_hash` is worth persisting so an unchanged paper is not
    re-fetched — the WAF counts bytes, not just requests (§2.6).
    """

    id: str
    typ: str
    dokumentart: Literal["Drucksache"]
    drucksachetyp: str
    dokumentnummer: str
    herausgeber: str
    datum: date
    aktualisiert: datetime
    titel: str
    wahlperiode: int | None = None
    autoren_anzeige: list[AutorAnzeige] = Field(default_factory=list)
    autoren_anzahl: int = 0
    fundstelle: Fundstelle | None = None
    pdf_hash: str | None = None
    urheber: list[Urheber] = Field(default_factory=list)
    vorgangsbezug: list[Vorgangsbezug] = Field(default_factory=list)
    vorgangsbezug_anzahl: int = 0
    ressort: list[Ressort] = Field(default_factory=list)
    anlagen: str | None = None


class DrucksacheText(Drucksache):
    """A Drucksache with its full text.

    ⚠ The endpoint behind this pages at **10 documents, not 100** (§2.2), and
    the pages are large. Prefer the metadata endpoint unless the text is needed.
    """

    text: str | None = None


class Plenarprotokoll(DIPModel):
    """A plenary protocol's metadata.

    `xml_hash` is **absent from the OpenAPI spec** but returned on every
    Bundestag protocol (90/90 here, 86/86 in research, §5.1). It is the MD5 of
    the XML, so persisting it is what lets a daily sync skip re-downloading
    ~1.2 MB per unchanged sitting.
    """

    id: str
    dokumentart: Literal["Plenarprotokoll"]
    typ: str
    dokumentnummer: str
    herausgeber: str
    datum: date
    aktualisiert: datetime
    titel: str
    wahlperiode: int | None = None
    fundstelle: Fundstelle | None = None
    pdf_hash: str | None = None
    xml_hash: str | None = None  # undocumented, see the class docstring
    vorgangsbezug: list[Vorgangsbezug] = Field(default_factory=list)
    vorgangsbezug_anzahl: int = 0
    sitzungsbemerkung: str | None = None

    @property
    def sitzungsnummer(self) -> int | None:
        """The sitting number, from `dokumentnummer` (`21/90` → 90).

        Returns None rather than raising on a Bundesrat number, which is a bare
        running number with no slash and which `.split("/")` misparses into
        nonsense (§5.1). Passing `f.zuordnung=BT` avoids these entirely; this is
        the belt to that's braces.
        """
        if "/" not in self.dokumentnummer:
            return None
        _, _, tail = self.dokumentnummer.partition("/")
        return int(tail) if tail.isdigit() else None

    @property
    def xml_url(self) -> str | None:
        """The structured XML, as the API supplies it.

        Read rather than constructed on purpose: the formula in §8 reproduces
        it, but the API is the source of truth and Bundesrat rows have no XML.
        """
        return self.fundstelle.xml_url if self.fundstelle else None


class PlenarprotokollText(Plenarprotokoll):
    """A protocol with its full text.

    ⚠ **Do not use this for speech data.** `text` is one flat string for the
    entire sitting — no speaker segmentation — and regex-parsing it inflates
    word counts by +53.6 % and misses 35 speakers against the XML ground truth
    (§5.1). Speeches come from `api.protocols`.
    """

    text: str | None = None


class ListResponse(DIPModel):
    """The envelope every list endpoint returns.

    `cursor` is opaque and must not be decoded or constructed. Pagination stops
    when it stops changing — see `base.paginate_cursor` (§2.2).
    """

    # camelCase because it is the wire name; an alias would buy nothing.
    numFound: int = 0
    cursor: str | None = None
    documents: list[dict[str, Any]] = Field(default_factory=list)
