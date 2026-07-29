"""MP identity resolution — the layer §7 calls the central architectural finding.

The Bundestag publishes one MP under three mutually incompatible identifiers,
and two of the four sources carry none at all:

| Source | Identifier | Steffen Bilger |
| --- | --- | --- |
| DIP `/person` | short numeric | `1013` |
| MdB-Stammdaten `<MDB><ID>` | 8-digit | `11004011` |
| Protocol XML `<redner id>` | 8-digit | `11004011` (= Stammdaten) |
| Named-vote XLSX | **none** | — |

`GET /person/11004011` is a 404, so the first two do not meet. §7.4's
recommendation is what this module implements: **mint an internal Bundestrack
id, store every external id against it, and resolve once at ingest** — never
join on names at query time.

## The internal id is derived, not allocated

`bt-11004011` — the Stammdaten id with a prefix. A counter would be a second
piece of state to keep consistent across machines, and it would renumber the
whole roster the first time a backfill ran in a different order; a derived id
is the same on every host, needs no coordination, and makes an unresolved row
readable in the database rather than opaque. The prefix is what stops it being
mistaken for the bare Stammdaten id it is built from — they are different id
spaces and `mps.stammdatenId` stores the other one.

Stammdaten is the base because it is the roster (§6.1: DIP `/person` returns
803 records for 630 seats) and because it is the id space the protocol XML
already speaks.

## What can and cannot be resolved

- **Speeches → roster:** `<redner id>` *is* the Stammdaten id. Direct. ✅
- **Activities → DIP person:** `person_id` is carried on the record. ✅ — but
  it lands in DIP's id space, so it still needs the crosswalk below.
- **DIP person ↔ Stammdaten:** no shared key. Folded-name matching, 99.1 %
  (§7.2).
- **Vote rows → roster:** no id column at all. Name matching, 628/630 (§7.1).

The two name joins are asymmetric and are deliberately not merged. Matching a
*vote sheet* row consumes a surname already split from its particle and an
Ortszusatz already parenthesised, which is what `NameIndex` was built for
(models/stammdaten.py). Matching a *DIP person* consumes a `(vorname,
nachname)` pair from a source that normalises diacritics differently. Folding
is shared; the key construction is not.

## Unmatched rows are quarantined, never dropped

§7.3: the Stammdaten dump lags reality — an MP recorded with WP20 only while
sitting in WP21, two MPs in a July 2026 ballot missing outright. A dropped vote
row is a vote that silently never happened, and it never comes back because the
next sync drops it identically. `Quarantine` holds those rows with what was
seen and why, so a later sync — when the dump has caught up — retries them.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from pydantic import BaseModel, Field

from bundestrack.models.dip import Person
from bundestrack.models.enrichment import MPEnrichment
from bundestrack.models.stammdaten import (
    MP,
    NameIndex,
    StammdatenDump,
    fold_name,
)
from bundestrack.models.votes import VoteRecord

logger = logging.getLogger(__name__)

#: Prefix on every minted id. See the module docstring: it marks the value as
#: Bundestrack's own rather than the Stammdaten id it is derived from.
INTERNAL_ID_PREFIX = "bt-"


def internal_id(stammdaten_id: str) -> str:
    """The Bundestrack id for an MP, derived from their Stammdaten id.

    Pure and total, so the pipeline can mint an id for a batch offline and post
    it in one request — which is why `mps.internalId` is a string rather than a
    `v.id("mps")` (webapp/convex/schema.ts).
    """
    return f"{INTERNAL_ID_PREFIX}{stammdaten_id}"


def stammdaten_id_of(internal: str) -> str:
    """The inverse of `internal_id`. Tolerates an unprefixed value."""
    return internal.removeprefix(INTERNAL_ID_PREFIX)


class QuarantinedName(BaseModel):
    """A name that could not be resolved to an MP, kept for a later retry.

    Carries the printed name rather than a reference to the row it came from:
    the point is that the *roster* is what is missing, so the record is only
    re-resolvable once the roster changes, and by then the source row will have
    been re-fetched anyway.
    """

    #: Where the name was printed — `vote-sheet`, `dip-person`, `speech`.
    source: str
    nachname: str
    vorname: str = ""
    #: The vote sheet's `Titel` column — a name particle, not an academic title.
    particle: str | None = None
    wahlperiode: int
    #: Free-text context: the ballot key, the DIP person id, the sitting.
    context: str | None = None
    #: `unmatched` or `ambiguous`. An ambiguous name is a different problem —
    #: the roster has the MP twice over, not zero times — and needs a
    #: tie-breaker rather than a fresher dump.
    reason: str = "unmatched"
    #: Populated for `ambiguous`, so a human can see which MPs collided.
    candidates: list[str] = Field(default_factory=list)

    @property
    def key(self) -> tuple[str, str, str, int]:
        """What makes two quarantine entries the same entry."""
        return (self.source, fold_name(self.nachname), fold_name(self.vorname), self.wahlperiode)


class Quarantine(BaseModel):
    """Names awaiting a roster that contains them (§7.3).

    Deduplicated on `key`, because the same MP missing from the dump produces
    one entry per ballot they were listed in, and a quarantine that grows by
    630 rows a sitting is one nobody reads.
    """

    entries: list[QuarantinedName] = Field(default_factory=list)

    def add(self, entry: QuarantinedName) -> None:
        if any(existing.key == entry.key for existing in self.entries):
            return
        self.entries.append(entry)

    def for_source(self, source: str) -> list[QuarantinedName]:
        return [entry for entry in self.entries if entry.source == source]

    def clear_resolved(self, resolver: MPResolver) -> list[QuarantinedName]:
        """Drop entries the current roster can now resolve, and report them.

        Called at the start of a sync, after the roster has been re-read: an
        entry that resolves now was a staleness artefact and the row behind it
        will be re-posted by this run. Returning the cleared entries rather
        than only removing them lets the caller log what the fresher dump
        fixed, which is the evidence that quarantining was worth doing.
        """
        resolved: list[QuarantinedName] = []
        remaining: list[QuarantinedName] = []
        for entry in self.entries:
            match = resolver.resolve_printed_name(
                entry.nachname, entry.vorname, entry.particle, entry.wahlperiode
            )
            (resolved if match else remaining).append(entry)
        self.entries = remaining
        return resolved

    def __len__(self) -> int:
        return len(self.entries)


class MPResolver:
    """The crosswalk: every external id space onto one internal id.

    Built once per run from the Stammdaten dump, then fed DIP persons to learn
    the second id space. Everything downstream asks *this* for an MP's internal
    id — no transform matches names itself, so the 628/630 algorithm has one
    implementation and one place to improve.

    ⚠ Scoped to one Wahlperiode. Name keys are unique within WP21 (0 ambiguous)
    but not across the corpus (15 ambiguous, e.g. three `('muller', 'karl')`)
    — §7.2. `NameIndex` handles the scoping, including the deliberate unscoped
    fallback that recovers an MP the snapshot has not caught up with.
    """

    def __init__(
        self,
        dump: StammdatenDump,
        wahlperiode: int,
        *,
        quarantine: Quarantine | None = None,
    ) -> None:
        self.wahlperiode = wahlperiode
        self.dump = dump
        self.quarantine = quarantine if quarantine is not None else Quarantine()
        self._names = NameIndex(dump, wahlperiode=wahlperiode)
        self._by_stammdaten_id = {mp.id: mp for mp in dump.mps}
        #: DIP person id → internal id. Populated by `link_dip_persons`.
        self._dip_to_internal: dict[str, str] = {}
        #: internal id → DIP person id, the direction the roster upsert writes.
        self._internal_to_dip: dict[str, str] = {}
        #: internal id → portraits, occupation and contact details. Populated by
        #: `attach_enrichment`, read by `transform.mp_payload`. Held here, beside
        #: the DIP crosswalk, for the same reason: the roster upsert is the one
        #: write that carries these fields, so they have to be available at the
        #: moment it builds its payload.
        self._enrichment: dict[str, MPEnrichment] = {}
        # Folded `(nachname, vorname)` → Stammdaten id, for the DIP direction.
        # A second index rather than a reuse of `NameIndex`: DIP supplies a
        # plain name pair with no particle column and no parenthesised
        # Ortszusatz, so the surname *variants* that make the vote-sheet join
        # work would only add ways for the wrong MP to match here.
        self._dip_name_index = _build_person_name_index(dump.for_wahlperiode(wahlperiode))

    # -- the roster --------------------------------------------------------

    def roster(self) -> list[MP]:
        """Every MP with a mandate in this Wahlperiode."""
        return self.dump.for_wahlperiode(self.wahlperiode)

    def mp(self, stammdaten_id: str) -> MP | None:
        return self._by_stammdaten_id.get(stammdaten_id)

    def internal_ids(self) -> set[str]:
        """Every internal id this roster can vouch for.

        The membership test the load stage uses before posting a row: the
        Convex ingestion mutations reject a record naming an MP who is not on
        the roster (`requireMandate` in webapp/convex/mps.ts), and a rejected
        batch fails the whole request rather than the one row.
        """
        return {internal_id(mp.id) for mp in self.roster()}

    # -- id-space joins ----------------------------------------------------

    def from_stammdaten_id(self, stammdaten_id: str | None) -> str | None:
        """The internal id for a Stammdaten id — the protocol XML's join (§5.2).

        Returns None for an id absent from the roster rather than minting one
        blindly: a `<redner id>` that no MP holds is a speech attributed to
        nobody, and inventing an internal id for it would create a row that
        every Convex mutation then rejects.
        """
        if not stammdaten_id:
            return None
        mp = self._by_stammdaten_id.get(stammdaten_id)
        if mp is None:
            return None
        return internal_id(mp.id)

    def from_dip_person_id(self, dip_person_id: str | None) -> str | None:
        """The internal id for a DIP person id — the `/aktivitaet` join (§3.5).

        Populated by `link_dip_persons`, so a resolver that has not been fed
        DIP persons answers None for everything here. That is the honest
        answer: without the crosswalk there is no route from DIP's id space to
        the roster, and §11.1 puts `/person` second in the backfill for exactly
        this reason.
        """
        if not dip_person_id:
            return None
        return self._dip_to_internal.get(dip_person_id)

    def dip_person_id_for(self, internal: str) -> str | None:
        """The DIP person id resolved onto an internal id, if one was."""
        return self._internal_to_dip.get(internal)

    # -- enrichment --------------------------------------------------------

    def attach_enrichment(self, enrichment: Iterable[MPEnrichment]) -> int:
        """Record portraits, occupation and contact details against the roster.

        Held on the resolver rather than posted directly, because the roster
        upsert is what writes these columns and it builds its payload from here
        (`transform.mp_payload`). Posting them separately would work exactly
        once: `link_dip_persons` re-posts the whole roster to patch in the DIP
        crosswalk, and every later sync posts it again, so a separately-written
        `photoUrl` would be nulled by the next roster write.

        Merged rather than replaced, one field at a time. The two sources
        arrive at different rates — portraits every sync from the listing,
        contact details only when stale (`api.mp_profiles`) — so a run that
        refreshed only the portraits must not blank the contact block it did
        not fetch.

        Returns how many MPs are now enriched, which is the number the stage
        reports against the roster size.
        """
        for entry in enrichment:
            existing = self._enrichment.get(entry.internal_id)
            if existing is None:
                self._enrichment[entry.internal_id] = entry
                continue
            self._enrichment[entry.internal_id] = MPEnrichment(
                internal_id=entry.internal_id,
                portrait=entry.portrait or existing.portrait,
                occupation=entry.occupation or existing.occupation,
                education=entry.education or existing.education,
                contact=entry.contact or existing.contact,
            )
        return len(self._enrichment)

    def enrichment_for(self, internal: str) -> MPEnrichment | None:
        """What is known about an MP beyond the roster, if anything is."""
        return self._enrichment.get(internal)

    def unenriched_internal_ids(self) -> set[str]:
        """Roster MPs with no enrichment at all.

        The counterpart of `unlinked_internal_ids`: a visible gap rather than a
        silent one. Non-empty means the name join failed for those MPs, which
        §7.3 says to retry on a later sync rather than treat as settled.
        """
        return self.internal_ids() - set(self._enrichment)

    # -- name joins --------------------------------------------------------

    def resolve_printed_name(
        self,
        nachname: str,
        vorname: str,
        particle: str | None = None,
        wahlperiode: int | None = None,
    ) -> str | None:
        """A printed name → an internal id, or None (§7.1).

        The vote sheets' join, and the one measured at 628/630. `particle` is
        the sheet's `Titel` column, which holds `von`/`van`/`Frhr. von` rather
        than academic titles (§4.1).

        None covers *ambiguous* as well as *unmatched*, because a wrong MP is
        worse than a gap: it files a real vote under someone who did not cast
        it, and nothing downstream can detect that.
        """
        period = self.wahlperiode if wahlperiode is None else wahlperiode
        if period != self.wahlperiode:
            # The index is built for one period and its unscoped fallback is
            # what recovers a stale record. Answering for a different period
            # would silently use the wrong scope.
            return None
        match = self._names.resolve(nachname, vorname, particle)
        if match.id is None:
            return None
        if match.stale:
            # The MP exists but this mandate is not in the snapshot (§7.3,
            # Michael Breilmann). Still the right human, so it resolves — and
            # is logged, because it means the dump is behind.
            logger.info(
                "Resolved %s %s from outside WP%d — the Stammdaten snapshot is stale (§7.3)",
                vorname,
                nachname,
                self.wahlperiode,
            )
        return internal_id(match.id)

    def resolve_vote_record(self, record: VoteRecord) -> str | None:
        """One vote-sheet row → an internal id, quarantining a miss.

        The one call site that both resolves and quarantines, because it is the
        one where a failure destroys information: the sheet is the only source
        that records absences (§4.2), so a dropped row cannot be recovered from
        anywhere else.
        """
        internal = self.resolve_printed_name(record.name, record.vorname, record.titel)
        if internal is not None:
            return internal
        candidates = self._names.candidates(record.name, record.vorname, record.titel)
        self.quarantine.add(
            QuarantinedName(
                source="vote-sheet",
                nachname=record.name,
                vorname=record.vorname,
                particle=record.titel,
                wahlperiode=record.wahlperiode,
                context=(
                    f"WP{record.wahlperiode} sitting {record.sitzungnr} ballot {record.abstimmnr}"
                ),
                reason="ambiguous" if candidates else "unmatched",
                candidates=sorted(candidates),
            )
        )
        return None

    def resolve_listed_name(
        self, nachname: str, vorname: str, particle: str | None = None, context: str | None = None
    ) -> str | None:
        """One bundestag.de listing entry → an internal id, quarantining a miss.

        The enrichment join, and the third call site that both resolves and
        quarantines — alongside `resolve_vote_record` and `resolve_speaker_id`,
        and for the same reason each of those does. The listing is the
        Bundestag's **own** roster of the sitting chamber, so a name in it that
        resolves to nobody is not a stray: it is a member the Stammdaten
        snapshot has not caught up with (§7.3), and the next dump is what fixes
        it. Logging that and moving on left those MPs permanently unenriched,
        because nothing re-examined them once the dump caught up — the stage
        note claimed the quarantine retried them and no code put them there.

        Quarantined under `mp-listing` rather than folded into `vote-sheet`:
        the two carry different consequences. A missing vote row is a lost
        ballot; a missing listing entry is a missing portrait, which the UI
        already degrades for. Keeping them apart lets `for_source` answer
        either question, and stops an enrichment gap inflating the count that
        signals a vote was dropped.
        """
        internal = self.resolve_printed_name(nachname, vorname, particle)
        if internal is not None:
            return internal
        candidates = self._names.candidates(nachname, vorname, particle)
        self.quarantine.add(
            QuarantinedName(
                source="mp-listing",
                nachname=nachname,
                vorname=vorname,
                particle=particle,
                wahlperiode=self.wahlperiode,
                context=context,
                reason="ambiguous" if candidates else "unmatched",
                candidates=sorted(candidates),
            )
        )
        return None

    def link_dip_persons(self, persons: Iterable[Person]) -> DIPLinkReport:
        """Match DIP person records onto the roster by folded name (§7.2).

        Measured at 99.1 % against WP21, where exact matching scores 98.6 % —
        the difference is entirely diacritics, because the two *official*
        sources disagree at character level (`Özoguz` vs `Özoğuz`).

        `wahlkreiszusatz` is the tie-breaker §7.2 recommends: it is the same
        disambiguator as Stammdaten's `ORTSZUSATZ`, differing only in whether
        the parentheses are printed. It is consulted only for a collision,
        which within one Wahlperiode should not happen at all.

        ⚠ DIP `/person` is not a roster and is not treated as one — a person
        who matches nobody is normal here (803 records against 630 seats, §6.1)
        and is *not* quarantined. Quarantine is for a roster that is missing
        someone; this is the reverse.
        """
        report = DIPLinkReport()
        for person in persons:
            if not _serves_in(person, self.wahlperiode):
                report.out_of_period += 1
                continue
            candidates = self._dip_name_index.get(
                (fold_name(person.nachname), fold_name(person.vorname)), set()
            )
            resolved = _disambiguate(candidates, person, self._by_stammdaten_id)
            if resolved is None:
                if candidates:
                    report.ambiguous += 1
                    logger.debug(
                        "DIP person %s (%s %s) matches %d roster entries — skipped",
                        person.id,
                        person.vorname,
                        person.nachname,
                        len(candidates),
                    )
                else:
                    report.unmatched += 1
                continue

            internal = internal_id(resolved)
            existing = self._internal_to_dip.get(internal)
            if existing is not None and existing != person.id:
                # Two DIP records claiming the same human. §6.1 shows why this
                # is possible — a minister has both an MdB record and a
                # government one — and the first wins rather than the last, so
                # a re-run does not silently reassign the id.
                report.duplicate += 1
                logger.debug(
                    "DIP persons %s and %s both resolve to %s — keeping %s",
                    existing,
                    person.id,
                    internal,
                    existing,
                )
                continue

            self._dip_to_internal[person.id] = internal
            self._internal_to_dip[internal] = person.id
            report.linked += 1
        return report

    def resolve_speaker_id(self, speaker_id: str | None, context: str | None = None) -> str | None:
        """A protocol `<redner id>` → an internal id, quarantining a miss.

        The easy join (§7.2: 192/192 verified), so a miss here means the same
        staleness the vote sheets hit — an id in the protocol that the dump has
        not caught up with — and belongs in the same quarantine.
        """
        internal = self.from_stammdaten_id(speaker_id)
        if internal is not None or not speaker_id:
            return internal
        self.quarantine.add(
            QuarantinedName(
                source="speech",
                nachname=speaker_id,
                wahlperiode=self.wahlperiode,
                context=context,
                reason="unmatched",
            )
        )
        return None

    def unlinked_internal_ids(self) -> list[str]:
        """Roster MPs with no DIP person id — §7.3's retry list.

        An unresolved id means that MP's DIP activities are attached to nobody,
        which is a visible gap rather than a silent one: `listUnlinkedMPs` in
        webapp/convex/mps.ts reads the same set from the other side.
        """
        return sorted(self.internal_ids() - set(self._internal_to_dip))


class DIPLinkReport(BaseModel):
    """What one `link_dip_persons` pass achieved.

    Reported rather than logged only, because the numbers are the health check
    §7.2 measured: a linked count far below the roster size means the fold or
    the scope broke, and that is invisible in a run that otherwise succeeds.
    """

    linked: int = 0
    unmatched: int = 0
    ambiguous: int = 0
    duplicate: int = 0
    #: DIP persons with no mandate in the requested period — the majority, and
    #: not a failure (§6.1).
    out_of_period: int = 0

    def summary(self) -> str:
        return (
            f"{self.linked} linked, {self.unmatched} unmatched, "
            f"{self.ambiguous} ambiguous, {self.duplicate} duplicate, "
            f"{self.out_of_period} outside the period"
        )


def _serves_in(person: Person, wahlperiode: int) -> bool:
    """Whether a DIP person is plausibly an MP in this period.

    Deliberately permissive: `funktion == "MdB"` both over- and under-counts
    (§6.1 — it excludes the 57 sitting MPs who hold a ministry), so this filters
    only on the period. The roster decides who is an MP; this decides who is
    worth *attempting* to match, and attempting one too many costs a dictionary
    lookup.
    """
    return not person.wahlperiode or wahlperiode in person.wahlperiode


def _build_person_name_index(population: list[MP]) -> dict[tuple[str, str], set[str]]:
    """Folded `(nachname, vorname)` → Stammdaten ids, over all historical names.

    All names, not just the current one: 267 MPs have more than one (§6.2), and
    DIP may still be publishing a former one.
    """
    index: dict[tuple[str, str], set[str]] = {}
    for mp in population:
        for name in mp.names:
            # The forename varies here as it does in `NameIndex`, and for the
            # same reason: Stammdaten stores `Philip M. A.` where DIP may print
            # `Philip`. The *surname* deliberately does not — see the field
            # comment on `_dip_name_index` for why this index is narrower.
            for forename in name.forename_variants():
                key = (fold_name(name.nachname), fold_name(forename))
                index.setdefault(key, set()).add(mp.id)
    return index


def _disambiguate(
    candidates: set[str],
    person: Person,
    by_id: dict[str, MP],
) -> str | None:
    """Pick one Stammdaten id out of a name collision, or None.

    §7.2's tie-breaker: Stammdaten `ORTSZUSATZ` and DIP `wahlkreiszusatz` are
    the same disambiguator, printed with and without parentheses respectively.
    Within one Wahlperiode there are no collisions at all, so this is the belt
    to that observation's braces.
    """
    if len(candidates) == 1:
        return next(iter(candidates))
    if not candidates or not person.wahlkreiszusatz:
        return None
    wanted = fold_name(person.wahlkreiszusatz.strip("()"))
    matches = {
        candidate
        for candidate in candidates
        if any(
            name.ortszusatz and fold_name(name.ortszusatz.strip("()")) == wanted
            for name in by_id[candidate].names
        )
    }
    return next(iter(matches)) if len(matches) == 1 else None
