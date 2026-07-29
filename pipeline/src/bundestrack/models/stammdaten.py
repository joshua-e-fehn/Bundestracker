"""Models for MdB-Stammdaten — the authoritative MP roster.

`/person` is not a roster: it returns 803 records for a 630-seat chamber and
`funktion == "MdB"` both over- and under-counts (docs/api-research.md §6.1).
Stammdaten is. Its 635 WP21 mandate rows reconcile to exactly the 630 statutory
seats once departures and late replacements are taken out via
`MDBWP_VON`/`MDBWP_BIS` (§6.2) — arithmetic re-verified here at 635 rows from
4 614 total MDB records.

It is also where the ID join lives: `<MDB><ID>` is the 8-digit id that the
plenary protocol's `<redner id>` uses, so speeches join to MPs by id and need no
name matching (§7). The DIP person id is a *different* id for the same human —
`GET /person/11004011` is a 404 — so that direction does need names, which is
what `NameIndex` is for.

Two structural traps this module exists to absorb:

- **A committee chair is listed twice** — once as `Vorsitzender`, once as
  `Ordentliches Mitglied` (§6.3, reproduced here on Laschet and von Stetten).
  Deduplicate on `(committee, start date)` or every chair counts as two seats.
- **Committee data covers the current Wahlperiode only.** WP1–20 carry
  `Fraktion/Gruppe` entries and nothing else, by design (§6.4). A committee
  metric is therefore computable for WP21 and no earlier period.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: `INSART_LANG` values seen across the whole dump (§6.3).
InstitutionKind = Literal[
    "Fraktion/Gruppe",
    "Ausschuss",
    "Sonstiges Gremium",
    "Unterausschuss",
    "Deutscher Bundestag",
    "Parlamentariergruppen",
    "Ministerium",
    "Enquete-Kommission",
]

#: Committee-like institution kinds — what a "committee work" metric should
#: count. `Parlamentariergruppen` is excluded deliberately: those entries record
#: leadership only, never full membership, so counting them as seats would
#: credit a handful of chairs and no members at all (§6.3).
COMMITTEE_KINDS = frozenset({"Ausschuss", "Unterausschuss", "Enquete-Kommission"})

#: `FKT_LANG` values meaning a full seat rather than a substitute one. The
#: source separates these cleanly, which is what lets scoring avoid crediting a
#: `Stellvertretendes Mitglied` as much as a full member (§6.3).
FULL_MEMBER_ROLES = frozenset(
    {
        "Ordentliches Mitglied",
        "Vorsitzender",
        "Vorsitzende",
        "Stellvertretender Vorsitzender",
        "Stellvertretende Vorsitzende",
        "Obmann",
        "Obfrau",
    }
)


#: Middle initials trailing a forename — the `M. A.` of `Philip M. A.`.
#:
#: ⚠ **Both the anchor and the period are load-bearing**, for the reason
#: `models.enrichment.ACADEMIC_TITLE` states in capitals about its own pattern.
#: Unanchored, this matches the `A.` beginning `A. Beatrix` and truncates the
#: forename to nothing; without the required period it matches the `Maria` of
#: `Anna Maria` and silently merges two distinct given names. Anchored and
#: period-bound, it matches exactly what the Bundestag prints as an initial.
TRAILING_INITIALS = re.compile(r"(?:\s+[A-Za-zÄÖÜäöüß]\.)+$")


def parse_german_date(value: str | None) -> date | None:
    """`TT.MM.JJJJ` → `date`. Empty means absent, not malformed.

    Every Stammdaten element is always emitted, empty when unset — absence is
    `<TAG/>`, never a missing node (§6.2) — so "" is the normal way this source
    says "no value" and must not raise.
    """
    if not value or not value.strip():
        return None
    day, month, year = value.strip().split(".")
    return date(int(year), int(month), int(day))


def fold_name(value: str | None) -> str:
    """Normalise a name for matching (§7.2).

    NFD → drop combining marks → `ß`→`ss` → casefold. This is what lifts the
    DIP↔Stammdaten match rate from 98.6 % to 99.1 %, because the two official
    sources disagree at character level: DIP has `Özoguz`, `Salihovic`,
    `Ahmetovic` where Stammdaten has `Özoğuz`, `Salihović`, `Ahmetović` (§6.1).

    `ß`→`ss` runs before decomposition because `ß` has no combining form —
    NFD leaves it alone and it would survive as itself, so `Strauß` and
    `Strauss` would not fold together.
    """
    if not value:
        return ""
    folded = value.strip().casefold().replace("ß", "ss")
    decomposed = unicodedata.normalize("NFD", folded)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


class MPName(BaseModel):
    """One name an MP has held, with its validity window.

    267 MDBs have more than one — marriage, a forename change, an acquired
    doctorate (§6.2). The **current** name is the one with an empty
    `historie_bis`, but *all* of them must be indexed for joining, or a vote
    sheet printed under a former name will not match.
    """

    model_config = ConfigDict(frozen=True)

    nachname: str
    vorname: str
    #: ⚠ **Already includes its parentheses** — `(Fulda)`, not `Fulda`. Building
    #: `f"{nachname} ({ortszusatz})"` double-wraps it, which is one of the two
    #: causes of the 21/630 naive-join failures in §7.1. Concatenate plainly.
    ortszusatz: str | None = None
    #: `Freiherr`, `Graf`, `Frhr.` — nobiliary particle.
    adel: str | None = None
    #: `von`, `van` — name prefix. The vote sheets file this under a column
    #: headed `Titel`, and a sheet may print `adel` and `praefix` together
    #: (`Frhr. von Stetten`), so both spellings are indexed.
    praefix: str | None = None
    anrede_titel: str | None = None
    akad_titel: str | None = None
    historie_von: date | None = None
    historie_bis: date | None = None

    @property
    def is_current(self) -> bool:
        return self.historie_bis is None

    @property
    def display_name(self) -> str:
        """`Christian Frhr. von Stetten (Fulda)`-style full name."""
        parts = [self.vorname, self.adel, self.praefix, self.nachname, self.ortszusatz]
        return " ".join(p for p in parts if p)

    def surname_variants(self) -> set[str]:
        """Every spelling of the surname a join might have to match (§7.1).

        The bare surname, each particle prepended, and each of those with the
        Ortszusatz appended. This set is what takes the naive join from 609/630
        to 628/630 — the two residual misses are MPs missing from the dump
        entirely, not matching failures (§7.1, §7.3).
        """
        bases = {self.nachname}
        for particle in (self.praefix, self.adel):
            if particle:
                bases.add(f"{particle} {self.nachname}".strip())
        if self.adel and self.praefix:
            bases.add(f"{self.adel} {self.praefix} {self.nachname}".strip())
        if not self.ortszusatz:
            return bases
        # `ortszusatz` already carries its parentheses — see the field comment.
        return bases | {f"{base} {self.ortszusatz}".strip() for base in bases}

    def forename_variants(self) -> set[str]:
        """Every spelling of the forename a join might have to match.

        The forename as stored, plus — when it ends in initials — the same
        string with them dropped. Stammdaten writes `Philip M. A.` where a
        source that prints only the first given name writes `Philip`, and the
        two are the same human.

        The initials are stripped from the *stored* side rather than from the
        printed one, which is the direction that keeps the strict spelling
        working: both keys are indexed, so `Philip M. A.` and `Philip` each
        resolve, where normalising the query alone would break the source that
        does print them in full.

        Anchored at the end and requiring the period, for the reason
        `models.enrichment.ACADEMIC_TITLE` carries in capitals: an unanchored
        single-letter rule eats the `A` of `A. Beatrix`, and a rule not
        requiring the period truncates `Anna Maria` to `Anna`. Measured across
        WP18–21: 2 WP21 forenames end in initials, and indexing both spellings
        adds **no** ambiguous key in any of the four periods.
        """
        reduced = TRAILING_INITIALS.sub("", self.vorname).strip()
        return {self.vorname} if not reduced or reduced == self.vorname else {self.vorname, reduced}


class CommitteeMembership(BaseModel):
    """One `<INSTITUTION>` entry — a seat, a group, or an office.

    `MDBINS_*` dates the membership and `FKTINS_*` dates the role within it, and
    the two genuinely differ: an MP can join a committee on one date and become
    its deputy chair later. Both are day-level, which is finer than anything DIP
    offers (§6.3).
    """

    model_config = ConfigDict(frozen=True)

    kind: str  # INSART_LANG
    name: str  # INS_LANG
    role: str | None = None  # FKT_LANG
    start_date: date | None = None
    end_date: date | None = None
    role_start_date: date | None = None
    role_end_date: date | None = None

    @property
    def is_committee(self) -> bool:
        return self.kind in COMMITTEE_KINDS

    @property
    def is_full_member(self) -> bool:
        """A full seat rather than a substitute one. Empty role counts as full.

        109 entries have no `FKT_LANG` at all (§6.3); treating those as
        substitutes would under-credit real seats, so the unmarked case follows
        the majority reading.
        """
        return self.role is None or self.role in FULL_MEMBER_ROLES

    @property
    def dedup_key(self) -> tuple[str, date | None]:
        """`(committee, start date)` — what stops a chair counting twice (§6.3)."""
        return (self.name, self.start_date)


class Mandate(BaseModel):
    """One MP's membership in one Wahlperiode.

    ⚠ `wkr_land` and `liste` codes are **not stable across time**: historical
    periods use `BWG`/`NDS`/`NRW`, modern ones the ISO-style `BW`/`NI`/`NW`
    (§6.2). `liste` also uses `*`, `**` and `***` for the Saarland accession,
    West Berlin and Volkskammer election. Anything mapping these must scope the
    mapping to a period.
    """

    wahlperiode: int
    start_date: date | None = None
    end_date: date | None = None
    wkr_nummer: int | None = None
    wkr_name: str | None = None
    wkr_land: str | None = None
    liste: str | None = None
    #: `Direktwahl` or `Landesliste` (or `Volkskammer`, historically).
    mandatsart: str | None = None
    institutions: list[CommitteeMembership] = Field(default_factory=list)

    @property
    def is_direct(self) -> bool:
        return self.mandatsart == "Direktwahl"

    def committees(self) -> list[CommitteeMembership]:
        """Committee seats, deduplicated so a chair counts once (§6.3)."""
        seen: set[tuple[str, date | None]] = set()
        result: list[CommitteeMembership] = []
        # Sorted so the surviving entry is deterministic: a chair listed as both
        # `Vorsitzender` and `Ordentliches Mitglied` should always keep the same
        # one, or re-ingesting the same dump would rewrite the role each time.
        for membership in sorted(
            (i for i in self.institutions if i.is_committee),
            key=lambda i: (i.name, i.role or ""),
        ):
            if membership.dedup_key in seen:
                continue
            seen.add(membership.dedup_key)
            result.append(membership)
        return result

    def fraktion(self) -> str | None:
        """The parliamentary group, in Stammdaten's long form.

        ⚠ Long form (`Fraktion der Christlich Demokratischen Union/Christlich -
        Sozialen Union`) where the vote sheets and DIP both use `CDU/CSU` — the
        pipeline needs an explicit mapping (§6.4).

        Returns the *latest-starting* entry: six WP21 MPs have more than one
        because they switched or left a group mid-period, and affiliation is
        properly date-ranged rather than scalar (§6.4).
        """
        groups = [i for i in self.institutions if i.kind == "Fraktion/Gruppe"]
        if not groups:
            return None
        return max(groups, key=lambda i: i.start_date or date.min).name

    def was_serving_on(self, when: date) -> bool:
        """Whether this mandate was active on a date.

        The operation §6.2 uses to rebuild the roster for any past day, and the
        reason an open `end_date` must stay distinguishable from a set one.
        """
        if self.start_date and when < self.start_date:
            return False
        return not (self.end_date and when > self.end_date)


class MP(BaseModel):
    """One `<MDB>` record — a human, across every period they served.

    `id` is the 8-digit Stammdaten id, which is also the protocol XML's
    `<redner id>` (§5.2, 192/192 verified). It is **not** a DIP person id.
    """

    id: str
    names: list[MPName] = Field(default_factory=list)
    mandates: list[Mandate] = Field(default_factory=list)
    geburtsdatum: date | None = None
    geburtsort: str | None = None
    geburtsland: str | None = None
    sterbedatum: date | None = None
    geschlecht: str | None = None
    familienstand: str | None = None
    #: ⚠ 24 uncontrolled values, not an enum — `katholisch` and
    #: `römisch-katholisch` are separate entries (§6.2).
    religion: str | None = None
    beruf: str | None = None
    partei_kurz: str | None = None
    vita_kurz: str | None = None

    @property
    def current_name(self) -> MPName | None:
        """The name in force now — the one with an open `historie_bis` (§6.2)."""
        for name in self.names:
            if name.is_current:
                return name
        return self.names[-1] if self.names else None

    def mandate_for(self, wahlperiode: int) -> Mandate | None:
        for mandate in self.mandates:
            if mandate.wahlperiode == wahlperiode:
                return mandate
        return None

    def served_in(self, wahlperiode: int) -> bool:
        return self.mandate_for(wahlperiode) is not None


class StammdatenDump(BaseModel):
    """A parsed MdB-Stammdaten dump.

    `version` is a Unix timestamp (observed `1777449783`) and is the cheapest
    change detector there is: compare it before re-parsing 15 MB of XML (§6.2).
    """

    version: str | None = None
    mps: list[MP] = Field(default_factory=list)

    def for_wahlperiode(self, wahlperiode: int) -> list[MP]:
        return [mp for mp in self.mps if mp.served_in(wahlperiode)]

    def roster_on(self, when: date, wahlperiode: int) -> list[MP]:
        """The MPs actually serving on a given date (§6.2).

        This is what reconciles 635 mandate rows to the 630 statutory seats:
        five MPs departed mid-period and five replacements joined after the
        period began.
        """
        result = []
        for mp in self.mps:
            mandate = mp.mandate_for(wahlperiode)
            if mandate and mandate.was_serving_on(when):
                result.append(mp)
        return result

    def wahlperiode_window(self, wahlperiode: int) -> tuple[date | None, date | None]:
        """When a Wahlperiode ran, derived from its mandate dates.

        Read off the roster rather than hardcoded, because a table of election
        dates would be a second source of truth for something this dump already
        states — and one that a period Bundestrack has not met yet would not be
        in.

        The bounds come from the *extremes* of the mandates: the earliest start
        is the constitutive sitting, and the latest end is the dissolution.
        Replacements who joined late and members who left early sit strictly
        inside that, so they cannot narrow it.

        An **open** upper bound means the period has not ended — any mandate
        with no `MDBWP_BIS` is someone still serving. Returned as None rather
        than as today's date, so a caller filtering on it does not silently
        exclude a record dated tomorrow.
        """
        mandates = [m for mp in self.mps if (m := mp.mandate_for(wahlperiode))]
        if not mandates:
            return (None, None)
        starts = [m.start_date for m in mandates if m.start_date]
        if any(m.end_date is None for m in mandates):
            return (min(starts) if starts else None, None)
        ends = [m.end_date for m in mandates if m.end_date]
        return (min(starts) if starts else None, max(ends) if ends else None)


class NameIndex:
    """Resolves a printed name to a Stammdaten id (§7.1).

    Built because two of the four sources carry no usable MP id: the vote sheets
    have **no id column at all**, and DIP's person id is a different id space
    from Stammdaten's. The algorithm here is the one measured at **628/630** on
    a real ballot, where a naive `(surname, forename)` join scored 609.

    What makes up the difference is entirely in `MPName.surname_variants`:
    indexing every historical name, every particle spelling, and the Ortszusatz
    concatenated *without* adding parentheses it already has.

    ⚠ **Always scope to one Wahlperiode.** Name keys are unique within WP21 (0
    ambiguous) but not across the corpus (15 ambiguous, e.g. three
    `('muller', 'karl')`) — §7.2.

    Scoping has one cost, and it is measurable: matching a real 630-row ballot
    scores **627/630** scoped to WP21 against 628 unscoped. The extra row is
    Michael Breilmann, whom the dump records with WP20 only although he sits in
    WP21 — the staleness §7.3 documents by name. So `lookup` falls back to the
    unscoped index and reports the hit as `stale`: a stale record is still the
    right human, and refusing it would send a sitting MP to quarantine for a
    defect in the snapshot rather than in the data.

    The remaining two (`Glaser, Stefan`; `Naser, Christoph`) are absent from the
    dump entirely, exactly as §7.1 found. Those are the rows for the quarantine.
    """

    def __init__(self, dump: StammdatenDump, wahlperiode: int | None = None) -> None:
        self.wahlperiode = wahlperiode
        self._index: dict[tuple[str, str], set[str]] = {}
        self._unscoped: dict[tuple[str, str], set[str]] = {}
        population = dump.for_wahlperiode(wahlperiode) if wahlperiode else dump.mps
        self._build(self._index, population)
        if wahlperiode:
            self._build(self._unscoped, dump.mps)

    @staticmethod
    def _build(index: dict[tuple[str, str], set[str]], population: list[MP]) -> None:
        for mp in population:
            for name in mp.names:
                # Both axes vary: the surname across particles and the
                # Ortszusatz (§7.1), the forename across trailing initials.
                # Indexing the product means a source that prints either
                # spelling resolves without the *query* being normalised, which
                # is what keeps the strict form working for sources that print
                # it in full.
                for surname in name.surname_variants():
                    for forename in name.forename_variants():
                        index.setdefault((fold_name(surname), fold_name(forename)), set()).add(
                            mp.id
                        )

    def lookup(self, nachname: str, vorname: str, particle: str | None = None) -> str | None:
        """The Stammdaten id for a printed name, or None.

        `particle` is the vote sheet's `Titel` column, which holds `von`/`van`/
        `de` rather than academic titles (§4.1) — tried as a surname prefix when
        the plain surname does not match, since the sheet splits the particle
        off and Stammdaten may not.

        Returns None on an **ambiguous** match as well as on no match. A wrong
        MP is worse than a gap: §7.3 asks for unmatched rows to be quarantined
        and retried on a later sync, which needs the ambiguity to be visible.
        """
        return self.resolve(nachname, vorname, particle).id

    def resolve(self, nachname: str, vorname: str, particle: str | None = None) -> NameMatch:
        """As `lookup`, but reporting *how* the name matched.

        Callers that persist a crosswalk want the distinction: a `stale` match
        means the roster snapshot is behind and should be re-checked on the next
        sync, where an `exact` one is settled.
        """
        candidates = self.candidates(nachname, vorname, particle)
        if len(candidates) == 1:
            return NameMatch(id=next(iter(candidates)), stale=False)
        if candidates:
            return NameMatch(id=None, stale=False, ambiguous=candidates)
        # Not in this period — try the whole corpus before giving up. See the
        # class docstring: this is what recovers an MP the snapshot has not
        # caught up with, and it is reported rather than hidden.
        wider = self._candidates_in(self._unscoped, nachname, vorname, particle)
        if len(wider) == 1:
            return NameMatch(id=next(iter(wider)), stale=True)
        return NameMatch(id=None, stale=False, ambiguous=wider)

    def candidates(self, nachname: str, vorname: str, particle: str | None = None) -> set[str]:
        """Every id a printed name could refer to, within the index's scope."""
        return self._candidates_in(self._index, nachname, vorname, particle)

    @staticmethod
    def _candidates_in(
        index: dict[tuple[str, str], set[str]],
        nachname: str,
        vorname: str,
        particle: str | None,
    ) -> set[str]:
        forename = fold_name(vorname)
        keys = [(fold_name(nachname), forename)]
        if particle:
            keys.append((fold_name(f"{particle} {nachname}"), forename))
        for key in keys:
            if key in index:
                return set(index[key])
        return set()

    def __len__(self) -> int:
        return len(self._index)


class NameMatch(BaseModel):
    """The outcome of a name lookup, with enough detail to act on a failure."""

    model_config = ConfigDict(frozen=True)

    #: The resolved Stammdaten id, or None when unmatched or ambiguous.
    id: str | None = None
    #: True when the match came from outside the requested Wahlperiode — the MP
    #: exists but the snapshot has not recorded this mandate yet (§7.3).
    stale: bool = False
    #: Populated when several MPs share the name, so the caller can log which.
    ambiguous: set[str] = Field(default_factory=set)

    @property
    def matched(self) -> bool:
        return self.id is not None
