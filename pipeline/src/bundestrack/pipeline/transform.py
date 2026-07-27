"""Source models → Convex ingestion payloads.

Every function here is **pure**: models in, JSON-ready dicts out, no network and
no clock. That is what makes the traps this file encodes testable — the ones
that would otherwise only show up as a plausible wrong number in production.

Four conventions come from webapp/convex/schema.ts and are enforced at this
boundary rather than trusted downstream:

1. **Absent is `null`, never a missing key.** The Convex validators require
   every nullable field to be *present*, so a forgotten field is a 400 naming
   it rather than a row silently written without it.
2. **Dates are ISO `YYYY-MM-DD` strings**, so lexicographic order is
   chronological and an index range needs no parsing. The sources publish
   `TT.MM.JJJJ` and `datetime.date`; converting is this layer's job.
3. **MPs are referenced by the internal id**, minted in `join.py`. No payload
   here carries a Stammdaten or DIP id in an `mpInternalId` field.
4. **Fraktion is the short form.** Stammdaten spells the group out in full
   (`Fraktion der Christlich Demokratischen Union/Christlich - Sozialen
   Union`) where the vote sheets, DIP and the UI all say `CDU/CSU`; §6.4 warns
   the two vocabularies do not overlap at all, so an explicit mapping is
   required and a missing entry must be visible.

Three transforms carry a finding that is not obvious from the field names:

- **Speeches are segments, not `<rede>` elements** (§5.2). The parser already
  re-attributes on every `klasse="redner"` paragraph; this layer must not
  re-aggregate them back into one row per element.
- **Motion identity is the Vorgang, not the Drucksache** — see
  `dedupe_motions`, where a Kleine Anfrage and the government's answer would
  otherwise collapse into one row with the answer's title.
- **Authorship never comes from `autoren_anzeige`** (§3.4, capped at four). It
  comes from `/aktivitaet`, one record per MP per document.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from datetime import date
from typing import Any

from bundestrack.models.dip import Aktivitaet, Drucksache, Vorgang
from bundestrack.models.enrichment import (
    MPContact,
    MPEnrichment,
    MPProfileLink,
    normalise_printed_name,
)
from bundestrack.models.speeches import Protocol
from bundestrack.models.stammdaten import MP, Mandate
from bundestrack.models.votes import Vote, VoteSheet
from bundestrack.pipeline.join import MPResolver

logger = logging.getLogger(__name__)

#: A Convex ingestion payload: JSON-ready, validated at the far end.
Payload = dict[str, Any]


class TransformError(ValueError):
    """A record cannot be transformed into a valid payload.

    Raised rather than returning a half-filled payload, because the Convex
    validators would reject it anyway — and a 400 from a batch of 500 fails all
    500. Failing here names the one record at fault.
    """


# --- Fraktion vocabulary --------------------------------------------------

#: Stammdaten's long forms → the short form everything else uses (§6.4).
#:
#: Matched on a normalised substring rather than by equality: the dump spells
#: the CDU/CSU group with spaces around its hyphen (`Christlich - Sozialen`)
#: and the exact wording has changed between periods, so an equality table
#: would break silently on a reprint — and a Fraktion that fails to map is a
#: value the seating order, the rankings filter and the UI all fail to match.
FRAKTION_PATTERNS: tuple[tuple[str, str], ...] = (
    ("christlich demokratischen union", "CDU/CSU"),
    ("cdu/csu", "CDU/CSU"),
    ("sozialdemokratischen partei", "SPD"),
    ("bündnis 90", "BÜNDNIS 90/DIE GRÜNEN"),
    ("grünen", "BÜNDNIS 90/DIE GRÜNEN"),
    ("alternative für deutschland", "AfD"),
    ("afd", "AfD"),
    ("freien demokratischen partei", "FDP"),
    ("fdp", "FDP"),
    ("die linke", "Die Linke"),
    ("linkspartei", "Die Linke"),
    ("pds", "Die Linke"),
)

#: What an MP with no group is called. Matches `FACTION_ORDER` in
#: webapp/convex/seating.ts, which places them at the edges of the arc.
FRAKTIONSLOS = "Fraktionslos"


def normalise_fraktion(value: str | None) -> str:
    """Any source's spelling of a parliamentary group → the short form.

    Returns `Fraktionslos` for an absent group, which is a real status rather
    than missing data: three WP21 MPs sit without one (§9).

    An unrecognised value is returned as published and logged. Mapping it to
    `Fraktionslos` would be worse — it would quietly move an MP out of their
    group — and dropping it would empty the field the roster is filtered by.
    """
    if not value or not value.strip():
        return FRAKTIONSLOS
    text = value.strip()
    folded = text.casefold()
    if "fraktionslos" in folded:
        return FRAKTIONSLOS
    for needle, short in FRAKTION_PATTERNS:
        if needle in folded:
            return short
    logger.warning(
        "Unmapped Fraktion %r — passing it through. Add it to FRAKTION_PATTERNS "
        "(docs/api-research.md §6.4).",
        text,
    )
    return text


# --- text -----------------------------------------------------------------


def clean_text(value: str | None) -> str | None:
    """Collapse whitespace in a source string, including the line breaks in it.

    DIP embeds literal `\\r\\n` inside titles — `"Haushaltsführung 2024\\r\\nÜber-
    und außerplanmäßige Ausgaben…"` — and the protocol XML uses non-breaking
    spaces (§4.2). Both survive into the database untouched, where they break a
    single-line UI and, worse, sit inside the `subject` that `questions` uses as
    part of its natural key: a re-export that changes one line break turns an
    upsert into an insert.

    `.split()` treats `\\r`, `\\n`, `\\t` and `\\xa0` alike, so one pass covers
    every spelling the sources use.
    """
    if value is None:
        return None
    return " ".join(value.split()) or None


def require_text(value: str | None, what: str) -> str:
    """As `clean_text`, for a field the schema requires."""
    cleaned = clean_text(value)
    if not cleaned:
        raise TransformError(f"{what} has no title, which the Convex schema requires")
    return cleaned


# --- dates ----------------------------------------------------------------


def iso(value: date | None) -> str | None:
    """A date as the schema stores it, or None."""
    return value.isoformat() if value else None


def require_iso(value: date | None, what: str) -> str:
    """As `iso`, for a field the schema requires."""
    if value is None:
        raise TransformError(f"{what} has no date, which the Convex schema requires")
    return value.isoformat()


# --- MPs ------------------------------------------------------------------


def contact_payload(contact: MPContact | None) -> Payload | None:
    """An MP's contact block → the nested object the schema stores.

    Null for an MP whose page published nothing, which is distinct from an MP
    whose page has not been fetched — both end up null here, and the enrich
    stage's notes are what tell the two apart.

    ⚠ No `email` and no `phone` key, because neither exists to fill: the
    Stammdaten DTD declares no contact elements and the biography pages carry
    no `mailto:` or `tel:` links (models/enrichment.py). `formUrl` is the
    Bundestag's own substitute — a form a reader submits, not an address.

    The Berlin office is omitted for a different reason: it is the same
    building for all 630 MPs, so it belongs in the UI as a constant rather than
    in 630 database rows.
    """
    if contact is None or contact.is_empty:
        return None
    return {
        "formUrl": contact.form_url,
        "constituencyOffice": contact.constituency_office,
        "homepage": contact.homepage,
        "socials": [
            {"platform": profile.platform, "url": profile.url} for profile in contact.socials
        ],
    }


def mp_payload(
    mp: MP,
    mandate: Mandate,
    internal_id: str,
    *,
    dip_person_id: str | None = None,
    enrichment: MPEnrichment | None = None,
) -> Payload:
    """One `(MP, Wahlperiode)` mandate → the `mps` row.

    One row per *mandate*, not per human: `party`, `fraktion`, `constituency`
    and `datesInOffice` all change between periods, and six WP21 MPs changed
    Fraktion mid-period (§6.4). `internalId` is what identifies the human
    across periods.

    `enrichment` carries the portrait, occupation, education and contact block,
    resolved by the enrich stage and held on the resolver. It is threaded
    *through this payload* rather than written by a mutation of its own, and
    that is deliberate: this upsert replaces the row's columns, and it runs
    again on every sync and a second time within one (`link_dip_persons`
    re-posts the roster to patch in the DIP crosswalk). A separately-written
    `photoUrl` would therefore survive until the next roster write and no
    longer.

    None means the enrich stage did not reach this MP — the name join failed,
    or the stage was skipped — and the columns go out as null, which is what
    the UI's initials fallback is for. That fallback is no longer the common
    case: §6.5 measured portrait coverage at 36.5 % via Wikimedia Commons, but
    the Bundestag's own listing publishes one for all 639 WP21 MPs and 635 of
    them join to the roster (`api.mp_profiles`).
    """
    name = mp.current_name
    if name is None:
        raise TransformError(f"Stammdaten MP {mp.id} has no <NAME> entry")

    start = iso(mandate.start_date)
    portrait = enrichment.portrait if enrichment else None
    return {
        "internalId": internal_id,
        "stammdatenId": mp.id,
        "dipPersonId": dip_person_id,
        # Includes the Ortszusatz, which is part of the name and disambiguates
        # identical ones — `Hubertus Heil (Peine)` (§7.1).
        "name": name.display_name,
        "vorname": name.vorname,
        "nachname": name.nachname,
        # Stored exactly as Stammdaten spells it, parentheses included: adding
        # a second pair is one of the two causes of the naive join's 21/630
        # failures (§7.1).
        "ortsZusatz": name.ortszusatz,
        # The vote sheets file this under a column headed `Titel`, which does
        # *not* hold academic titles (§4.1). `adel` is folded in because the
        # sheets print the two together (`Frhr. von Stetten`).
        "praefix": " ".join(p for p in (name.adel, name.praefix) if p) or None,
        "party": mp.partei_kurz or "",
        "fraktion": normalise_fraktion(mandate.fraktion()),
        "constituency": clean_text(mandate.wkr_name),
        "wahlperiode": mandate.wahlperiode,
        "bio": clean_text(mp.vita_kurz),
        # Hotlinked, never rehosted, and never shown without `photoCredit`:
        # these are photographer-credited works rather than open-licensed ones
        # (§6.5), so the two fields are written and read as a pair.
        "photoUrl": portrait.url if portrait else None,
        "photoCredit": portrait.credit if portrait else None,
        "birthDate": iso(mp.geburtsdatum),
        # Stammdaten publishes no education field of its own — `BERUF` is the
        # occupation and is mapped to `profession` below. This comes from
        # abgeordnetenwatch instead, which covers 83.4 % of WP21.
        "education": clean_text(enrichment.education) if enrichment else None,
        "profession": clean_text(mp.beruf),
        # Deliberately *not* a duplicate of `profession`. Stammdaten's `BERUF`
        # is the trade an MP practised before the mandate; abgeordnetenwatch's
        # `occupation` is what they do now, which for a sitting member is often
        # `MdB`. The two disagree usefully and both are kept.
        "occupation": clean_text(enrichment.occupation) if enrichment else None,
        "contact": contact_payload(enrichment.contact) if enrichment else None,
        "electionMethod": mandate.mandatsart,
        # An open `end` means still serving, and must stay distinguishable from
        # a date: that is how §6.2 reconciles 635 mandate rows to 630 seats.
        "datesInOffice": ({"start": start, "end": iso(mandate.end_date)} if start else None),
    }


def roster_payloads(resolver: MPResolver) -> list[Payload]:
    """The whole roster for the resolver's period.

    First in §11.1's dependency order, and enforced as such by Convex: every
    other ingestion mutation rejects a record naming an MP who is not here.
    """
    payloads: list[Payload] = []
    for mp in resolver.roster():
        mandate = mp.mandate_for(resolver.wahlperiode)
        if mandate is None:  # pragma: no cover - `roster()` filters on this
            continue
        internal = resolver.from_stammdaten_id(mp.id)
        if internal is None:  # pragma: no cover - same
            continue
        payloads.append(
            mp_payload(
                mp,
                mandate,
                internal,
                dip_person_id=resolver.dip_person_id_for(internal),
                # Null until the enrich stage has run, and re-read here on every
                # roster post so a later stage's re-post carries the enrichment
                # rather than blanking it.
                enrichment=resolver.enrichment_for(internal),
            )
        )
    return payloads


def dip_link_payloads(resolver: MPResolver) -> list[Payload]:
    """`mps/link-dip` arguments for every MP whose DIP id resolved (§7.2).

    A separate stage from the roster upsert because it happens from a different
    source and a stage later — §11.1 puts the roster first precisely so it need
    not wait for DIP `/person`.
    """
    payloads: list[Payload] = []
    for internal in sorted(resolver.internal_ids()):
        dip_person_id = resolver.dip_person_id_for(internal)
        if dip_person_id is None:
            continue
        payloads.append(
            {
                "internalId": internal,
                "wahlperiode": resolver.wahlperiode,
                "dipPersonId": dip_person_id,
            }
        )
    return payloads


# --- enrichment -----------------------------------------------------------


def portrait_enrichment(
    profiles: Iterable[MPProfileLink], resolver: MPResolver
) -> tuple[list[MPEnrichment], list[str]]:
    """Listing entries → enrichment, joined to the roster by printed name.

    Returns the matches and the printed names that did not match, because both
    are worth reporting: the listing is the complete roster from the
    Bundestag's own side, so a name here that resolves to nobody means the
    Stammdaten snapshot is behind (§7.3), not that the MP is fictitious.

    Measured live on 2026-07-27: 635 of 639 resolve, none ambiguously. The four
    misses are middle initials and MPs missing from the dump entirely — see
    `models.enrichment.normalise_printed_name`.

    An MP whose portrait had no photographer credit arrives here with
    `portrait=None` (the parser drops it, §6.5) and still yields an entry: the
    profile URL is what a later contact fetch needs, and it is independent of
    whether the picture was usable.
    """
    matched: list[MPEnrichment] = []
    unmatched: list[str] = []
    for profile in profiles:
        name = normalise_printed_name(profile.printed_name)
        if name is None:
            unmatched.append(profile.printed_name)
            continue
        internal = resolver.resolve_printed_name(name.nachname, name.vorname, name.particle)
        if internal is None:
            unmatched.append(profile.printed_name)
            continue
        matched.append(MPEnrichment(internal_id=internal, portrait=profile.portrait))
    return matched, unmatched


def politician_enrichment(
    politicians: dict[str, dict[str, str | None]], resolver: MPResolver
) -> list[MPEnrichment]:
    """abgeordnetenwatch records → enrichment, joined by **Stammdaten id**.

    The only external join in the pipeline that needs no names at all:
    `ext_id_bundestagsverwaltung` is the 8-digit Stammdaten id verbatim
    (`api.abgeordnetenwatch.iter_politicians`), so §7.1's failure modes do not
    apply. The dict is keyed by that id.

    Politicians outside this period's roster are skipped — the source covers
    people across every Bundestag since 2005, and only this period's are being
    enriched.

    ⚠ Scoped against `internal_ids()` rather than on `from_stammdaten_id`
    alone. That lookup indexes the *whole* Stammdaten dump — 4 614 MPs across
    every period, against 635 seats in WP21 — because its own caller
    (`speech_payloads`, §5.2) needs to resolve a `<redner id>` from a sitting
    that may predate the period being loaded. So it answers with an internal id
    for someone who is not on this roster, and without this check the stage
    reported enriching **1 790 of 635** MPs: every former member the source
    happens to carry, attached to a mandate row that does not exist. Convex
    would have rejected those rows, but the count was wrong long before the
    write.
    """
    roster = resolver.internal_ids()
    enriched: list[MPEnrichment] = []
    for stammdaten_id, fields in politicians.items():
        internal = resolver.from_stammdaten_id(stammdaten_id)
        if internal is None or internal not in roster:
            continue
        if not (fields.get("occupation") or fields.get("education")):
            continue
        enriched.append(
            MPEnrichment(
                internal_id=internal,
                occupation=fields.get("occupation"),
                education=fields.get("education"),
            )
        )
    return enriched


def contact_enrichment(internal_id: str, contact: MPContact) -> MPEnrichment:
    """One MP's fetched contact block, as an enrichment record to merge."""
    return MPEnrichment(internal_id=internal_id, contact=contact)


# --- committees -----------------------------------------------------------


def committee_payloads(resolver: MPResolver) -> list[Payload]:
    """Committee seats for the whole roster.

    ⚠ Current Wahlperiode only, permanently: MdB-Stammdaten is the only
    machine-readable committee source in existence and all 1 744 `Ausschuss`
    entries belong to WP21 (§6.3, §6.4). For an earlier period this returns
    nothing because nothing was published — not because nobody sat on a
    committee, which is a distinction the UI has to make.

    `Mandate.committees()` deduplicates, so a chair listed twice — once as
    `Vorsitzender`, once as `Ordentliches Mitglied` (§6.3) — is one seat.
    """
    payloads: list[Payload] = []
    for mp in resolver.roster():
        mandate = mp.mandate_for(resolver.wahlperiode)
        internal = resolver.from_stammdaten_id(mp.id)
        if mandate is None or internal is None:  # pragma: no cover
            continue
        for membership in mandate.committees():
            payloads.append(
                {
                    "mpInternalId": internal,
                    "committeeName": require_text(
                        membership.name, f"Committee seat for {internal}"
                    ),
                    "role": membership.role,
                    "wahlperiode": mandate.wahlperiode,
                    # Day-level, which is finer than anything DIP offers (§6.3).
                    "startDate": iso(membership.start_date),
                    "endDate": iso(membership.end_date),
                }
            )
    return payloads


# --- votes ----------------------------------------------------------------


def vote_sheet_payload(
    sheet: VoteSheet,
    *,
    result: str = "",
    title: str | None = None,
    sheet_date: date | None = None,
) -> Payload:
    """One ballot → the `voteSheets` row.

    The tallies are counted from the sheet's own rows, which is the only place
    they exist: the XLSX publishes no totals line. Convex stores them beside
    the per-MP records without deriving one from the other, so a partial record
    ingest reads as a disagreement rather than as a different result.

    `result` is DIP's `beschlusstenor` when the ballot was discovered through
    `/vorgangsposition`, and empty otherwise — the sheet itself does not carry
    the outcome, only the votes.
    """
    counts = sheet.tally()
    return {
        "wahlperiode": sheet.wahlperiode,
        "sitzungnr": sheet.sitzungnr,
        "abstimmnr": sheet.abstimmnr,
        # The title comes from the AJAX listing's link text, not from the
        # sheet: the XLSX carries the ballot's numbers and nothing naming it.
        "title": require_text(title or sheet.title, f"Ballot {sheet.key}"),
        "date": require_iso(sheet_date or sheet.date, f"Ballot {sheet.key}"),
        "result": result,
        "yesCount": counts[Vote.YES],
        "noCount": counts[Vote.NO],
        "abstainCount": counts[Vote.ABSTAIN],
        "invalidCount": counts[Vote.INVALID],
        # Recoverable only from the XLSX: the protocol XML lists just the MPs
        # who cast a vote (§4.2), so a ballot ingested from XML alone would
        # report every absence as if it never happened.
        "absentCount": counts[Vote.ABSENT],
        "totalEligible": sheet.total_eligible,
        "sourceUrl": sheet.source_url,
    }


def vote_record_payloads(sheet: VoteSheet, resolver: MPResolver) -> Payload:
    """One ballot's per-MP records, as `vote-records` expects them.

    Keyed by the ballot's natural key rather than a Convex id, so the pipeline
    posts a parsed sheet in one request without a round-trip.

    Rows whose name does not resolve are **quarantined by the resolver**, not
    dropped: §7.3 records two MPs in a July 2026 sheet missing from the
    Stammdaten dump entirely, and a silently skipped row is a vote that never
    happened. They are retried on a later sync.
    """
    records: list[Payload] = []
    for record in sheet.records:
        internal = resolver.resolve_vote_record(record)
        if internal is None:
            continue
        records.append(
            {
                "mpInternalId": internal,
                "vote": record.vote.value,
                # As printed on the ballot, which is not always the MP's
                # current group — six WP21 MPs changed mid-period (§6.4). Kept
                # so a historical ballot renders as it was.
                "partyAtVote": normalise_fraktion(record.fraktion) if record.fraktion else None,
                "remark": record.bemerkung,
            }
        )
    return {
        "wahlperiode": sheet.wahlperiode,
        "sitzungnr": sheet.sitzungnr,
        "abstimmnr": sheet.abstimmnr,
        "records": records,
    }


# --- speeches -------------------------------------------------------------


def speech_payloads(
    protocol: Protocol,
    resolver: MPResolver,
    *,
    protocol_id: str | None = None,
    include_zu_protokoll: bool = True,
) -> list[Payload]:
    """One sitting's speech segments.

    **One row per segment, not per `<rede>`.** §5.2 calls this the biggest trap
    in the corpus: one `<rede>` can hold several distinct speakers because a
    Zwischenfrage nests inside the speech it interrupts, and protocol 21/90 has
    112 `<rede>` against 197 speaker paragraphs. `api.protocols` has already
    re-attributed them; re-grouping here would put the fix back.

    `include_zu_protokoll` is explicit because §11.3 asks for it to be:
    *zu Protokoll gegebene Reden* were submitted for the record and never
    delivered aloud — 17 of 112 in 21/90, 0 of 191 in 20/177 — and whether they
    count should be a decision rather than an accident. They are included by
    default: the words were written and published under the MP's name.

    A speaker whose `<redner id>` is not on the roster is quarantined, not
    dropped (§7.3).
    """
    payloads: list[Payload] = []
    for speech in protocol.speeches:
        if speech.zu_protokoll and not include_zu_protokoll:
            continue
        internal = resolver.resolve_speaker_id(
            speech.speaker.id,
            context=f"WP{protocol.wahlperiode} sitting {protocol.sitzungnr}",
        )
        if internal is None:
            continue
        payloads.append(
            {
                "mpInternalId": internal,
                "protocolId": protocol_id,
                "protocolDate": require_iso(
                    speech.protocol_date or protocol.date,
                    f"Protocol {protocol.wahlperiode}/{protocol.sitzungnr}",
                ),
                "wahlperiode": speech.wahlperiode or protocol.wahlperiode,
                "sitzungnr": speech.sitzungnr or protocol.sitzungnr,
                # Part of the natural key, which is what lets an MP who speaks
                # four times have four rows instead of one overwritten thrice.
                "speechIndex": speech.speech_index,
                # Words, not segments: ranking by count puts a minister 36
                # speeches above a chancellor for saying 25 % less (§5.2).
                "wordCount": speech.word_count,
                "topic": clean_text(speech.topic),
            }
        )
    return payloads


# --- activities -----------------------------------------------------------


def activity_payload(aktivitaet: Aktivitaet, internal_id: str) -> Payload:
    """One `/aktivitaet` record → the `activities` row.

    The cheapest join in the corpus and the most important to keep complete:
    one record per MP per action, carrying `person_id` directly, so it needs no
    name matching (§3.5).

    ⚠ `aktivitaetsart` is passed through as an **open string**. The spec
    declares no enum and publishes no value list, and the values seen in
    research are a sample of 80 537 records — so anything that closed the set
    here would delete a whole class of parliamentary work from every MP's score
    with no error (§3.5). Convex buckets unknown kinds into a counted `other`.

    `titel` is the **person's name**, not a description of the action, so the
    description comes from the referenced Vorgang.
    """
    return {
        "dipAktivitaetId": aktivitaet.id,
        "mpInternalId": internal_id,
        "aktivitaetsart": aktivitaet.aktivitaetsart,
        "vorgangId": _first_vorgang_id(aktivitaet),
        "date": aktivitaet.datum.isoformat(),
        "wahlperiode": aktivitaet.wahlperiode,
        "description": _activity_description(aktivitaet),
    }


def activity_payloads(
    aktivitaeten: Iterable[Aktivitaet], resolver: MPResolver
) -> Iterator[Payload]:
    """Every activity whose MP resolves, in order.

    An unresolved `person_id` is skipped rather than quarantined: it means the
    DIP↔Stammdaten crosswalk has not linked that person, which
    `MPResolver.unlinked_internal_ids` already tracks from the other side, and
    which resolves itself when `/person` is re-matched on the next sync.
    """
    for aktivitaet in aktivitaeten:
        internal = resolver.from_dip_person_id(aktivitaet.person_id)
        if internal is None:
            continue
        yield activity_payload(aktivitaet, internal)


def _first_vorgang_id(aktivitaet: Aktivitaet) -> str | None:
    """The procedure this activity belongs to.

    ⚠ `vorgangsbezug` is capped at four entries with the true count in
    `vorgangsbezug_anzahl` (§3.4). One is enough here — the activity is *about*
    a document, and the first reference is the one it was published under — but
    the cap is why nothing counts from the length of this list.
    """
    return aktivitaet.vorgangsbezug[0].id if aktivitaet.vorgangsbezug else None


def _activity_description(aktivitaet: Aktivitaet) -> str | None:
    """What the activity was about, from the referenced procedure.

    Not `aktivitaet.titel`: that field holds the *person's* name
    (`Luise Amtsberg, MdB, BÜNDNIS 90/DIE GRÜNEN`), which as a description
    would render every activity in the feed as the MP's own name (§3.5).
    """
    if aktivitaet.vorgangsbezug:
        return clean_text(aktivitaet.vorgangsbezug[0].titel)
    return clean_text(aktivitaet.abstract)


# --- questions ------------------------------------------------------------

#: `aktivitaetsart` values that are a parliamentary question, mapped to the
#: schema's closed union. Only these two: the Große/Kleine distinction is
#: constitutional — who must answer, and how — and there is no third kind
#: (webapp/convex/schema.ts). Schriftliche and Mündliche Fragen are real
#: instruments but not *Anfragen*, so they stay in `activities`, where the
#: score still counts them, rather than being forced into a union that has no
#: value for them.
QUESTION_KINDS = {
    "große anfrage": "major",
    "grosse anfrage": "major",
    "kleine anfrage": "minor",
}


def question_payload(aktivitaet: Aktivitaet, internal_id: str) -> Payload | None:
    """A question activity → the `questions` row, or None if it is not one.

    The natural key downstream is behavioural — `(MP, period, date)` narrowed
    by subject — because no external id identifies a question *as* a question:
    it arrives as a Drucksache and as an `/aktivitaet` record, and neither is
    the other's id.
    """
    kind = QUESTION_KINDS.get(aktivitaet.aktivitaetsart.strip().casefold())
    if kind is None:
        return None
    subject = _activity_description(aktivitaet)
    if not subject:
        return None
    return {
        "mpInternalId": internal_id,
        "subject": subject,
        "date": aktivitaet.datum.isoformat(),
        "wahlperiode": aktivitaet.wahlperiode,
        "type": kind,
    }


def question_payloads(
    aktivitaeten: Iterable[Aktivitaet], resolver: MPResolver
) -> Iterator[Payload]:
    for aktivitaet in aktivitaeten:
        internal = resolver.from_dip_person_id(aktivitaet.person_id)
        if internal is None:
            continue
        payload = question_payload(aktivitaet, internal)
        if payload is not None:
            yield payload


# --- motions --------------------------------------------------------------


def motion_from_vorgang(vorgang: Vorgang) -> Payload:
    """A procedure → the `motions` row.

    The procedure is the stabler of the two identities — one Vorgang spans
    several papers — which is why `findMotion` in webapp/convex/motions.ts
    tries `dipVorgangId` first.
    """
    return {
        "dipVorgangId": vorgang.id,
        "dipDrucksacheId": None,
        "drucksacheNr": None,
        "title": require_text(vorgang.titel, f"Vorgang {vorgang.id}"),
        "type": None,
        "date": require_iso(vorgang.datum, f"Vorgang {vorgang.id}"),
        "wahlperiode": vorgang.wahlperiode,
        "vorgangstyp": clean_text(vorgang.vorgangstyp),
    }


def motion_from_drucksache(drucksache: Drucksache) -> Payload:
    """A printed paper → the `motions` row, linked to its procedure.

    `drucksacheNr` is Bundestag-issued only. §5.1 warns that Bundesrat
    numbering is a bare running number that any `split("/")` misparses, which
    is why every DIP query passes `f.zuordnung=BT`.
    """
    reference = drucksache.vorgangsbezug[0] if drucksache.vorgangsbezug else None
    return {
        "dipVorgangId": reference.id if reference else None,
        "dipDrucksacheId": drucksache.id,
        "drucksacheNr": drucksache.dokumentnummer,
        "title": require_text(drucksache.titel, f"Drucksache {drucksache.id}"),
        "type": clean_text(drucksache.drucksachetyp),
        "date": drucksache.datum.isoformat(),
        "wahlperiode": drucksache.wahlperiode or 0,
        "vorgangstyp": clean_text(reference.vorgangstyp) if reference else None,
    }


def dedupe_motions(payloads: Iterable[Payload]) -> list[Payload]:
    """Collapse papers that share a procedure, keeping the earliest.

    Necessary because motion identity in Convex is the Vorgang: `findMotion`
    matches `dipVorgangId` before `dipDrucksacheId`, so posting a Kleine
    Anfrage and the government's answer — which share Vorgang `337602` — would
    patch one row twice and leave it titled with the answer.

    Earliest wins because the originating paper is the motion: the question is
    what an MP tabled, the answer is what the government sent back, and the
    sponsors attached to the row are the question's signatories.

    Papers with no Vorgang keep their own identity, since nothing can merge
    them and their Drucksache id is all they have.
    """
    by_vorgang: dict[str, Payload] = {}
    standalone: list[Payload] = []
    for payload in payloads:
        vorgang_id = payload.get("dipVorgangId")
        if not vorgang_id:
            standalone.append(payload)
            continue
        existing = by_vorgang.get(vorgang_id)
        if existing is None or payload["date"] < existing["date"]:
            # Merged rather than replaced: whichever paper is dropped may be
            # the only one carrying a Drucksache number or a type.
            by_vorgang[vorgang_id] = (
                payload if existing is None else _merge_motion(payload, existing)
            )
        else:
            by_vorgang[vorgang_id] = _merge_motion(existing, payload)
    return [*by_vorgang.values(), *standalone]


def _merge_motion(primary: Payload, secondary: Payload) -> Payload:
    """`primary` wins every field it has; `secondary` fills its gaps."""
    merged = dict(primary)
    for key, value in secondary.items():
        if merged.get(key) is None and value is not None:
            merged[key] = value
    return merged


def motion_sponsor_payloads(
    aktivitaeten: Iterable[Aktivitaet],
    resolver: MPResolver,
    *,
    wahlperiode: int,
) -> list[Payload]:
    """Sponsorships, grouped into one request per motion.

    **Never derived from `autoren_anzeige`**, which DIP caps at four entries
    with the real total in `autoren_anzahl` (§3.4) — a motion with forty
    co-signatories would arrive as four names and a number, and §3.4 states
    plainly that authorship computed that way systematically under-counts. It
    comes from `/aktivitaet`, one record per MP per document, which is also why
    sponsors arrive over time rather than all at once.

    `role` carries the activity kind rather than `Erstunterzeichner` /
    `Mitunterzeichner`: DIP does not publish the signing order anywhere the
    per-MP feed can see, and inventing a rank would be a claim about seniority
    the source does not make. What it *does* say — that this MP's act was a
    `Kleine Anfrage` — is recorded instead.
    """
    grouped: dict[str, dict[str, Any]] = {}
    for aktivitaet in aktivitaeten:
        vorgang_id = _first_vorgang_id(aktivitaet)
        if vorgang_id is None:
            continue
        internal = resolver.from_dip_person_id(aktivitaet.person_id)
        if internal is None:
            continue
        group = grouped.setdefault(
            vorgang_id,
            {
                "dipVorgangId": vorgang_id,
                "dipDrucksacheId": None,
                "wahlperiode": wahlperiode,
                "sponsors": [],
                "_seen": set(),
            },
        )
        if internal in group["_seen"]:
            continue
        group["_seen"].add(internal)
        group["sponsors"].append({"mpInternalId": internal, "role": aktivitaet.aktivitaetsart})

    return [
        {key: value for key, value in group.items() if key != "_seen"} for group in grouped.values()
    ]


# --- the unified feed -----------------------------------------------------

#: `aktivitaetsart` → the feed's event type. Substring-matched and case-folded,
#: mirroring `bucketFor` in webapp/lib/scoring.ts — for the same reason it is:
#: the field is an open string, so this must be a routing rule with a default
#: rather than a total mapping (§3.5).
EVENT_TYPE_PATTERNS: tuple[tuple[str, str], ...] = (
    # Before `anfrage`, which it contains as a substring: a Zwischenfrage is a
    # spoken intervention during someone else's speech, not a written question.
    ("zwischenfrage", "speech"),
    ("kurzintervention", "speech"),
    ("anfrage", "question"),
    ("rede", "speech"),
    ("erklärung", "speech"),
    ("gesetzentwurf", "bill"),
    ("antrag", "motion"),
    ("entschließung", "motion"),
    ("bericht", "motion"),
)


def event_type_for(aktivitaetsart: str) -> str:
    """Which feed bucket an activity kind belongs in.

    Falls back to `activity` — the feed's own catch-all — rather than dropping
    the event. An unrecognised kind should appear in an MP's timeline labelled
    generically, not vanish from it.
    """
    kind = aktivitaetsart.casefold()
    for needle, event_type in EVENT_TYPE_PATTERNS:
        if needle in kind:
            return event_type
    return "activity"


def activity_event_payloads(
    aktivitaeten: Iterable[Aktivitaet], resolver: MPResolver
) -> Iterator[Payload]:
    """Feed entries derived from the activity backbone.

    `referenceId`/`referenceType` point back at the DIP activity, which is what
    makes re-deriving the feed an upsert rather than a second copy — an event
    with a null `referenceId` cannot be de-duplicated and a re-run appends it
    (webapp/convex/activityEvents.ts).
    """
    for aktivitaet in aktivitaeten:
        internal = resolver.from_dip_person_id(aktivitaet.person_id)
        if internal is None:
            continue
        yield {
            "mpInternalId": internal,
            "eventType": event_type_for(aktivitaet.aktivitaetsart),
            "date": aktivitaet.datum.isoformat(),
            # The activity kind is the headline; the document title is the
            # detail. `aktivitaet.titel` is the MP's name and is used for
            # neither (§3.5).
            "title": clean_text(aktivitaet.aktivitaetsart) or aktivitaet.aktivitaetsart,
            "description": _activity_description(aktivitaet),
            "referenceId": aktivitaet.id,
            "referenceType": "dipAktivitaet",
            "wahlperiode": aktivitaet.wahlperiode,
        }


def vote_event_payloads(sheet: VoteSheet, resolver: MPResolver, *, title: str) -> list[Payload]:
    """Feed entries for one ballot — one per MP who was listed.

    Includes absences, because the sheet is the only source that records them
    (§4.2) and "did not vote" is a fact about a sitting an MP's timeline should
    show. The `referenceId` is the ballot's natural key rather than a Convex
    id, so the event de-duplicates without the pipeline holding one.
    """
    reference = f"{sheet.wahlperiode}/{sheet.sitzungnr}/{sheet.abstimmnr}"
    events: list[Payload] = []
    for record in sheet.records:
        internal = resolver.resolve_printed_name(record.name, record.vorname, record.titel)
        if internal is None:
            continue
        events.append(
            {
                "mpInternalId": internal,
                "eventType": "vote",
                "date": require_iso(sheet.date, f"Ballot {sheet.key}"),
                "title": require_text(title, f"Ballot {sheet.key}"),
                "description": record.vote.value,
                "referenceId": reference,
                "referenceType": "voteSheetKey",
                "wahlperiode": sheet.wahlperiode,
            }
        )
    return events


def speech_event_payloads(speeches: Iterable[Payload], *, sitting_title: str) -> list[Payload]:
    """Feed entries for a sitting's speeches, one per MP per sitting.

    Aggregated to the sitting rather than emitted per segment: an MP who was
    interrupted four times produced four rows in `speeches` — correctly, since
    `wordCount` is what scoring uses — but four identical feed entries on one
    day would read as four separate speeches to anyone looking at the timeline.
    """
    totals: dict[str, dict[str, Any]] = {}
    for speech in speeches:
        entry = totals.setdefault(
            speech["mpInternalId"],
            {
                "mpInternalId": speech["mpInternalId"],
                "eventType": "speech",
                "date": speech["protocolDate"],
                "title": require_text(sitting_title, "Sitting"),
                "description": None,
                "referenceId": f"{speech['wahlperiode']}/{speech['sitzungnr']}",
                "referenceType": "sitting",
                "wahlperiode": speech["wahlperiode"],
                "_words": 0,
                "_segments": 0,
            },
        )
        entry["_words"] += speech["wordCount"] or 0
        entry["_segments"] += 1

    events: list[Payload] = []
    for entry in totals.values():
        words = entry.pop("_words")
        segments = entry.pop("_segments")
        entry["description"] = (
            f"{words} Wörter" if segments == 1 else f"{words} Wörter in {segments} Redebeiträgen"
        )
        events.append(entry)
    return events
