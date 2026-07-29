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
    3. bundestag.de + abgeordnetenwatch → portraits, occupation, contact
    4. DIP /aktivitaet   → activities, questions, sponsors, the feed
    5. DIP /vorgang + /drucksache → motions
    6. Protocol XML      → speeches
    7. Named-vote XLSX   → ballots and per-MP votes (the only absences, §4.2)

Stages 3–7 depend on 1 and 2 and on nothing else, so a failure in one does not
invalidate the others — `run_backfill` reports per stage and continues.

Stage 3 is *ordered* after 2 rather than merely dependent on it: both write the
roster, and the columns they add ride on the same `mps` upsert
(`transform.mp_payload`), so going second means this run's rows carry the
enrichment as well as the crosswalk rather than only the crosswalk.

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

from bundestrack.api.abgeordnetenwatch import (
    AbgeordnetenwatchClient,
    parse_mandates,
    parse_politicians,
    politician_stammdaten_index,
)
from bundestrack.api.base import BundestagAPIError
from bundestrack.api.dip import DIPClient
from bundestrack.api.mp_profiles import MPProfileClient
from bundestrack.api.protocols import ProtocolClient
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.api.votes import VoteClient
from bundestrack.config import Settings, get_settings
from bundestrack.models.dip import Aktivitaet, Plenarprotokoll
from bundestrack.models.enrichment import MPProfileLink, normalise_printed_name
from bundestrack.models.votes import VoteSheet, VoteSheetLink
from bundestrack.pipeline import transform
from bundestrack.pipeline.join import MPResolver
from bundestrack.pipeline.load import BatchResult, ConvexLoader
from bundestrack.pipeline.state import (
    CONTACT_TTL,
    STREAM_ACTIVITIES,
    STREAM_MOTIONS,
    STREAM_PROTOCOLS,
    STREAM_REFERRALS,
    SyncState,
    load_state,
    save_state,
)

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

#: Activities per run above which zero §31 declarations counts as drift.
#: A period-scale run passes this comfortably; an incremental sync of a few
#: hundred activities does not, so a small stream with no declarations reads
#: as an ordinary quiet slice rather than an alarm. The base rate is roughly
#: 2–3 % of activities (`docs/api-research.md` §4.5), so 2 000 activities with
#: none is well past the noise floor. See L2 in
#: `/tmp/review-source-backed-ingestion-gaps.md`.
EXPLANATION_DRIFT_THRESHOLD = 2000


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
        full: bool = False,
        dip: DIPClient | None = None,
        stammdaten: StammdatenClient | None = None,
        protocols: ProtocolClient | None = None,
        votes: VoteClient | None = None,
        profiles: MPProfileClient | None = None,
        abgeordnetenwatch: AbgeordnetenwatchClient | None = None,
        loader: ConvexLoader | None = None,
        state: SyncState | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.wahlperiode = wahlperiode
        self.dry_run = dry_run
        #: Ignore the stored watermarks and fetch the period whole. What makes
        #: `backfill` mean "all of it" rather than "whatever a previous attempt
        #: did not already reach" — see `_window`.
        self.full = full
        self.state = state if state is not None else load_state(self.settings.state_path)

        self.dip = dip or DIPClient(
            self.settings.bundestag_api_key or None,
            base_url=self.settings.bundestag_api_base_url,
        )
        self.stammdaten = stammdaten or StammdatenClient()
        self.protocols = protocols or ProtocolClient()
        self.votes = votes or VoteClient()
        self.profiles = profiles or MPProfileClient()
        self.abgeordnetenwatch = abgeordnetenwatch or AbgeordnetenwatchClient()
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
        #: `(sitting, yes, no, abstain)` → `dipVorgangId`, accumulated by the
        #: referral stage and consumed by the vote stage. The same shape and the
        #: same reason as `_sponsorships` above: the ballot's procedure is known
        #: while `/vorgangsposition` streams past, and the sheets that need it
        #: are downloaded two stages later. See `transform.ballot_vorgang_index`
        #: for why the key is a tally — the two sources share no id at all.
        self._ballot_vorgaenge: dict[transform.BallotKey, str] = {}
        #: Ballot keys claimed by two different procedures across *any two*
        #: batches of the referral stream. Scoped per run rather than per batch,
        #: because `ballot_vorgang_index` sees only the batch it is called with
        #: — it will drop an intra-batch collision, but WP19's ~166 batches of
        #: 500 mean two positions with the same `(sitting, tally)` regularly
        #: land in different batches, and a naive `.update()` between them
        #: would silently overwrite. Once a key lands here it never leaves,
        #: because a third arrival cannot resolve the original two: an
        #: ambiguous join is not a join, and a wrong `dipVorgangId` would
        #: attach a member's §31 declaration to a vote they did not cast it on.
        self._ambiguous_ballot_keys: set[transform.BallotKey] = set()

    def close(self) -> None:
        for client in (
            self.dip,
            self.stammdaten,
            self.protocols,
            self.votes,
            self.profiles,
            self.abgeordnetenwatch,
            self.loader,
        ):
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

    # -- stage 3: enrichment ----------------------------------------------

    def load_enrichment(self, report: RunReport, *, full: bool = False) -> None:
        """Portraits, occupation, education and contact details onto the roster.

        Three sources at three different costs, which is why they are one stage
        rather than three:

        1. **Portraits** — the bundestag.de MP listing, ~54 requests of ~28 KB
           for all 639. Cheap enough to re-read every sync, and it is the only
           source of the photographer credit that the licence requires be shown
           beside the image (§6.5, `models.enrichment.MPPortrait`).
        2. **Occupation and education** — abgeordnetenwatch, ~19 requests for
           the whole filtered collection. The one external join that needs no
           name matching: `ext_id_bundestagsverwaltung` *is* the Stammdaten id.
        3. **Contact** — one ~280 KB biography page per MP. 639 of those is
           ~175 MB through a WAF that counts bytes (§2.6), so this is gated on
           `state.contact_is_stale` and a daily sync refreshes a thirtieth of
           the roster rather than all of it. That gate is scoped to *this*
           period (`state.contact_key`): the stamps are per mandate, so a
           historical backfill cannot report the current chamber as fresh.

        Everything is attached to the resolver rather than posted directly, and
        the roster is re-posted at the end. That is not an optimisation: the
        `mps` upsert is the write that carries these columns
        (`transform.mp_payload`), and it runs again on the next sync — so a
        separately-written `photoUrl` would survive exactly until then.

        The three sources arrive at different rates on purpose, and what makes
        that safe is that `mp_payload` **omits** a column this run did not
        resolve rather than sending it as null (see the ⚠ there). Without that,
        the cheap sources would blank the expensive one on every sync — which
        is what took every portrait and contact block in production to zero on
        2026-07-29.

        Placed after `link_dip_persons` for the same reason it re-posts: that
        stage already re-posts the roster to patch in the crosswalk, and going
        second means this run's roster rows carry both rather than the
        crosswalk alone.
        """
        stage = report.stage("enrichment")
        resolver = self._require_resolver()
        roster_size = len(resolver.internal_ids())

        profiles = list(self.profiles.iter_profiles())
        matched, unmatched = transform.portrait_enrichment(profiles, resolver)
        resolver.attach_enrichment(matched)
        with_portrait = sum(1 for entry in matched if entry.portrait)
        stage.notes.append(
            f"{len(profiles)} listed MPs → {len(matched)} matched to the roster, "
            f"{with_portrait} with a credited portrait"
        )
        if unmatched:
            # Not an error, and specifically not a reason to fail the stage:
            # the listing is the Bundestag's own roster, so a name here that
            # resolves to nobody means the Stammdaten snapshot is behind
            # (§7.3). `portrait_enrichment` has quarantined each one, so the
            # retry this note describes is now something the code does rather
            # than something it asserts.
            stage.notes.append(
                f"{len(unmatched)} listed names match no roster MP and are quarantined for a "
                f"later sync — the Stammdaten snapshot is behind (§7.3): "
                f"{', '.join(sorted(unmatched)[:6])}" + (" …" if len(unmatched) > 6 else "")
            )

        # Fetched once and used twice. The rows carry both the enrichment
        # columns and the `politician.id` → Stammdaten-id bridge that the
        # mandate reconciliation below needs, and this collection is ~19
        # requests against a source that answers 429 under load — so paging it
        # a second time for the same bytes would be the one avoidable cost in
        # a stage that is otherwise all necessary ones.
        politician_rows = list(self.abgeordnetenwatch.iter_politicians())
        politicians = parse_politicians(politician_rows)
        occupations = transform.politician_enrichment(politicians, resolver)
        resolver.attach_enrichment(occupations)
        stage.notes.append(
            f"{len(politicians)} abgeordnetenwatch politicians carry a Stammdaten id → "
            f"{len(occupations)} roster MPs with occupation or education"
        )

        stage.notes.append(self._reconcile_mandates(resolver, politician_rows))

        stage.notes.append(self._load_contacts(profiles, resolver, full=full))

        # The write. Everything above only populated the resolver.
        stage.result = self.loader.upsert_mps(transform.roster_payloads(resolver))
        unenriched = resolver.unenriched_internal_ids()
        if unenriched:
            stage.notes.append(
                f"{len(unenriched)} of {roster_size} roster MPs have no enrichment at all — "
                "they retry on the next sync (§7.3)"
            )

    def _reconcile_mandates(
        self, resolver: MPResolver, politician_rows: Sequence[dict[str, Any]]
    ) -> str:
        """Check the roster against abgeordnetenwatch's mandate list (§7.3).

        ⚠ **Read-only.** It writes no MP, and above all deletes none: MdB-
        Stammdaten is the roster (§6.1) and this is a community source. What it
        is uniquely good for is being *fresher* — the ZIP is a periodic snapshot
        that lags mid-term successions, and this endpoint publishes each one
        with a start date and a note naming who was replaced.

        So the output is a note an operator can act on: *these members are
        sitting and this deployment's roster does not have them, since this
        date*. Before this ran, the same fact surfaced weeks later as a vote row
        that failed to resolve, with nothing saying why.

        A period abgeordnetenwatch does not cover is not an error — its
        coverage starts at WP16 (§4.3) and Bundestrack backfills to WP14 — so
        that case returns a note rather than raising.
        """
        try:
            mandates = parse_mandates(
                self.abgeordnetenwatch.get_mandates(self.wahlperiode),
                politician_stammdaten_index(politician_rows),
            )
        except ValueError as error:
            # `_legislature` raises for a period this source does not cover.
            return f"No abgeordnetenwatch mandate list for WP{self.wahlperiode}: {error}"

        report = resolver.reconcile_mandates(mandates)
        note = report.summary()
        for gap in report.missing_from_roster[:6]:
            # The published note verbatim, because it names the predecessor and
            # the date — the two things that say how far behind the dump is.
            note += f"\n      ⚠ not on the roster: {gap.name} ({gap.start_date or 'no date'})"
            if gap.info:
                note += f" — {gap.info}"
        if len(report.missing_from_roster) > 6:
            note += f"\n      … and {len(report.missing_from_roster) - 6} more"
        return note

    def _load_contacts(
        self, profiles: Sequence[MPProfileLink], resolver: MPResolver, *, full: bool
    ) -> str:
        """Biography pages for the MPs whose contact block is missing or stale.

        The expensive half of the enrich stage, and the reason the stage has a
        `full` flag: a backfill wants all 639 pages, a daily sync wants the
        handful that have aged past `CONTACT_TTL`.

        One page failing is noted and stepped over rather than ending the
        stage. Its timestamp is not recorded, so the next sync retries it —
        the same rule `load_speeches` applies to an unreadable protocol.

        ⚠ **A page that parsed to nothing counts as a failure, not a success.**
        Every WP21 MP has a contact form — `form_url` alone makes a block
        non-empty, and 623 of 635 carried one when production was last measured
        — so an entirely empty result is this pipeline failing to read the page,
        not the Bundestag publishing nothing. Stamping it anyway is what made
        the 12 empty blocks permanent: marked fresh for `CONTACT_TTL`, they
        were never retried, and the stage reported them as pages successfully
        fetched. `MPContact.is_empty` is therefore the retry condition as well
        as a reporting one.
        """
        due: list[tuple[str, str]] = []
        fresh = 0
        for profile in profiles:
            name = normalise_printed_name(profile.printed_name)
            if name is None:
                continue
            internal = resolver.resolve_printed_name(name.nachname, name.vorname, name.particle)
            if internal is None:
                # Counted by the caller's "match no roster MP" note, not here:
                # an unmatched name has no contact block to be fresh or stale,
                # and folding it into the skipped count would report a name the
                # roster has never heard of as an MP whose page was up to date.
                # `portrait_enrichment` has already quarantined it (§7.3).
                continue
            if full or self.state.contact_is_stale(internal, self.wahlperiode):
                due.append((internal, profile.profile_url))
            else:
                fresh += 1

        fetched = 0
        empty = 0
        failed = 0
        for internal, url in due:
            try:
                contact = self.profiles.fetch_contact(url)
            except BundestagAPIError as error:
                failed += 1
                logger.warning("Contact page %s failed: %s", url, error)
                continue
            if contact.is_empty:
                # Not stamped, so the next sync retries it. See the ⚠ above:
                # every sitting member has at least a contact form, so nothing
                # parsed means the page was not read — a markup change, a
                # truncated response, a WAF body that answered 200.
                empty += 1
                logger.warning(
                    "Contact page %s parsed to an empty block — not stamping it, so the next "
                    "sync retries. Every sitting MP publishes at least a contact form, so this "
                    "is a page this pipeline failed to read rather than a member with none.",
                    url,
                )
                continue
            resolver.attach_enrichment([transform.contact_enrichment(internal, contact)])
            # Stamped for a block that parsed, however sparse: about half of MPs
            # list no constituency office, and re-reading 280 KB every sync to
            # rediscover that is the cost this gate exists to avoid. A form URL
            # and nothing else is a real, complete answer.
            self.state.record_contact_fetch(internal, self.wahlperiode)
            fetched += 1

        retrying = failed + empty
        note = f"contact: {fetched} biography pages fetched with published details" + (
            f", {retrying} published nothing or failed and retry next sync" if retrying else ""
        )
        return note + (f", {fresh} still fresh (<{CONTACT_TTL.days} days)" if fresh else "")

    # -- stage 4: committees ----------------------------------------------

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

    # -- stage 4b: committee referrals -------------------------------------

    def load_committee_referrals(self, report: RunReport, *, since: str | None) -> None:
        """DIP `/vorgangsposition` → which committees each bill was referred to.

        ⚠ **A separate claim from `load_committees` above, not a backfill of
        it.** A referral names a committee and a document and no person, so it
        cannot recover the committee *membership* that §6.4 says was never
        published for WP14–20. The two write different tables on purpose; see
        webapp/convex/committeeReferrals.ts.

        Streamed in batches like the activities: WP19 alone is 82 855 positions,
        and under a tenth of them refer anything, so collecting the corpus to
        keep 8 % of it is the whole period in memory for nothing.

        **It also builds the ballot → Vorgang index**, from the same pass. Every
        named vote is a `Vorgangsposition` too, so the steps this walk already
        reads carry both facts, and a second sweep of the same 23 800-82 900
        records through the WAF would buy nothing (§2.6). See
        `transform.ballot_vorgang_index` for the join, and `load_votes`, which
        consumes it.
        """
        stage = report.stage("committee-referrals")
        since = self._window(STREAM_REFERRALS, since)
        result = BatchResult("committee referrals")
        positions = 0
        named = 0
        seen: list[datetime] = []

        for batch in _batched(
            self.dip.iter_vorgangspositionen(self.wahlperiode, updated_since=since), STREAM_BATCH
        ):
            positions += len(batch)
            seen.extend(p.aktualisiert for p in batch)
            payloads = list(
                transform.committee_referral_payloads(batch, wahlperiode=self.wahlperiode)
            )
            if payloads:
                result.merge(self.loader.upsert_committee_referrals(payloads))

            # Accumulated as the steps stream past rather than by keeping them:
            # only the `(sitting, tally) → Vorgang` entry is wanted, and holding
            # 82 855 models to re-read one stage later is the period in memory.
            #
            # ⚠ Merged one key at a time rather than by `.update()`, because a
            # blanket update cannot see a collision the *next* batch introduces
            # against an entry the previous one left behind — and WP19 is
            # ~166 batches, so cross-batch collisions are the rule for any
            # `(sitting, tally)` shared by more than one procedure. The
            # invariant `ballot_vorgang_index`'s docstring commits to — an
            # ambiguous join is not a join — has to hold at the run level, not
            # only the batch level. See M1 in
            # `/tmp/review-source-backed-ingestion-gaps.md`.
            found = transform.ballot_vorgang_index(batch)
            named += len(found)
            for key, vorgang_id in found.items():
                if key in self._ambiguous_ballot_keys:
                    continue
                existing = self._ballot_vorgaenge.get(key)
                if existing is not None and existing != vorgang_id:
                    logger.warning(
                        "Ballot key %s claimed by procedures %s and %s across "
                        "batches — dropping the join",
                        key,
                        existing,
                        vorgang_id,
                    )
                    self._ballot_vorgaenge.pop(key, None)
                    self._ambiguous_ballot_keys.add(key)
                    continue
                self._ballot_vorgaenge[key] = vorgang_id

        stage.result = result
        stage.notes.append(
            f"{positions} procedure steps scanned. A referral is a fact about a bill, not "
            "about any member — it is not committee membership (§6.4)"
        )
        stage.notes.append(
            f"{named} named-vote steps indexed by (sitting, tally) for the ballot join"
        )
        self.state.advance(self.wahlperiode, STREAM_REFERRALS, max(seen) if seen else None)

    # -- stage 5: activities ----------------------------------------------

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

        §31 vote explanations ride this stream too, rather than getting a fetch
        of their own: they *are* activities — `aktivitaetsart = "Schriftliche
        Erklärung gem. § 31 Geschäftsordnung BT"` — so a second pass would be
        the same 806 pages through the WAF for records this one has already
        read.
        """
        stage = report.stage("activities")
        since = self._window(STREAM_ACTIVITIES, since)
        resolver = self._require_resolver()
        result = BatchResult("activities")
        questions = BatchResult("questions")
        events = BatchResult("feed events")
        explanations = BatchResult("vote explanations")
        seen: list[datetime] = []
        # Activities *received* from DIP, before the roster crosswalk skips
        # any. Counted separately from `result.written` because the drift
        # check reads what the stream carried — dry-run and quarantined rows
        # never reach `result.written` but they were still activities the
        # source published, and the drift is about the stream.
        activities_seen = 0
        explanations_seen = 0

        for batch in _batched(
            self.dip.iter_aktivitaeten(self.wahlperiode, updated_since=since), STREAM_BATCH
        ):
            activities_seen += len(batch)
            seen.extend(a.aktualisiert for a in batch)
            # Sponsorships are accumulated as they stream past, not by keeping
            # the activities: 80 537 models held to be re-read one stage later
            # is the whole backfill in memory at once, and only the
            # `(Vorgang, MP, role)` triple is needed.
            self._collect_sponsorships(batch, resolver)

            payloads = list(transform.activity_payloads(batch, resolver))
            result.skipped += len(batch) - len(payloads)
            if payloads:
                result.merge(self.loader.upsert_activities(payloads))

            question_payloads = list(transform.question_payloads(batch, resolver))
            if question_payloads:
                questions.merge(self.loader.upsert_questions(question_payloads))

            event_payloads = list(transform.activity_event_payloads(batch, resolver))
            if event_payloads:
                events.merge(self.loader.add_activity_events(event_payloads))

            explanation_payloads = list(transform.vote_explanation_payloads(batch, resolver))
            explanations_seen += len(explanation_payloads)
            if explanation_payloads:
                explanations.merge(self.loader.upsert_vote_explanations(explanation_payloads))

        stage.result = result
        stage.notes.append(str(questions))
        stage.notes.append(str(events))
        stage.notes.append(str(explanations))
        if result.skipped:
            stage.notes.append(
                f"{result.skipped} activities name a DIP person with no roster match — "
                "they attach on a later sync once the crosswalk resolves (§7.2)"
            )
        # A substantial activity stream that yields zero §31 declarations is the
        # exact drift GAP-018 was written to catch — every §31 declaration in
        # DIP's history has been an `/aktivitaet`, so a stream of `N` activities
        # with zero declarations means either the predicate stopped matching
        # (DIP renamed the kind, as it has already done once — §5.1) or a
        # source integration silently regressed. Fires on 2 000 rather than
        # 100 because incremental syncs legitimately return a handful of
        # activities with no declarations among them; the base rate is roughly
        # 2–3 % of activities but variance is high per sitting. Reads the
        # *seen* counts, not `result.written`, because dry runs and quarantined
        # rows never reach the loader — but the drift is about what the source
        # published, not what Convex ended up storing. See L2 in
        # `/tmp/review-source-backed-ingestion-gaps.md`.
        if activities_seen >= EXPLANATION_DRIFT_THRESHOLD and explanations_seen == 0:
            note = (
                f"⚠ {activities_seen} activities scanned with 0 §31 declarations. "
                "The base rate is 2–3 % of the stream — check `is_vote_explanation` "
                "against a fresh page of `aktivitaetsart` (docs/api-research.md §5.1)"
            )
            logger.warning(note)
            stage.notes.append(note)
        self.state.advance(self.wahlperiode, STREAM_ACTIVITIES, max(seen) if seen else None)

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

    # -- stage 6: motions --------------------------------------------------

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
            payloads.append(transform.motion_from_drucksache(drucksache))

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

    # -- stage 7: speeches -------------------------------------------------

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

        for protocol_meta in self.dip.iter_plenarprotokolle(self.wahlperiode, updated_since=since):
            seen.append(protocol_meta.aktualisiert)
            url = protocol_meta.xml_url
            if not url:
                # Bundesrat rows have no XML at all, which is one of the
                # reasons every protocol query passes `f.zuordnung=BT` (§5.1).
                continue
            if self._protocol_unchanged(protocol_meta):
                skipped_unchanged += 1
                continue

            try:
                protocol = self.protocols.fetch(url)
            except BundestagAPIError as error:
                # One unreadable sitting does not end the run; the rest of the
                # period is still worth having, and the next sync retries it
                # because its hash was never recorded.
                stage.notes.append(f"{protocol_meta.dokumentnummer}: {error}")
                continue

            payloads = transform.speech_payloads(protocol, resolver, protocol_id=protocol_meta.id)
            if not payloads:
                continue
            result.merge(self.loader.upsert_speeches(payloads))
            events.merge(
                self.loader.add_activity_events(
                    transform.speech_event_payloads(payloads, sitting_title=protocol_meta.titel)
                )
            )
            self._record_protocol_hash(protocol_meta)

        stage.result = result
        stage.notes.append(str(events))
        if skipped_unchanged:
            stage.notes.append(f"{skipped_unchanged} protocols unchanged since the last sync")
        self.state.advance(self.wahlperiode, STREAM_PROTOCOLS, max(seen) if seen else None)

    # -- stage 8: votes ----------------------------------------------------

    def load_votes(self, report: RunReport, *, incremental: bool) -> None:
        """Named-vote XLSX sheets → ballots and per-MP votes.

        The only source that records **absences** (§4.2), which is what makes
        it authoritative over the protocol XML's name lists and over
        abgeordnetenwatch.

        The listing ignores every date parameter tried in research (§4.1), so
        an incremental sync cannot ask the server for "ballots since X". It
        pages from the newest and stops at the first ballot it has already
        stored — which is why `incremental` exists rather than a `since`.

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
        skipped_out_of_period = 0
        seen_keys = set(self.state.ingested_ballots(self.wahlperiode))
        window = resolver.dump.wahlperiode_window(self.wahlperiode)

        for link in self.votes.iter_vote_links():
            if not link.has_data_sheet:
                # Machine-readable sheets reach back to roughly WP17; older
                # entries are PDF-only (§4.1). A coverage boundary, not a
                # failure — and counted so the boundary stays visible.
                skipped_pdf_only += 1
                continue
            if _outside_period(link.date, window):
                # The listing is every ballot since 1949 and carries no period
                # filter, so without this a WP18 backfill downloads ~500 sheets
                # of ~200 KB to keep the handful that match. The sheet's own
                # `Wahlperiode` column stays the authority below — this only
                # declines to pay for a download whose date already says it
                # cannot be ours.
                skipped_out_of_period += 1
                continue
            try:
                sheet = self.votes.fetch_sheet(link)
            except BundestagAPIError as error:
                stage.notes.append(f"{link.title}: {error}")
                continue
            if sheet.wahlperiode != self.wahlperiode:
                continue

            key = _ballot_key(sheet)
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
        if skipped_out_of_period:
            stage.notes.append(
                f"{skipped_out_of_period} ballots are dated outside WP{self.wahlperiode} "
                "and were not downloaded"
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
        title = link.title or sheet.title or f"Namentliche Abstimmung {_ballot_key(sheet)}"
        sheets.record(
            _as_batch(
                self.loader.upsert_vote_sheet(
                    transform.vote_sheet_payload(
                        sheet,
                        title=title,
                        sheet_date=link.date,
                        # Built by the referral stage from the same
                        # `/vorgangsposition` pass. None when that stage did not
                        # run, or when this ballot is one of the ~6 % DIP files
                        # under a different sitting or tally — both mean "no
                        # procedure", which is what the column stores.
                        dip_vorgang_id=self._ballot_vorgaenge.get(transform.ballot_key(sheet)),
                    )
                )
            )
        )
        records.merge(
            self.loader.upsert_vote_records(transform.vote_record_payloads(sheet, resolver))
        )
        events.merge(
            self.loader.add_activity_events(
                transform.vote_event_payloads(sheet, resolver, title=title)
            )
        )

    # -- stage 8b: the vote-record scope migration -------------------------

    def backfill_vote_scope(self, report: RunReport) -> None:
        """Copy each vote record's ballot period and date onto the record.

        The migration for the period-scoped vote index — see
        `ConvexLoader.backfill_vote_record_scope`. Runs here, immediately after
        the ballots and immediately *before* the dissent roll-up, because that
        roll-up and the score recomputation both read votes through the new
        index: a record this has not reached is absent from those reads, which
        undercounts rather than mis-attributes, but undercounts silently.

        ⚠ Deployment-wide rather than period-scoped, so on a steady-state sync it
        finds nothing and costs one request. It stays in the run anyway: the rows
        it repairs are the ones nobody knows are there, and the alternative is a
        one-off command somebody has to remember after every historical backfill.
        """
        stage = report.stage("vote-scope")
        migrated = self.loader.backfill_vote_record_scope()
        stage.notes.append(
            f"{migrated} vote record(s) given their ballot's period and date"
            if migrated
            else "every vote record already carries its ballot's period"
        )

    # -- stage 8c: the dissent tally ---------------------------------------

    def backfill_dissent(self, report: RunReport) -> None:
        """Fill in the dissent flags for ballots that predate them.

        Whether a vote broke with the voter's own group depends on how the rest
        of their group voted in the same division, so Convex decides it when the
        ballot lands and stores it (webapp/convex/votes.ts). Ballots ingested
        before that existed carry no flag, and an unflagged ballot is *missing*
        from the tally rather than counted as a loyal vote — so a period-wide
        figure is wrong until this has run once.

        Runs after `load_votes` because that is what produces the ballots it
        reads, and every ballot this run just posted has already been flagged by
        the ingest itself. So on a steady-state sync this walks the period and
        changes nothing, which is cheap and is the point: it is also the repair
        for a tally that has drifted, and there is no way to know it has without
        recomputing it.

        ⚠ The work is **scheduled, not completed**, by the time this returns. The
        route hands each ballot's refresh and each roster slice's roll-up to
        Convex's scheduler so that neither shares a transaction with the walk —
        which is what stopped the old form accumulating three ballots' reads into
        one transaction, and what stopped every ballot writing all ~630 tally
        rows. So the count below is what was *dispatched*; verify the outcome by
        reading `votes:voteScopeCoverage` and the tallies rather than by trusting
        this note.
        """
        stage = report.stage("dissent")
        rolled_up = self.loader.backfill_dissent(self.wahlperiode)
        stage.notes.append(
            f"dissent roll-up scheduled for {rolled_up} members"
            if rolled_up
            else "no members to roll up — the period has no roster"
        )

    # -- stage 9: seating --------------------------------------------------

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

        `full` returns None regardless, which is what makes a re-run of
        `backfill` fetch the period again rather than resume. The distinction
        is not academic: a backfill that dies at the WAF leaves a watermark at
        whatever it *had* read, and `aktualisiert` order is not `datum` order —
        so resuming from that mark fetches the records amended since, not the
        records not yet seen, and the rest of the period is silently never
        fetched by any later run either. Only an explicit `since` overrides it,
        because that is a human asking for a window by name.
        """
        if since is not None:
            return since
        if self.full:
            return None
        return self.state.since(self.wahlperiode, stream)

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
    run = pipeline or Pipeline(wahlperiode, settings=settings, dry_run=dry_run, full=True)
    report = RunReport(wahlperiode, mode)
    try:
        # `full` on the run rather than only on a fresh `Pipeline`: an injected
        # one (the tests, and any caller reusing a client) must mean the same
        # thing by "backfill" as the CLI does.
        run.full = True
        _run_stages(run, report, since=None, incremental=False)
    finally:
        _finish(run, report, owned=owned)
    return report


def months_in(start: date | None, end: date | None) -> list[str]:
    """Every `YYYY-MM` from `start` to `end` inclusive.

    Zero-padded, because `activityScores.monthWindow` rejects anything else —
    and would be right to: `"2021-6"` builds bounds that sort above every real
    date in the year, so the month scores zero and nothing errors.

    An open or unknown bound yields nothing rather than guessing an end. The
    caller is scoring a period it has just ingested; a period whose extent it
    cannot state is one it should not invent months for.
    """
    if start is None or end is None:
        return []
    months: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def backfill_vote_vorgang(
    wahlperiode: int,
    *,
    settings: Settings | None = None,
    dry_run: bool = False,
    pipeline: Pipeline | None = None,
    max_pages: int = 200,
) -> dict[str, int]:
    """Patch late `dipVorgangId` links onto already-ingested ballots (L3).

    A bounded, idempotent alternative to `--full` backfill for the one class of
    miss that `sync` cannot repair on its own: a ballot ingested *before* its
    referring `Vorgangsposition` surfaced in the referrals window lands with
    `dipVorgangId` absent, is added to `state.ingested_ballot_keys`, and an
    incremental sync never revisits it (`load_votes` stops at the first stored
    key). Without this route, the fix is a whole-period ballot re-ingestion,
    which is separately unsafe on a populated table (M2's failure mode) and
    costs the whole listing over the WAF.

    What this does instead:

    1. Walks the referral stream once, populating `_ballot_vorgaenge` with
       every `(sitting, tally) → vorgang_id` DIP publishes for the period.
       Uses the same M1-safe cross-batch merge as the referral stage.
    2. Pages through Convex's `voteSheetsMissingVorgang` for the period.
    3. For each unresolved sheet, joins its `(sitzungnr, yes, no, abstain)`
       against the map and — if resolved — sends a patch.
    4. Batches patches to `votes/backfill-vorgang`, which never writes null
       and skips a row that already carries the same value or a different
       one (see `backfillVoteSheetVorgang`'s `conflicts` counter).

    Returns a dict with `sheets_scanned`, `patches_sent`, `patched`,
    `unchanged`, `conflicts`, `unknown` — so the CLI can print a summary and
    an operator sees a `conflicts > 0` on a run that was supposed to be a
    no-op reassignment.

    ⚠ **Read-only where possible.** A `conflicts` row is left as-is; changing
    a ballot's stored Vorgang is a migration and needs to be an explicit act,
    not a side effect of running this. The route enforces it at the Convex
    end; this function does not paper over it here.

    ⚠ **`full=True` on the Pipeline is load-bearing** and the reason this
    route works at all (NEW-H1 in `/tmp/rereview-source-backed-ingestion-gaps.md`).
    Without it, `load_committee_referrals` would apply the daily sync's
    `STREAM_REFERRALS` watermark to its DIP fetch — and the whole point of
    this route is to catch ballots whose referring `Vorgangsposition` is
    *older* than that watermark, so a windowed fetch is precisely the wrong
    thing.

    ⚠ **The `STREAM_REFERRALS` watermark is preserved** (snapshot before,
    restored after — see `SyncState.restore_watermark`). This is a
    maintenance route that re-reads the whole period; advancing the daily
    sync's own mark would risk shrinking a future sync's window past a real
    record if the two ever raced.
    """
    owned = pipeline is None
    # `full=True` — see the note above. Without it, `load_committee_referrals`
    # windows its fetch on the daily sync's watermark, and the referral
    # records that would have populated `_ballot_vorgaenge` for late-arriving
    # ballots (the exact records this route was written to catch) are the
    # ones that fall outside that window.
    run = pipeline or Pipeline(wahlperiode, settings=settings, dry_run=dry_run, full=True)
    # An injected `pipeline` must also mean "backfill" the same way the CLI
    # does; a caller reusing a Pipeline for tests should not silently get
    # different fetch semantics from the CLI path.
    run.full = True
    report = RunReport(wahlperiode, "backfill-vote-vorgang")
    totals = {
        "sheets_scanned": 0,
        "patches_sent": 0,
        "patched": 0,
        "unchanged": 0,
        "conflicts": 0,
        "unknown": 0,
    }
    # Snapshot the referral mark BEFORE the walk. `load_committee_referrals`
    # calls `state.advance(...)`, and `_finish` persists it — but this route
    # is not the daily sync, and moving that mark forward here would let the
    # next real sync compute `since = max_seen - OVERLAP`, skipping any
    # referral added between the two runs that fell outside the OVERLAP.
    watermark_before = run.state.watermark(wahlperiode, STREAM_REFERRALS)
    try:
        # The roster must exist before anything else runs — this stage does not
        # need it directly, but the referral walk shares `_ballot_vorgaenge`
        # with `_ingest_ballot` and the shared Pipeline instance expects a
        # populated resolver on nearly every path.
        _guard(report, "roster", lambda: run.load_roster(report))
        if run.resolver is None or not run.resolver.roster():
            logger.error("No roster for WP%d — cannot backfill Vorgang links", wahlperiode)
            return totals

        _guard(
            report,
            "committee-referrals",
            lambda: run.load_committee_referrals(report, since=None),
        )
        if not run._ballot_vorgaenge:
            logger.warning(
                "Referral walk found no ballot → Vorgang keys for WP%d — nothing to patch",
                wahlperiode,
            )
            return totals

        cursor: dict[str, int] | None = None
        for _ in range(max_pages):
            response = run.loader.missing_vote_vorgang(wahlperiode, cursor)
            sheets = response.get("sheets", [])
            totals["sheets_scanned"] += len(sheets)

            patches = []
            for sheet in sheets:
                key = (
                    int(sheet["sitzungnr"]),
                    int(sheet["yesCount"]),
                    int(sheet["noCount"]),
                    int(sheet["abstainCount"]),
                )
                vorgang_id = run._ballot_vorgaenge.get(key)
                if vorgang_id:
                    patches.append(
                        {
                            "sitzungnr": sheet["sitzungnr"],
                            "abstimmnr": sheet["abstimmnr"],
                            "dipVorgangId": vorgang_id,
                        }
                    )

            if patches:
                totals["patches_sent"] += len(patches)
                result = run.loader.patch_vote_vorgang(wahlperiode, patches)
                for key in ("patched", "unchanged", "conflicts", "unknown"):
                    totals[key] += result[key]

            if response.get("done"):
                break
            cursor = response.get("nextCursor")
            if cursor is None:
                break
        else:
            logger.warning(
                "Reached the %d-page ceiling on backfill-vote-vorgang for WP%d — "
                "some unresolved sheets remain",
                max_pages,
                wahlperiode,
            )
    finally:
        # Restore the referral mark to what the daily sync had before this
        # ran. The referral rows we just re-read have already been upserted
        # (they are idempotent), so the daily sync losing this "advance" is
        # exactly the right outcome — the maintenance route is invisible to
        # the sync's own progress accounting.
        run.state.restore_watermark(wahlperiode, STREAM_REFERRALS, watermark_before)
        _finish(run, report, owned=owned)
    return totals


def recompute_scores(
    wahlperiode: int = CURRENT_WAHLPERIODE,
    *,
    month: str | None = None,
    months: Sequence[str] | None = None,
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

    `months` rescores a list of them in one pass — what a backfill of a closed
    period needs, since every one of its months is historical and the nightly
    sweep will never revisit any of them. The profile trend graphs read exactly
    those rows and mark a missing one as *not computed* rather than as a zero
    (webapp/convex/activityScores.ts `getMonthlyScoresByMP`), so leaving them
    unwritten is visible in the UI rather than merely absent.
    """
    resolved = settings or get_settings()
    owned = loader is None
    client = loader or ConvexLoader(
        resolved.require_convex_http_url(), resolved.pipeline_api_key, dry_run=dry_run
    )
    try:
        # `[None]` is the period total, and it is always recomputed: a month's
        # data changing changes the total, and `recomputeScores` writes the
        # total on every call anyway.
        targets: list[str | None] = list(months) if months else [month]
        scored = 0
        for target in targets:
            scored += client.recompute_scores(wahlperiode, month=target)
        logger.info(
            "Recomputed %d scores for WP%d across %d month(s)", scored, wahlperiode, len(targets)
        )
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
    # `full` on a backfill: a sync wants the contact pages that have aged past
    # `CONTACT_TTL`, a backfill wants all 639 regardless of when they were last
    # read. Both re-post the roster, so neither can blank what the other wrote.
    _guard(report, "enrichment", lambda: run.load_enrichment(report, full=not incremental))
    _guard(report, "committees", lambda: run.load_committees(report))
    # Beside the committee seats rather than after the motions, because it is
    # the other half of the committee picture — and deliberately *not* folded
    # into that stage: a referral names no member, so it is a different claim.
    _guard(report, "committee-referrals", lambda: run.load_committee_referrals(report, since=since))
    _guard(report, "activities", lambda: run.load_activities(report, since=since))
    _guard(report, "motions", lambda: run.load_motions(report, since=since))
    _guard(report, "speeches", lambda: run.load_speeches(report, since=since))
    _guard(report, "votes", lambda: run.load_votes(report, incremental=incremental))
    # After the votes, because it reads the ballots that stage writes, and
    # before the dissent roll-up, which reads votes through the index this fills.
    _guard(report, "vote-scope", lambda: run.backfill_vote_scope(report))
    # After the votes, because it reads the ballots that stage writes. Guarded
    # like the rest: a failed tally leaves the dissent figure stale, which the
    # UI can state, where an aborted run would leave every later stage undone.
    _guard(report, "dissent", lambda: run.backfill_dissent(report))
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


def _outside_period(ballot_date: date | None, window: tuple[date | None, date | None]) -> bool:
    """Whether a listed ballot's date puts it outside a Wahlperiode.

    Answers False whenever it cannot be sure, and every branch here is that
    rule applied: an undated row (the pre-2012 tail prints no date, §4.1), a
    period the dump gives no bounds for, and an open upper bound all fall
    through to a download and let the sheet's own `Wahlperiode` column decide.
    A false negative costs one ~200 KB download; a false positive silently
    drops a ballot from the record, and the sheets are the only source that
    carries absences (§4.2).
    """
    if ballot_date is None:
        return False
    start, end = window
    if start and ballot_date < start:
        return True
    return bool(end and ballot_date > end)


def _ballot_key(sheet: VoteSheet) -> str:
    return f"{sheet.wahlperiode}/{sheet.sitzungnr}/{sheet.abstimmnr}"


def _as_batch(response: dict[str, Any]) -> dict[str, Any]:
    """A single-row mutation's `{created}` as a batch result's counters."""
    created = bool(response.get("created"))
    return {"inserted": int(created), "updated": int(not created)}


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
