"""Orchestration: fetch → transform → load, in the order the joins allow.

The three entry points the CLI calls, plus the score trigger:

    init(wp)        full backfill of one period, roster first
    sync(wp)        daily incremental, filtered on `aktualisiert`
    backfill(wp)    init for a named historical period
    recompute_scores(wp)

`init` and `backfill` are the same function with different defaults, because
they are the same operation — the only difference is which period, and whether
the sources have data for it at all. That is stated once in `run_backfill`
rather than duplicated into two divergent code paths.

## The order is a dependency graph, not a preference

§11.1, and Convex enforces it: every ingestion mutation calls `requireMandate`
and rejects a record naming an MP who is not on the roster, so a batch posted
out of order fails as a 400 rather than as an orphan row.

    1. Stammdaten ZIP    → the roster, the name index, committees
    2. DIP /person       → the dipPersonId crosswalk (name-matched, §7.2)
    3. DIP /aktivitaet   → activities, questions, sponsors, the feed
    4. DIP /vorgang + /drucksache → motions
    5. Protocol XML      → speeches
    6. Named-vote XLSX   → ballots and per-MP votes (the only absences, §4.2)

Stages 3–6 depend on 1 and 2 and on nothing else, so a failure in one does not
invalidate the others — `run_backfill` reports per stage and continues.

## Everything here is sequential, and that is load-bearing

Not a style choice. Every `*.bundestag.de` host sits behind the Enodia WAF,
which IP-blocks *all* of them at once on concurrent access and did not clear
across an hour of backoff (§2.6). `api.base` refuses a second concurrent
request rather than serialising it, so this module never needs to be careful —
it needs only to not be clever.

## Resumability

Every write is an upsert on a natural key, so a run that dies halfway is
re-run, not repaired. The watermark advances only to timestamps actually seen
(`pipeline.state`), and the quarantine survives across runs, so the two things
a crash could corrupt are the two things that are written last and atomically.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from bundestrack.api.base import BundestagAPIError
from bundestrack.api.dip import DIPClient
from bundestrack.api.protocols import ProtocolClient
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.api.votes import VoteClient
from bundestrack.config import Settings, get_settings
from bundestrack.models.dip import Aktivitaet, Plenarprotokoll
from bundestrack.models.votes import VoteSheet, VoteSheetLink
from bundestrack.pipeline import transform
from bundestrack.pipeline.join import MPResolver
from bundestrack.pipeline.load import BatchResult, ConvexError, ConvexLoader
from bundestrack.pipeline.state import (
    STREAM_ACTIVITIES,
    STREAM_MOTIONS,
    STREAM_PROTOCOLS,
    SyncState,
    load_state,
    save_state,
)
from bundestrack.pipeline.transform import ballot_key

logger = logging.getLogger(__name__)

#: The Wahlperiode Bundestrack tracks by default.
CURRENT_WAHLPERIODE = 21

#: First period with protocol XML (§5.2). Earlier ones are PDF-only, so the
#: speech stage has nothing to fetch and says so rather than 404ing 200 times.
FIRST_XML_WAHLPERIODE = 18

#: Records to accumulate before posting. Below `load.MAX_BATCH` so a chunk is
#: one request, and small enough that an 80 537-record backfill streams through
#: memory rather than being collected into a list first.
STREAM_BATCH = 500


@dataclass
class StageReport:
    """What one stage of a run did.

    Collected rather than only logged so a run's summary is one object the CLI
    can print and a test can assert on — and so a stage that failed is
    reported as failed rather than as absent.
    """

    name: str
    result: BatchResult | None = None
    error: str | None = None
    #: Free-text notes: a period with no committee data, a skipped protocol.
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.error is None

    def __str__(self) -> str:
        if self.error:
            return f"{self.name}: FAILED — {self.error}"
        if self.result is not None:
            body = str(self.result)
        # A stage with notes but no counters did something it does not measure
        # in rows — seating, or a period whose source publishes nothing. Saying
        # "nothing to do" above a note describing what it did reads as a bug.
        elif self.notes:
            body = "see below"
        else:
            body = "nothing to do"
        return f"{self.name}: {body}" + ("".join(f"\n    {n}" for n in self.notes))


@dataclass
class RunReport:
    """Every stage of one run, in order."""

    wahlperiode: int
    mode: str
    stages: list[StageReport] = field(default_factory=list)
    quarantined: int = 0

    def stage(self, name: str) -> StageReport:
        report = StageReport(name)
        self.stages.append(report)
        return report

    @property
    def ok(self) -> bool:
        return all(stage.ok for stage in self.stages)

    def summary(self) -> str:
        lines = [f"{self.mode} WP{self.wahlperiode}:"]
        lines.extend(f"  {stage}" for stage in self.stages)
        if self.quarantined:
            lines.append(
                f"  quarantine: {self.quarantined} unresolved names held for a later sync (§7.3)"
            )
        return "\n".join(lines)


class Pipeline:
    """One run's clients, resolver and destination.

    A class rather than free functions threading six arguments: the DIP client
    heals its own API key across calls (§1.2) and the resolver is built once
    and consulted by every stage, so both are per-run state that the stages
    share rather than parameters they each re-derive.
    """

    def __init__(
        self,
        wahlperiode: int,
        *,
        settings: Settings | None = None,
        dry_run: bool = False,
        dip: DIPClient | None = None,
        stammdaten: StammdatenClient | None = None,
        protocols: ProtocolClient | None = None,
        votes: VoteClient | None = None,
        loader: ConvexLoader | None = None,
        state: SyncState | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.wahlperiode = wahlperiode
        self.dry_run = dry_run
        self.state = state if state is not None else load_state(self.settings.state_path)

        self.dip = dip or DIPClient(
            self.settings.bundestag_api_key or None,
            base_url=self.settings.bundestag_api_base_url,
        )
        self.stammdaten = stammdaten or StammdatenClient()
        self.protocols = protocols or ProtocolClient()
        self.votes = votes or VoteClient()
        self.loader = loader or ConvexLoader(
            self.settings.require_convex_http_url(),
            self.settings.pipeline_api_key,
            dry_run=dry_run,
        )
        #: Built by `load_roster`; every other stage needs it.
        self.resolver: MPResolver | None = None
        #: `dipVorgangId` → `{internal id: role}`, accumulated by the activity
        #: stage and posted by the motion stage — sponsorships are known before
        #: the motions they attach to are written.
        self._sponsorships: dict[str, dict[str, str | None]] = {}

    def close(self) -> None:
        for client in (self.dip, self.stammdaten, self.protocols, self.votes, self.loader):
            client.close()

    def __enter__(self) -> Pipeline:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # -- stage 1: the roster ----------------------------------------------

    def load_roster(self, report: RunReport) -> MPResolver:
        """Stammdaten → the roster, the name index, and the internal ids.

        First, always, and not only because §11.1 says so: the resolver built
        here is what every later stage resolves names and ids against, and the
        Convex mutations reject any record naming an MP the roster does not
        have.

        The dump is re-downloaded every run (§7.3's mitigation) because there
        is no metadata endpoint to check first and the snapshot lags reality.
        `<VERSION>` is recorded so a refresh is visible in the log.
        """
        stage = report.stage("roster")
        dump = self.stammdaten.fetch()

        if dump.version and dump.version != self.state.stammdaten_version:
            stage.notes.append(
                f"Stammdaten version {self.state.stammdaten_version or '(none)'} → {dump.version}"
            )
        self.state.stammdaten_version = dump.version

        resolver = MPResolver(dump, self.wahlperiode, quarantine=self.state.quarantine)
        self.resolver = resolver

        # Retry what a previous run could not resolve. An entry that resolves
        # now was a staleness artefact, and the rows behind it are re-posted by
        # this run's own stages.
        recovered = self.state.quarantine.clear_resolved(resolver)
        if recovered:
            stage.notes.append(
                f"{len(recovered)} previously unresolved names now match the roster (§7.3)"
            )

        payloads = transform.roster_payloads(resolver)
        if not payloads:
            stage.notes.append(
                f"No Stammdaten mandates for WP{self.wahlperiode} — nothing else can be ingested"
            )
            return resolver
        stage.result = self.loader.upsert_mps(payloads)
        return resolver

    # -- stage 2: the DIP crosswalk ---------------------------------------

    def link_dip_persons(self, report: RunReport) -> None:
        """DIP `/person` → `dipPersonId` on the roster (§7.2).

        Fetched whole rather than incrementally even on a daily sync: the
        corpus is 5 623 records over 57 pages, the crosswalk must be complete
        before any activity can be attached, and a person amended since the
        last run is precisely the one whose name may now match.
        """
        stage = report.stage("dip-persons")
        resolver = self._require_resolver()

        persons = list(self.dip.iter_personen(self.wahlperiode))
        link = resolver.link_dip_persons(persons)
        stage.notes.append(f"{len(persons)} DIP persons: {link.summary()}")

        unlinked = resolver.unlinked_internal_ids()
        if unlinked:
            # Not an error. §6.1: DIP `/person` is not a roster, and an MP with
            # no DIP record simply has no DIP activities to attach — a visible
            # gap, which `listUnlinkedMPs` reads from the other side.
            stage.notes.append(f"{len(unlinked)} roster MPs still have no DIP person id")

        stage.result = self.loader.link_dip_persons(transform.dip_link_payloads(resolver))
        # The roster rows were written before the crosswalk resolved, so their
        # `dipPersonId` is still null. Re-posting them now is a patch, not a
        # second copy — every write here is an upsert on `(internalId, wp)`.
        self.loader.upsert_mps(transform.roster_payloads(resolver))

    # -- stage 3: committees ----------------------------------------------

    def load_committees(self, report: RunReport) -> None:
        """Committee seats, from the same dump as the roster.

        ⚠ Current period only, permanently. Stammdaten is the only
        machine-readable committee source in existence and it publishes
        committees for the current Wahlperiode alone (§6.3, §6.4) — so an
        empty result for an older period means *nothing was published*, and
        the note says so rather than leaving a zero to be misread.
        """
        stage = report.stage("committees")
        payloads = transform.committee_payloads(self._require_resolver())
        if not payloads:
            stage.notes.append(
                f"No committee data for WP{self.wahlperiode}. Stammdaten publishes committees "
                "for the current period only (§6.4) — this is absent data, not an idle chamber."
            )
            return
        stage.result = self.loader.upsert_committees(payloads)

    # -- stage 4: activities ----------------------------------------------

    def load_activities(self, report: RunReport, *, since: str | None) -> None:
        """DIP `/aktivitaet` → activities, questions, sponsorships and the feed.

        The backbone (§3.5): one record per MP per action, carrying `person_id`,
        so it is the only DIP source needing no name matching. A WP21 backfill
        is 80 537 records over ~806 pages, which at §2.6's pacing is a decision
        rather than a detail — hence streaming in batches rather than
        collecting the lot before the first write.

        Sponsorships are derived here rather than from `autoren_anzeige`, which
        DIP caps at four entries (§3.4). They are posted by `load_motions`,
        after the motions they attach to exist.
        """
        stage = report.stage("activities")
        since = self._window(STREAM_ACTIVITIES, since)
        resolver = self._require_resolver()
        result = BatchResult("activities")
        questions = BatchResult("questions")
        events = BatchResult("feed events")
        seen: list[datetime] = []
        deferred: list[datetime] = []

        for batch in _batched(
            self.dip.iter_aktivitaeten(self.wahlperiode, updated_since=since), STREAM_BATCH
        ):
            # Sponsorships are accumulated as they stream past, not by keeping
            # the activities: 80 537 models held to be re-read one stage later
            # is the whole backfill in memory at once, and only the
            # `(Vorgang, MP, role)` triple is needed.
            self._collect_sponsorships(batch, resolver)

            payloads = list(transform.activity_payloads(batch, resolver))
            stored = {p["dipAktivitaetId"] for p in payloads}
            # A record whose DIP person has not been linked is not stored, so
            # it must not be banked either: its `aktualisiert` never changes
            # when the *person* is linked later, so a watermark past it means
            # the activity is never re-read and that MP's work is lost.
            seen.extend(a.aktualisiert for a in batch if a.id in stored)
            deferred.extend(a.aktualisiert for a in batch if a.id not in stored)
            result.skipped += len(batch) - len(payloads)
            if payloads:
                result.merge(self.loader.upsert_activities(payloads))

            question_payloads = list(transform.question_payloads(batch, resolver))
            if question_payloads:
                questions.merge(self.loader.upsert_questions(question_payloads))

            event_payloads = list(transform.activity_event_payloads(batch, resolver))
            if event_payloads:
                events.merge(self.loader.add_activity_events(event_payloads))

        stage.result = result
        stage.notes.append(str(questions))
        stage.notes.append(str(events))
        if result.skipped:
            stage.notes.append(
                f"{result.skipped} activities name a DIP person with no roster match — "
                "the watermark is held back so a later sync re-reads them once the "
                "crosswalk resolves (§7.2)"
            )
        self.state.advance(self.wahlperiode, STREAM_ACTIVITIES, _safe_watermark(seen, deferred))

    def _collect_sponsorships(self, batch: Sequence[Aktivitaet], resolver: MPResolver) -> None:
        """Fold a batch of activities into the pending sponsorship map.

        Authorship comes from `/aktivitaet` — one record per MP per document —
        because DIP caps `autoren_anzeige` at four entries with the real total
        in `autoren_anzahl` (§3.4), so authorship computed from the paper
        systematically under-counts.
        """
        for group in transform.motion_sponsor_payloads(
            batch, resolver, wahlperiode=self.wahlperiode
        ):
            pending = self._sponsorships.setdefault(group["dipVorgangId"], {})
            for sponsor in group["sponsors"]:
                pending.setdefault(sponsor["mpInternalId"], sponsor["role"])

    # -- stage 5: motions --------------------------------------------------

    def load_motions(self, report: RunReport, *, since: str | None) -> None:
        """DIP `/vorgang` and `/drucksache` → motions, then their sponsors.

        Both sources, deduplicated on the Vorgang: a Kleine Anfrage and the
        government's answer share one procedure, and Convex keys a motion on
        `dipVorgangId` first — so posting both without merging would leave one
        row titled with the answer. See `transform.dedupe_motions`.
        """
        stage = report.stage("motions")
        since = self._window(STREAM_MOTIONS, since)
        payloads: list[dict[str, Any]] = []
        seen: list[datetime] = []

        for vorgang in self.dip.iter_vorgaenge(self.wahlperiode, updated_since=since):
            seen.append(vorgang.aktualisiert)
            if vorgang.datum is None:
                # No date, and the schema requires one. Skipped rather than
                # backdated: a motion filed under a guessed date sorts into the
                # wrong month of an MP's contribution graph.
                continue
            payloads.append(transform.motion_from_vorgang(vorgang))

        for drucksache in self.dip.iter_drucksachen(self.wahlperiode, updated_since=since):
            seen.append(drucksache.aktualisiert)
            payloads.append(
                transform.motion_from_drucksache(drucksache, wahlperiode=self.wahlperiode)
            )

        motions = transform.dedupe_motions(payloads)
        if motions:
            stage.result = self.loader.upsert_motions(motions)
            stage.notes.append(f"{len(payloads)} records deduplicated to {len(motions)} motions")

        # Only for motions this run actually wrote: `upsertMotionSponsors`
        # throws when the motion is absent, and an activity can reference a
        # procedure from a period this run did not fetch.
        known = {m["dipVorgangId"] for m in motions if m.get("dipVorgangId")}
        attachable = [
            {
                "dipVorgangId": vorgang_id,
                "dipDrucksacheId": None,
                "wahlperiode": self.wahlperiode,
                "sponsors": [
                    {"mpInternalId": internal, "role": role} for internal, role in sponsors.items()
                ],
            }
            for vorgang_id, sponsors in self._sponsorships.items()
            if vorgang_id in known
        ]
        if attachable:
            stage.notes.append(str(self.loader.upsert_motion_sponsors(attachable)))
        deferred = len(self._sponsorships) - len(attachable)
        if deferred:
            stage.notes.append(
                f"{deferred} motions' sponsorships reference a procedure outside this run — "
                "they attach when that motion is next fetched"
            )
        self.state.advance(self.wahlperiode, STREAM_MOTIONS, max(seen) if seen else None)

    # -- stage 6: speeches -------------------------------------------------

    def load_speeches(self, report: RunReport, *, since: str | None) -> None:
        """Protocol XML → speech segments and the feed's speech events.

        The protocol *metadata* endpoint is the index — there is no directory
        listing on the document server (§5.2) — and each record carries
        `fundstelle.xml_url` plus an undocumented `xml_hash`. The hash gates
        the ~1.2 MB download: re-fetching an unchanged sitting costs bytes, and
        the WAF counts bytes as well as requests (§2.6).

        ⚠ Never `/plenarprotokoll-text`: its `text` is one flat string per
        sitting, and regex-segmenting it inflates word counts by +53.6 % and
        misses 35 speakers (§5.1).
        """
        stage = report.stage("speeches")
        since = self._window(STREAM_PROTOCOLS, since)
        if self.wahlperiode < FIRST_XML_WAHLPERIODE:
            stage.notes.append(
                f"No protocol XML for WP{self.wahlperiode}; XML starts at "
                f"WP{FIRST_XML_WAHLPERIODE} (§5.2). Speeches are unavailable for this period."
            )
            return

        resolver = self._require_resolver()
        result = BatchResult("speech segments")
        events = BatchResult("feed events")
        seen: list[datetime] = []
        skipped_unchanged = 0
        failed: list[datetime] = []

        for protocol_meta in self.dip.iter_plenarprotokolle(self.wahlperiode, updated_since=since):
            url = protocol_meta.xml_url
            if not url:
                # Bundesrat rows have no XML at all, which is one of the
                # reasons every protocol query passes `f.zuordnung=BT` (§5.1).
                continue
            if self._protocol_unchanged(protocol_meta):
                skipped_unchanged += 1
                seen.append(protocol_meta.aktualisiert)
                continue

            try:
                protocol = self.protocols.fetch(url)
            except BundestagAPIError as error:
                # One unreadable sitting does not end the run; the rest of the
                # period is still worth having. Deliberately *not* added to
                # `seen`: the watermark must not move past a sitting whose
                # speeches were never stored, or the next sync's window starts
                # after it and the API never lists it again.
                stage.notes.append(f"{protocol_meta.dokumentnummer}: {error}")
                failed.append(protocol_meta.aktualisiert)
                continue

            payloads = transform.speech_payloads(protocol, resolver, protocol_id=protocol_meta.id)
            if not payloads:
                # Parsed, but nobody in it resolved. The hash is still recorded
                # — the download succeeded, and re-fetching 1.2 MB nightly to
                # re-derive nothing would be a WAF cost for no gain (§2.6).
                self._record_protocol_hash(protocol_meta)
                seen.append(protocol_meta.aktualisiert)
                continue
            self._flush_promotions()
            result.merge(self.loader.upsert_speeches(payloads))
            events.merge(
                self.loader.add_activity_events(
                    transform.speech_event_payloads(payloads, sitting_title=protocol_meta.titel)
                )
            )
            self._record_protocol_hash(protocol_meta)
            seen.append(protocol_meta.aktualisiert)

        stage.result = result
        stage.notes.append(str(events))
        if skipped_unchanged:
            stage.notes.append(f"{skipped_unchanged} protocols unchanged since the last sync")
        if failed:
            stage.notes.append(
                f"{len(failed)} protocols could not be downloaded — the watermark is held back "
                "so the next sync lists them again"
            )
        # `seen` holds only protocols that were stored or verified unchanged, so
        # a failed download keeps the window open rather than being skipped
        # forever (§11.2).
        self.state.advance(self.wahlperiode, STREAM_PROTOCOLS, _safe_watermark(seen, failed))

    # -- stage 7: votes ----------------------------------------------------

    def load_votes(self, report: RunReport, *, incremental: bool) -> None:
        """Named-vote XLSX sheets → ballots and per-MP votes.

        The only source that records **absences** (§4.2), which is what makes
        it authoritative over the protocol XML's name lists and over
        abgeordnetenwatch.

        The listing ignores every date parameter tried in research (§4.1), so
        an incremental sync cannot ask the server for "ballots since X". It
        pages from the newest and stops at the first ballot it has already
        stored — which is why `incremental` exists rather than a `since`.

        The listing covers the Bundestag's whole history — ~1 015 entries —
        while a run wants one period, so the period is decided from the
        listing's own date *before* the sheet is downloaded. The alternative
        reads the Wahlperiode off the parsed sheet, which means fetching all
        1 015 to keep 90: a thousand needless downloads against a WAF that
        counts bytes (§2.6).

        Rows whose name does not resolve are quarantined by the resolver, not
        dropped (§7.3): a dropped vote row is a vote that silently never
        happened, and it is unrecoverable from any other source.
        """
        stage = report.stage("votes")
        resolver = self._require_resolver()
        sheets = BatchResult("ballots")
        records = BatchResult("vote records")
        events = BatchResult("feed events")
        skipped_pdf_only = 0
        skipped_other_period = 0
        seen_keys = set(self.state.ingested_ballots(self.wahlperiode))
        window = self._mandate_window()

        for link in self.votes.iter_vote_links():
            if not link.has_data_sheet:
                # Machine-readable sheets reach back to roughly WP17; older
                # entries are PDF-only (§4.1). A coverage boundary, not a
                # failure — and counted so the boundary stays visible.
                skipped_pdf_only += 1
                continue
            if not _within(link.date, window):
                skipped_other_period += 1
                continue
            try:
                sheet = self.votes.fetch_sheet(link)
            except BundestagAPIError as error:
                stage.notes.append(f"{link.title}: {error}")
                continue
            if sheet.wahlperiode != self.wahlperiode:
                # The date window is a filter, not a guarantee: a ballot held
                # in the days around a dissolution can fall inside it and still
                # belong to the neighbouring period. The sheet's own
                # Wahlperiode column settles it.
                skipped_other_period += 1
                continue

            key = ballot_key(sheet)
            if incremental and key in seen_keys:
                # The listing is newest-first, so the first already-stored
                # ballot means everything after it is stored too.
                stage.notes.append(f"Reached an already-ingested ballot ({key}) — stopping")
                break

            self._ingest_ballot(sheet, link, resolver, sheets, records, events)
            seen_keys.add(key)
            self.state.record_ballot(self.wahlperiode, key)

        stage.result = records
        stage.notes.append(str(sheets))
        stage.notes.append(str(events))
        if skipped_pdf_only:
            stage.notes.append(
                f"{skipped_pdf_only} ballots are PDF-only (pre-~2012, §4.1) and have no data sheet"
            )
        if skipped_other_period:
            stage.notes.append(
                f"{skipped_other_period} ballots belong to another Wahlperiode "
                "(the listing spans the whole Bundestag)"
            )

    def _ingest_ballot(
        self,
        sheet: VoteSheet,
        link: VoteSheetLink,
        resolver: MPResolver,
        sheets: BatchResult,
        records: BatchResult,
        events: BatchResult,
    ) -> None:
        """One ballot: the sheet, then its records, then the feed events.

        In that order because `upsertVoteRecords` throws when the sheet is
        absent — a record whose ballot is unknown has nothing to be a record
        *of*, and Convex refuses to insert a placeholder that would then have
        no published tally to check against.
        """
        title = link.title or sheet.title or f"Namentliche Abstimmung {ballot_key(sheet)}"
        sheets.record(
            self.loader.upsert_vote_sheet(
                transform.vote_sheet_payload(sheet, title=title, sheet_date=link.date)
            )
        )
        vote_records = transform.vote_record_payloads(sheet, resolver)
        # Built before it is posted, because building it is what discovers a
        # promoted MP — and the roster row has to exist before the vote does.
        self._flush_promotions()
        records.merge(self.loader.upsert_vote_records(vote_records))
        events.merge(
            self.loader.add_activity_events(
                transform.vote_event_payloads(sheet, resolver, title=title)
            )
        )

    # -- stage 8: seating --------------------------------------------------

    def generate_seating(self, report: RunReport) -> None:
        """Regenerate the synthetic hemicycle from the roster.

        ⚠ **Not real seats.** §9 is definitive: no machine-readable seat
        assignment exists anywhere — not in the DIP spec, the Stammdaten DTD,
        the protocol XML, bundestag.de or Wikidata. Only the *distribution* is
        derivable, so Convex places right-sized blocs on a standard arc and the
        note says what that does not mean.

        Last, because the roster is its only input and it must reflect this
        run's version of it.
        """
        stage = report.stage("seating")
        response = self.loader.generate_seating(self.wahlperiode)
        seated = response.get("seated")
        stage.notes.append(
            f"{seated} synthetic seats generated — a visualisation of Fraktion sizes, "
            "not a record of where anyone sits (§9)"
            if seated is not None
            else "seating regenerated"
        )

    # -- helpers -----------------------------------------------------------

    def _window(self, stream: str, since: str | None) -> str | None:
        """The `f.aktualisiert.start` this stage should ask for.

        Resolved per stage rather than once per run, because the stages fail
        independently: a stage whose last run died must re-read the window it
        never finished, even though the stages beside it have moved on. An
        explicit `since` — a hand re-read after an incident — overrides every
        stream's own mark.
        """
        if since is not None:
            return since
        return self.state.since(self.wahlperiode, stream)

    def check_destination(self) -> None:
        """Fail now if the deployment will not accept this key.

        A no-op in a dry run, which writes nothing and so needs no key. Raises
        `ConvexAuthError` otherwise, naming both places the key has to be set —
        the alternative is paying for the whole fetch and writing none of it.
        """
        if self.loader.health():
            return
        raise ConvexError(
            f"The ingestion API at {self.loader.base_url} did not accept this key. "
            "PIPELINE_API_KEY must match the value set on the deployment."
        )

    def _flush_promotions(self) -> int:
        """Write the mandate rows for MPs promoted since the last flush (§7.3).

        The roster goes first (§11.1), but a promotion is discovered *later* —
        by a ballot or a protocol naming someone the snapshot does not record
        in this period. Convex rejects any row naming an MP it has no mandate
        for, and a rejected row fails the whole 500-row batch it travelled in,
        so the roster row has to land before the record that references it.

        Cheap in the normal case: nothing is pending, and this returns without
        a request.
        """
        resolver = self._require_resolver()
        pending = {mp.id for mp in resolver.take_pending_promotions()}
        if not pending:
            return 0
        # Built through `roster_payloads` rather than assembled here, so a
        # promoted MP's row is shaped by exactly the same rules as everyone
        # else's — one definition of what an `mps` row looks like.
        payloads = [p for p in transform.roster_payloads(resolver) if p["stammdatenId"] in pending]
        if payloads:
            self.loader.upsert_mps(payloads)
        return len(payloads)

    def _mandate_window(self) -> tuple[date | None, date | None]:
        """When this Wahlperiode ran, from the roster's own mandate dates.

        Derived rather than tabulated: `MDBWP_VON`/`MDBWP_BIS` already say when
        the period began and ended (§6.2), so a hardcoded table would be a
        second thing to update every election — and wrong for exactly the
        period nobody remembered to add.

        The end is open while the period is current, which is what an MP still
        serving means: `None` there, and `_within` reads it as "no upper
        bound".
        """
        starts: list[date] = []
        ends: list[date] = []
        for mp in self._require_resolver().roster():
            mandate = mp.mandate_for(self.wahlperiode)
            if mandate is None:  # pragma: no cover - `roster()` filters on this
                continue
            if mandate.start_date:
                starts.append(mandate.start_date)
            if mandate.end_date:
                ends.append(mandate.end_date)
            else:
                # One sitting MP is enough to make the period open-ended.
                return (min(starts) if starts else None, None)
        return (min(starts) if starts else None, max(ends) if ends else None)

    def _require_resolver(self) -> MPResolver:
        if self.resolver is None:
            raise RuntimeError(
                "The roster has not been loaded. Every stage joins to it, and the Convex "
                "mutations reject records naming an MP who is not on it (§11.1)."
            )
        return self.resolver

    def _protocol_unchanged(self, meta: Plenarprotokoll) -> bool:
        """Whether this sitting's XML is byte-identical to the last fetch.

        `xml_hash` is undocumented but present on every Bundestag protocol
        (§5.1), and it is the MD5 of the XML — so this is what lets a daily
        sync skip ~1.2 MB per unchanged sitting.
        """
        if not meta.xml_hash:
            return False
        return self.state.protocol_hash(meta.id) == meta.xml_hash

    def _record_protocol_hash(self, meta: Plenarprotokoll) -> None:
        if meta.xml_hash:
            self.state.record_protocol_hash(meta.id, meta.xml_hash)


# --- entry points ---------------------------------------------------------


def init(
    wahlperiode: int = CURRENT_WAHLPERIODE,
    *,
    settings: Settings | None = None,
    dry_run: bool = False,
    pipeline: Pipeline | None = None,
) -> RunReport:
    """Full backfill of the current electoral period.

    Everything, with no `aktualisiert` filter — which for WP21 is 80 537
    activities over ~806 pages plus 90 protocols and every named ballot. At
    §2.6's pacing that is hours, sequentially, by design.
    """
    return run_backfill(
        wahlperiode, settings=settings, dry_run=dry_run, pipeline=pipeline, mode="init"
    )


def backfill(
    wahlperiode: int,
    *,
    settings: Settings | None = None,
    dry_run: bool = False,
    pipeline: Pipeline | None = None,
) -> RunReport:
    """Backfill one named electoral period.

    The same operation as `init` — see the module docstring. Older periods
    return less for structural reasons the stages report rather than hide: no
    committee data before the current one (§6.4), no protocol XML before WP18
    (§5.2), no vote sheets before roughly WP17 (§4.1).
    """
    return run_backfill(
        wahlperiode, settings=settings, dry_run=dry_run, pipeline=pipeline, mode="backfill"
    )


def sync(
    wahlperiode: int = CURRENT_WAHLPERIODE,
    *,
    since: str | None = None,
    settings: Settings | None = None,
    dry_run: bool = False,
    pipeline: Pipeline | None = None,
) -> RunReport:
    """Daily incremental sync — what the system cron runs.

    Filters on `f.aktualisiert.start`, not on `datum`: documents are amended
    retroactively, and a date-based sync silently misses every edit (§2.5).
    The window comes from the watermark of the last run, overlapped by an hour
    for clock skew (§11.2).

    `since` overrides it, for re-reading a window by hand after an incident.
    A fresh host with no watermark does a full fetch rather than starting from
    now — the alternative is a deployment that is permanently missing whatever
    happened before it was first run.
    """
    owned = pipeline is None
    run = pipeline or Pipeline(wahlperiode, settings=settings, dry_run=dry_run)
    report = RunReport(wahlperiode, "sync")
    try:
        # Each stage resolves its own window from its own stream's mark — see
        # `Pipeline._window`. `since` is the manual override, and passing None
        # is what lets the streams diverge, which is the point of having them.
        marks = run.state.stream_watermarks(wahlperiode)
        if since is not None:
            logger.info("Syncing WP%d for changes since %s (manual window)", wahlperiode, since)
        elif marks:
            logger.info("Syncing WP%d from %s", wahlperiode, marks)
        else:
            logger.info("No watermark for WP%d — this sync is a full fetch", wahlperiode)

        _run_stages(run, report, since=since, incremental=True)
    finally:
        _finish(run, report, owned=owned)
    return report


def run_backfill(
    wahlperiode: int,
    *,
    settings: Settings | None = None,
    dry_run: bool = False,
    pipeline: Pipeline | None = None,
    mode: str = "backfill",
) -> RunReport:
    """The body `init` and `backfill` share."""
    owned = pipeline is None
    run = pipeline or Pipeline(wahlperiode, settings=settings, dry_run=dry_run)
    report = RunReport(wahlperiode, mode)
    try:
        _run_stages(run, report, since=None, incremental=False)
    finally:
        _finish(run, report, owned=owned)
    return report


def recompute_scores(
    wahlperiode: int = CURRENT_WAHLPERIODE,
    *,
    month: str | None = None,
    settings: Settings | None = None,
    dry_run: bool = False,
    loader: ConvexLoader | None = None,
) -> int:
    """Rescore a period now, rather than waiting for the nightly cron.

    The scoring itself is Convex's — it reads stored rows, so there is nothing
    for Python to compute (webapp/convex/activityScores.ts). This walks the
    slices the HTTP route pages by, which exist because scoring the whole
    chamber in one transaction would exceed Convex's read limit.

    Worth calling after a backfill: the cron recomputes the *current* month
    plus the period total, so a backfill's older months would otherwise stay at
    zero until something touched them.
    """
    resolved = settings or get_settings()
    owned = loader is None
    client = loader or ConvexLoader(
        resolved.require_convex_http_url(), resolved.pipeline_api_key, dry_run=dry_run
    )
    try:
        scored = client.recompute_scores(wahlperiode, month=month)
        logger.info("Recomputed %d scores for WP%d", scored, wahlperiode)
        return scored
    finally:
        if owned:
            client.close()


def _run_stages(run: Pipeline, report: RunReport, *, since: str | None, incremental: bool) -> None:
    """Run every stage in dependency order, isolating failures after the roster.

    The roster is not isolated: without it nothing else can be written, since
    every Convex mutation rejects a record naming an MP who is not on it. The
    later stages are independent of each other, so one source being down should
    not cost the rest of the run.
    """
    # Before anything is fetched. `/api/pipeline/health` exists for exactly
    # this: a rotated or missing key becomes one clean 401 at the start rather
    # than several thousand of them after hours of sequential fetching (§2.6).
    # Reported like any other failure — the cron reads the report, and a
    # traceback out of `sync()` is not one — but nothing else is attempted,
    # since there is no point fetching for a destination that will not accept
    # a single write.
    _guard(report, "destination", run.check_destination)
    if not report.ok:
        logger.error("The ingestion API rejected this key — nothing was fetched")
        return

    _guard(report, "roster", lambda: run.load_roster(report))
    if run.resolver is None or not run.resolver.roster():
        # Guarded like the rest, but *not* continued past: nothing else can be
        # written without a roster, since every Convex mutation rejects a
        # record naming an MP who is not on one. Attempting the later stages
        # would be several hundred 400s naming an MP that does not exist, which
        # buries the actual problem rather than reporting it.
        logger.error("No roster for WP%d — skipping every dependent stage", run.wahlperiode)
        return

    _guard(report, "dip-persons", lambda: run.link_dip_persons(report))
    _guard(report, "committees", lambda: run.load_committees(report))
    _guard(report, "activities", lambda: run.load_activities(report, since=since))
    _guard(report, "motions", lambda: run.load_motions(report, since=since))
    _guard(report, "speeches", lambda: run.load_speeches(report, since=since))
    _guard(report, "votes", lambda: run.load_votes(report, incremental=incremental))
    _guard(report, "seating", lambda: run.generate_seating(report))


def _guard(report: RunReport, name: str, stage: Any) -> None:
    """Run a stage, recording a failure instead of ending the run.

    The stage appends its own `StageReport` when it starts, so a failure is
    attached to that one where it exists — a stage that failed halfway has
    partial results worth reporting alongside the error.
    """
    before = len(report.stages)
    try:
        stage()
    # Broad on purpose: one source being down must not cost the rest of the run,
    # and the stages after the roster are independent of each other.
    except Exception as error:
        logger.exception("Stage %s failed", name)
        own = report.stages[before] if len(report.stages) > before else report.stage(name)
        own.error = str(error)


def _finish(run: Pipeline, report: RunReport, *, owned: bool) -> None:
    """Persist state and close clients, whatever happened.

    State is written even on a failed run: the stages that *did* finish moved
    the watermark to timestamps they actually saw, and discarding that would
    make the next sync re-read everything they already wrote.
    """
    report.quarantined = len(run.state.quarantine)
    run.state.finish()
    if not run.dry_run:
        save_state(run.settings.state_path, run.state)
    if owned:
        run.close()


def _batched[T](items: Iterable[T], size: int) -> Iterator[list[T]]:
    """Group a stream into lists, without materialising the whole stream.

    `itertools.batched` exists in 3.12 and returns tuples; this returns lists
    because every consumer here builds one anyway, and the generator form is
    what keeps an 80 537-record fetch streaming.
    """
    batch: list[T] = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _safe_watermark(stored: list[datetime], failed: list[datetime]) -> datetime | None:
    """How far the watermark may move given what actually landed.

    The rule §11.2 implies but does not spell out: the mark may advance to the
    newest record *stored*, but never past the oldest record that **failed**.

    Both halves matter. Advancing to the newest fetched record would skip a
    sitting whose download the WAF blocked — the next window starts after it,
    the API never lists it again, and the speeches are gone with no error
    anywhere. Refusing to advance at all would re-read the whole period every
    night, which is its own way of being blocked (§2.6).

    So a failure pins the mark just below itself, and everything older than it
    is banked. `None` means nothing may be banked yet.
    """
    if not stored:
        return None
    highest = max(stored)
    if not failed:
        return highest
    oldest_failure = min(failed)
    banked = [when for when in stored if when < oldest_failure]
    return max(banked) if banked else None


def _within(when: date | None, window: tuple[date | None, date | None]) -> bool:
    """Whether a listing date falls inside a Wahlperiode's span.

    An undated entry passes. The listing leaves the date cell empty for the
    pre-2012 rows (§4.1), and those are PDF-only anyway — but a *dated* filter
    that rejected unknown dates would silently skip any future row whose
    formatting this parser has not seen, which is the wrong way to fail on the
    only source of absences.
    """
    if when is None:
        return True
    start, end = window
    if start and when < start:
        return False
    return not (end and when > end)


__all__ = [
    "CURRENT_WAHLPERIODE",
    "Pipeline",
    "RunReport",
    "StageReport",
    "backfill",
    "init",
    "recompute_scores",
    "sync",
]
