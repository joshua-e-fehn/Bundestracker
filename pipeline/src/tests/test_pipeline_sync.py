"""Orchestration: the order, the watermark, and what a failed stage costs.

The sources are stubbed — every client is injected, so nothing here fetches
anything. What is under test is the wiring between them, which is where the
two operational findings live:

- **The order is a dependency graph** (§11.1). Convex rejects a record naming
  an MP who is not on the roster, so a stage running early fails as a 400.
- **The watermark is the max `aktualisiert` seen, not wall-clock time**
  (§11.2). A clock-based watermark drops any record whose timestamp fell
  between the query and the run finishing, and it never comes back.
"""

from __future__ import annotations

import datetime as dt
from datetime import datetime

from bundestrack.api.base import BundestagAPIError
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.config import Settings
from bundestrack.models.dip import Aktivitaet, Vorgangsposition
from bundestrack.models.enrichment import MPContact, MPPortrait, MPProfileLink, SocialProfile
from bundestrack.models.stammdaten import parse_german_date
from bundestrack.models.votes import VoteSheetLink
from bundestrack.pipeline.join import QuarantinedName
from bundestrack.pipeline.load import ConvexLoader
from bundestrack.pipeline.state import (
    OVERLAP,
    STREAM_ACTIVITIES,
    STREAM_MOTIONS,
    STREAM_PROTOCOLS,
    STREAM_REFERRALS,
    SyncState,
    load_state,
    save_state,
)
from bundestrack.pipeline.sync import (
    Pipeline,
    RunReport,
    backfill,
    months_in,
    recompute_scores,
    sync,
)
from tests.conftest import fixture_bytes, fixture_json


class StubClient:
    """A source client that answers from fixtures and records nothing."""

    def close(self) -> None:
        pass


class StubStammdaten(StubClient):
    def __init__(self, data: bytes | None = None) -> None:
        self._data = (
            data if data is not None else fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip")
        )

    def fetch(self):
        return StammdatenClient.parse_zip(self._data)


class StubDIP(StubClient):
    """DIP, answering with recorded pages and remembering its filters."""

    def __init__(
        self,
        *,
        aktivitaeten: list[Aktivitaet] | None = None,
        positionen: list[Vorgangsposition] | None = None,
    ) -> None:
        self.aktivitaeten = aktivitaeten or []
        self.positionen = positionen or []
        self.since: list[str | None] = []
        #: The `updated_since` the referral stage asked for, kept apart from
        #: `since` so the per-stream watermark can be asserted on its own.
        self.referral_since: list[str | None] = []

    def iter_personen(self, wahlperiode=None, *, updated_since=None, **extra):
        return iter(())

    def iter_aktivitaeten(self, wahlperiode=None, *, updated_since=None, **extra):
        self.since.append(updated_since)
        return iter(self.aktivitaeten)

    def iter_vorgangspositionen(self, wahlperiode=None, *, updated_since=None, **extra):
        self.referral_since.append(updated_since)
        return iter(self.positionen)

    def iter_vorgaenge(self, wahlperiode=None, *, updated_since=None, **extra):
        self.since.append(updated_since)
        return iter(())

    def iter_drucksachen(self, wahlperiode=None, *, updated_since=None, **extra):
        return iter(())

    def iter_plenarprotokolle(self, wahlperiode=None, *, updated_since=None, **extra):
        return iter(())


class StubVotes(StubClient):
    """The ballot listing, remembering which sheets were actually downloaded.

    `fetched` is the assertion surface for the period filter: the listing is
    every ballot since 1949 and the sheets are ~200 KB each, so what matters is
    not only which ballots are ingested but which ones were paid for.
    """

    def __init__(self, links: list[VoteSheetLink] | None = None) -> None:
        self.links = links or []
        self.fetched: list[str] = []

    def iter_vote_links(self, **kwargs):
        return iter(self.links)

    def fetch_sheet(self, link: VoteSheetLink):
        self.fetched.append(link.title)
        raise BundestagAPIError(f"stub: no sheet bytes for {link.title!r}")


class StubProfiles(StubClient):
    """The MP listing and the biography pages, from memory.

    Empty by default and *never* reaching the network: the enrich stage is on
    the default path for every run, so a stub that fell through to the real
    client would put all 639 biography pages behind `pytest`.
    """

    def __init__(self, profiles: list[MPProfileLink] | None = None) -> None:
        self.profiles = profiles or []
        #: Every URL `fetch_contact` was asked for — which is what the
        #: staleness gate is asserted on.
        self.fetched: list[str] = []
        self.contacts: dict[str, MPContact] = {}

    def iter_profiles(self, **kwargs):
        return iter(self.profiles)

    def fetch_contact(self, profile_url: str) -> MPContact:
        self.fetched.append(profile_url)
        return self.contacts.get(profile_url, MPContact())


class StubAbgeordnetenwatch(StubClient):
    def __init__(
        self,
        politicians: list[dict] | None = None,
        mandates: list[dict] | None = None,
    ) -> None:
        self.politicians = politicians or []
        self.mandates = mandates or []
        #: Set when `get_mandates` was reached at all — the assertion that the
        #: endpoint stopped being dead code.
        self.mandates_requested: list[int] = []

    def iter_politicians(self):
        return iter(self.politicians)

    def get_mandates(self, wahlperiode: int = 21):
        self.mandates_requested.append(wahlperiode)
        return iter(self.mandates)


class RecordingLoader(ConvexLoader):
    """A loader that records the routes it was asked for, in order."""

    def __init__(self) -> None:
        super().__init__("https://example.convex.site", "test-key", dry_run=True)
        self.paths: list[str] = []
        self.payloads: list[tuple[str, dict]] = []

    def post(self, path: str, payload: dict) -> dict:
        self.paths.append(path)
        self.payloads.append((path, payload))
        return super().post(path, payload)

    def posted(self, path: str) -> list[dict]:
        """Every payload sent to one route, in order.

        The roster is posted more than once per run on purpose — the crosswalk
        and the enrichment each re-post it — so the assertions that matter are
        usually about the *last* one.
        """
        return [payload for sent, payload in self.payloads if sent == path]


def build(
    *,
    dip: StubDIP | None = None,
    votes: StubVotes | None = None,
    state: SyncState | None = None,
    tmp_path=None,
    profiles: StubProfiles | None = None,
    abgeordnetenwatch: StubAbgeordnetenwatch | None = None,
) -> tuple[Pipeline, RecordingLoader]:
    loader = RecordingLoader()
    settings = Settings(
        _env_file=None,
        BUNDESTAG_API_KEY="test-key",
        CONVEX_URL="https://example.convex.cloud",
        PIPELINE_API_KEY="test-key",
        **({"BUNDESTRACK_STATE_PATH": str(tmp_path / "state.json")} if tmp_path else {}),
    )
    pipeline = Pipeline(
        21,
        settings=settings,
        dry_run=True,
        dip=dip or StubDIP(),
        stammdaten=StubStammdaten(),
        protocols=StubClient(),
        votes=votes or StubVotes(),
        profiles=profiles or StubProfiles(),
        abgeordnetenwatch=abgeordnetenwatch or StubAbgeordnetenwatch(),
        loader=loader,
        state=state if state is not None else SyncState(),
    )
    return pipeline, loader


def aktivitaet(aktualisiert: str, person_id: str = "1013") -> Aktivitaet:
    document = dict(fixture_json("dip", "aktivitaet_page.json")["documents"][0])
    document["aktualisiert"] = aktualisiert
    document["person_id"] = person_id
    return Aktivitaet.model_validate(document)


# --- order ----------------------------------------------------------------


def test_the_roster_is_written_before_anything_that_references_it(tmp_path) -> None:
    """§11.1, and Convex enforces it: every ingestion mutation calls
    `requireMandate` and rejects a record naming an MP who is not on the
    roster, so a batch posted early fails as a 400 rather than as an orphan."""
    pipeline, loader = build(tmp_path=tmp_path)

    backfill(21, pipeline=pipeline)

    assert loader.paths[0] == "mps"
    for path in ("committee-memberships", "activities", "speeches", "vote-records"):
        if path in loader.paths:
            assert loader.paths.index("mps") < loader.paths.index(path), path


def test_a_run_with_no_roster_skips_every_dependent_stage() -> None:
    """Nothing else can be written without it, so the stages are not attempted.

    Posting them would be several hundred 400s naming an MP that does not
    exist, which buries the actual problem.
    """
    pipeline, loader = build()
    # WP8 exists in the dump but the resolver is built for 21, so a period the
    # excerpt has no mandates for stands in for an empty roster.
    pipeline.wahlperiode = 99
    pipeline.resolver = None

    report = backfill(99, pipeline=pipeline)

    assert loader.paths == []
    assert report.stages[0].name == "roster"


def test_a_roster_fetch_failure_is_reported_rather_than_raised(tmp_path) -> None:
    """The cron reads the report; a traceback out of `sync()` is not one.

    The dependent stages are still skipped — without a roster they would be
    several hundred 400s naming an MP that does not exist.
    """

    class ExplodingStammdaten(StubStammdaten):
        def fetch(self):
            raise RuntimeError("the Stammdaten ZIP is a 503 today")

    pipeline, loader = build(tmp_path=tmp_path)
    pipeline.stammdaten = ExplodingStammdaten()

    report = backfill(21, pipeline=pipeline)

    assert not report.ok
    assert report.stages[0].name == "roster"
    assert "503" in report.stages[0].error
    assert loader.paths == []


def test_one_stage_failing_does_not_end_the_run(tmp_path) -> None:
    """The stages after the roster are independent of each other, so a source
    being down should not cost the rest of the run."""

    class ExplodingDIP(StubDIP):
        def iter_aktivitaeten(self, *args, **kwargs):
            raise RuntimeError("the WAF is blocking us")

    pipeline, _loader = build(dip=ExplodingDIP(), tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    assert not report.ok
    (failed,) = [stage for stage in report.stages if not stage.ok]
    assert failed.name == "activities"
    assert "WAF" in failed.error
    # …and the stages after it still ran.
    assert [stage.name for stage in report.stages][-1] == "seating"


# --- enrichment -----------------------------------------------------------


def profile(
    printed_name: str,
    url: str = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1",
    *,
    credit: str | None = "Foto/Fraktion",
) -> MPProfileLink:
    return MPProfileLink(
        printed_name=printed_name,
        profile_url=url,
        portrait=(
            MPPortrait(url="https://www.bundestag.de/resource/image/1.jpg", credit=credit)
            if credit
            else None
        ),
    )


def test_the_portrait_reaches_the_roster_upsert_rather_than_a_write_of_its_own() -> None:
    """The `mps` upsert is the only write that carries `photoUrl`.

    A portrait posted by a mutation of its own would survive until the next
    roster write and no longer — and `link_dip_persons` re-posts the roster
    within the very same run.
    """
    profiles = StubProfiles([profile("Bilger, Steffen")])
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["photoUrl"] == "https://www.bundestag.de/resource/image/1.jpg"
    assert bilger["photoCredit"] == "Foto/Fraktion"


def test_a_roster_post_with_no_enrichment_omits_the_columns_rather_than_nulling_them() -> None:
    """The regression behind the 2026-07-29 production outage.

    The Convex upsert patches exactly the keys present
    (`webapp/convex/lib/ingest.ts:123`), so a column sent as null *clears* the
    stored value. Stage 1 always builds its payload from a freshly-constructed
    resolver holding no enrichment, which means every run opens by re-posting
    the whole roster — and while those posts carried explicit nulls, that
    opening write blanked every portrait and contact block in the chamber.
    Production went from 633 portraits to 0 in one batch at 11:13:56 UTC and
    rendered initials for all 635 members.

    So the assertion is specifically about *absence*, not about the value: a
    payload carrying `photoUrl: None` would satisfy any check that the portrait
    is falsy while still destroying the stored one.
    """
    pipeline, loader = build()
    report = RunReport(21, "sync")

    pipeline.load_roster(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    for column in ("photoUrl", "photoCredit", "education", "occupation", "contact"):
        assert column not in bilger, f"{column} would clear the stored value"
    # The Stammdaten columns are unconditional: that source is read in full on
    # every run, so those keys are always present and always authoritative.
    assert bilger["name"] == "Steffen Bilger"
    assert bilger["fraktion"] == "CDU/CSU"


def test_a_portrait_only_refresh_leaves_the_contact_block_alone() -> None:
    """Per column, not all-or-nothing.

    The sources arrive at different rates by design: the portrait listing is
    cheap and re-read every sync, while the ~280 KB biography pages are gated
    on a 30-day TTL (`state.CONTACT_TTL`). A sync that refreshed only the
    portraits must not blank the contact block it deliberately did not fetch —
    which is what made the outage persist rather than heal on the next run.
    """
    profiles = StubProfiles([profile("Bilger, Steffen")])
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)
    # Every MP inside the TTL, so `_load_contacts` fetches nothing at all.
    # Through `record_contact_fetch` rather than by writing the dict directly:
    # the key is `(wahlperiode, internal id)` and a hand-built one that missed
    # the period would leave this test passing while fetching after all.
    pipeline.state.record_contact_fetch("bt-11004011", 21)
    assert not pipeline.state.contact_is_stale("bt-11004011", 21), "the premise of this test"

    pipeline.load_enrichment(report)

    assert profiles.fetched == [], "the TTL must have suppressed the contact fetch"
    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["photoUrl"] == "https://www.bundestag.de/resource/image/1.jpg"
    assert "contact" not in bilger, "a fresh contact block would be cleared"


def test_a_biography_page_that_published_nothing_omits_the_contact_block() -> None:
    """The narrower half of the same erasure, and the one a truthiness guard misses.

    `MPContact` is a pydantic model with no `__bool__`, so an **empty** one is
    truthy while `contact_payload` maps it to None. A guard written as
    `if enrichment.contact:` therefore passes the empty case straight through
    and writes `contact: None` — the destructive payload — for exactly the MPs
    whose page was fetched and published nothing.

    That is not a hypothetical edge: `_load_contacts` fetches a page for every
    due MP and counts the empty results separately, and the WP19 backfill log
    records `635 biography pages fetched, 625 with published details`. Those
    ten took this path in one real run.

    Asserted across *every* roster post rather than the last, because the
    erasing write is stage 1's and a later post carrying the right thing does
    not undo a `patch` that already cleared the column.
    """
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    # The default `fetch_contact` already returns an empty `MPContact`; naming
    # it here is the point of the test rather than an implementation detail.
    profiles.contacts[url] = MPContact()
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"]
    assert bilger, "the roster post is what carries enrichment"
    for row in bilger:
        assert "contact" not in row, "an empty page would clear the stored block"
    # The portrait still lands: the two sources are independent, and a blank
    # biography page says nothing about the listing that published the face.
    assert bilger[-1]["photoUrl"] == "https://www.bundestag.de/resource/image/1.jpg"


def test_occupation_joins_by_stammdaten_id_rather_than_by_name() -> None:
    """abgeordnetenwatch carries the Stammdaten id verbatim, so §7.1 does not
    apply to this source — the join is exact and needs no name at all."""
    politicians = StubAbgeordnetenwatch(
        [
            {
                "ext_id_bundestagsverwaltung": "11004011",
                "occupation": "Diplom-Verwaltungswirt",
                "education": "Jura",
            }
        ]
    )
    pipeline, loader = build(abgeordnetenwatch=politicians)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["occupation"] == "Diplom-Verwaltungswirt"
    assert bilger["education"] == "Jura"


def test_a_fresh_contact_block_is_not_re_fetched() -> None:
    """~280 KB per MP against a WAF that counts bytes (§2.6). A daily sync must
    re-read the pages that have aged, not all 639 of them."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    state = SyncState()
    state.record_contact_fetch("bt-11004011", 21)
    pipeline, _ = build(profiles=profiles, state=state)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    assert profiles.fetched == []


def test_a_backfill_re_reads_every_contact_page_however_fresh() -> None:
    """`full` is what separates the two modes: a backfill is the run that is
    allowed to spend the whole ~175 MB."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    state = SyncState()
    state.record_contact_fetch("bt-11004011", 21)
    pipeline, _ = build(profiles=profiles, state=state)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report, full=True)

    assert profiles.fetched == [url]


def test_a_page_that_parsed_to_nothing_is_not_stamped_as_a_success() -> None:
    """GAP-028: an empty result is a read failure, not a member with no details.

    Every sitting MP has a contact form, and `form_url` alone makes a block
    non-empty — 623 of 635 carried one when production was last measured. So a
    block with *nothing* in it did not come from a page that published nothing;
    it came from a page this pipeline did not manage to read (a markup change,
    a truncated body, a WAF page answering 200).

    Stamping it anyway is what made the 12 empty contact blocks permanent:
    marked fresh for `CONTACT_TTL`, they were never retried, and the stage
    counted them among the pages it had successfully fetched. This is the
    inverse of the sparse-but-real case below, which *is* stamped.
    """
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    # `StubProfiles` answers a bare `MPContact()` for a URL it has no entry
    # for — which is exactly the empty parse this guards.
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    assert profiles.fetched == [url]
    assert pipeline.state.contact_is_stale("bt-11004011", 21), "an empty parse must retry"
    (note,) = [n for n in report.stages[-1].notes if n.startswith("contact:")]
    assert "retry next sync" in note


def test_a_sparse_but_real_contact_block_is_stamped() -> None:
    """The other half of the rule, and why it is `is_empty` rather than a count.

    About half of MPs list no constituency office, so a block carrying only a
    form URL is a complete answer rather than a failed read. Re-fetching those
    ~280 KB pages every sync to rediscover the same absence is precisely the
    cost this gate exists to avoid — the retry above must not become "retry
    everything sparse, forever".
    """
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    profiles.contacts[url] = MPContact(
        form_url="https://www.bundestag.de/services/formular/contactform?mdbId=1"
    )
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    assert not pipeline.state.contact_is_stale("bt-11004011", 21)


def test_the_contact_block_reaches_the_roster_row() -> None:
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    profiles.contacts[url] = MPContact(
        form_url="https://www.bundestag.de/services/formular/contactform?mdbId=1",
        constituency_office="Wahlkreisbüro\nLudwigsburg",
        homepage="https://example.de",
        socials=(SocialProfile(platform="X", url="https://x.com/example"),),
    )
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    contact = [row for row in rows if row["internalId"] == "bt-11004011"][-1]["contact"]
    assert contact["formUrl"].endswith("mdbId=1")
    assert contact["constituencyOffice"] == "Wahlkreisbüro\nLudwigsburg"
    assert contact["socials"] == [{"platform": "X", "url": "https://x.com/example"}]


def test_an_unmatched_name_is_not_counted_as_a_fresh_contact_block() -> None:
    """ "Fresh" means "fetched recently". A name the roster has never heard of
    has no contact block at all, so counting it as up to date would report a
    §7.3 staleness gap as work already done."""
    profiles = StubProfiles(
        [
            profile("Bilger, Steffen"),
            profile("Nichtexistent, Erika", "https://www.bundestag.de/x"),
        ]
    )
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    (contact_note,) = [n for n in report.stages[-1].notes if n.startswith("contact:")]
    assert "still fresh" not in contact_note


def test_a_listed_name_matching_no_roster_mp_is_quarantined_not_merely_reported() -> None:
    """The listing is the Bundestag's own roster, so a name that resolves to
    nobody means the Stammdaten snapshot is behind (§7.3). It must not fail the
    stage — and it must actually reach the quarantine.

    GAP-027: the note below has always claimed the quarantine retries these,
    while `portrait_enrichment` only logged them. Asserting the note alone is
    what let that gap survive, so this asserts the mechanism as well as the
    message.
    """
    profiles = StubProfiles([profile("Nichtexistent, Erika")])
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    stage = report.stages[-1]
    assert stage.ok
    assert any("match no roster MP" in note for note in stage.notes)
    (entry,) = pipeline.state.quarantine.for_source("mp-listing")
    assert entry.nachname == "Nichtexistent"


def test_a_quarantined_listing_entry_clears_once_the_dump_catches_up() -> None:
    """What the quarantine is *for*, closing GAP-027's loop.

    An entry only earns its keep if a later run retries it: the roster is
    re-read every sync, and `clear_resolved` drops whatever the fresher dump
    can now resolve. Without that, quarantining would just be a second place to
    write the same log line.
    """
    state = SyncState()
    state.quarantine.add(
        QuarantinedName(source="mp-listing", nachname="Bilger", vorname="Steffen", wahlperiode=21)
    )
    pipeline, _ = build(state=state)
    report = RunReport(21, "sync")

    # The roster stage re-reads the dump and clears what now resolves.
    pipeline.load_roster(report)

    assert pipeline.state.quarantine.for_source("mp-listing") == []
    assert any("now match the roster" in note for note in report.stages[0].notes)


def test_one_unreadable_biography_page_does_not_end_the_stage() -> None:
    """The same rule `load_speeches` applies to an unreadable protocol: note
    it, step over it, and leave it unstamped so the next sync retries."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"

    class BlockedProfiles(StubProfiles):
        def fetch_contact(self, profile_url: str) -> MPContact:
            raise BundestagAPIError("the WAF answered a 303 challenge")

    profiles = BlockedProfiles([profile("Bilger, Steffen", url)])
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    stage = report.stages[-1]
    assert stage.ok
    assert pipeline.state.contact_is_stale("bt-11004011", 21)
    assert any("retry next sync" in note for note in stage.notes)


def test_an_uncredited_portrait_never_reaches_the_row() -> None:
    """§6.5: these are photographer-credited works, not open-licensed ones, so
    showing the credit is the licence condition. A portrait without one is
    dropped rather than rendered bare.

    Dropped means *omitted*, not nulled: the columns are absent from the
    payload, so an uncredited portrait cannot overwrite a credited one an
    earlier run stored. See the roster-post test above.
    """
    profiles = StubProfiles([profile("Bilger, Steffen", credit=None)])
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert "photoUrl" not in bilger
    assert "photoCredit" not in bilger


def test_enrichment_runs_after_the_crosswalk_so_the_roster_carries_both() -> None:
    """Both stages re-post the roster. Enrichment going second is what makes
    this run's *last* roster write the one carrying the portrait — a run that
    enriched first would have `link_dip_persons` blank it again."""
    profiles = StubProfiles([profile("Bilger, Steffen")])
    pipeline, loader = build(profiles=profiles)

    report = sync(21, pipeline=pipeline)

    names = [stage.name for stage in report.stages]
    assert names.index("enrichment") > names.index("dip-persons")
    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["photoUrl"] is not None


def test_an_ordinary_sync_inside_the_ttl_publishes_no_enrichment_null(tmp_path) -> None:
    """The 2026-07-29 outage, reproduced end to end at the level it happened.

    This is the scenario the incident actually took, rather than the unit
    behind it: every member stamped fresh (as they were, at 08:31–08:42 UTC),
    then an ordinary `sync` — which is what ran at 11:11:58 and left the
    chamber blank two minutes later. Three writes post the roster in one run
    (stage 1, the crosswalk, then enrichment), and the failure was that the
    *first* of them carried five explicit nulls, which the Convex upsert
    applies as erasures (`webapp/convex/lib/ingest.ts:123`).

    So the assertion is over **every** roster post, not the last one. Checking
    only the final write would pass against the exact code that took 633
    portraits and 623 contact blocks to zero: the last post was never the
    problem, the two before it were.
    """
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    state = SyncState()
    # Exactly the starved state the incident ran against: fetched hours ago, so
    # `CONTACT_TTL` says fresh and stage 3 fetches nothing.
    for internal in ("bt-11004011", "bt-11002718", "bt-11003142", "bt-11003639"):
        state.record_contact_fetch(internal, 21)
    pipeline, loader = build(profiles=profiles, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert profiles.fetched == [], "the premise: the TTL suppressed every contact fetch"
    posts = loader.posted("mps")
    assert len(posts) >= 2, "the roster is posted more than once per run — that is the hazard"
    for index, call in enumerate(posts):
        for row in call["mps"]:
            for column in ("photoUrl", "photoCredit", "education", "occupation", "contact"):
                assert row.get(column, "absent") is not None, (
                    f"roster post {index} sends {column}=null for {row['internalId']}, "
                    "which erases what an earlier run stored"
                )


def test_a_historical_backfill_does_not_mark_the_current_period_fresh() -> None:
    """GAP-026: the TTL is per mandate, so one period cannot starve another.

    Measured consequence of the bare-id key: a `backfill --wp 19` running
    against production stamped every member it fetched, and the members who
    also sit in WP21 were then "fresh" for 30 days — so the next WP21 sync
    fetched no contact page for them at all. WP20 held 0 contact blocks and 0
    portraits while WP19 was still backfilling.

    Asserted through `contact_is_stale` rather than on the dict, because the
    guarantee is about what the *gate* answers: the stamps may share a file, but
    they must not share a meaning.
    """
    state = SyncState()

    state.record_contact_fetch("bt-11004011", 19)

    assert not state.contact_is_stale("bt-11004011", 19), "the period that was fetched is fresh"
    assert state.contact_is_stale("bt-11004011", 21), "the current period must still be due"


def test_a_pre_scoping_stamp_is_read_as_stale_rather_than_adopted() -> None:
    """The migration case, and why it errs towards a re-read.

    Deployed state files hold bare-id stamps written before the key carried a
    period, and they are genuinely ambiguous — the same dict mixed a WP21 sync's
    stamps with a WP19 backfill's. Of the two ways to guess wrong, reading them
    as current re-creates exactly the starvation the new key exists to end,
    while reading them as stale costs one wider fetch, once. That is the trade
    `load_state` already makes for a corrupt file.
    """
    state = SyncState(contact_fetched_at={"bt-11004011": datetime.now(dt.UTC).isoformat()})

    assert state.contact_is_stale("bt-11004011", 21)


# --- the watermark --------------------------------------------------------


def test_the_watermark_is_a_timestamp_actually_seen(tmp_path) -> None:
    """§11.2 asks for the max `aktualisiert` seen, not wall-clock time.

    A clock-based watermark drops any record whose timestamp fell between the
    query and the run finishing, and the next window starts after it — so the
    record never comes back.
    """
    dip = StubDIP(
        aktivitaeten=[
            aktivitaet("2026-07-24T12:03:00+02:00"),
            aktivitaet("2026-07-25T09:00:00+02:00"),
        ]
    )
    pipeline, _ = build(dip=dip, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"


def test_the_next_sync_re_reads_an_overlapping_window(tmp_path) -> None:
    """§11.2: "overlap the window slightly to tolerate clock skew".

    Re-reading an hour costs a handful of pages; missing an hour costs records
    that never return.
    """
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    expected = (datetime.fromisoformat("2026-07-25T09:00:00+02:00") - OVERLAP).isoformat()
    assert dip.since[0] == expected


def test_the_watermark_never_moves_backwards(tmp_path) -> None:
    # A re-read of the overlap window, or a backfill of an older period, must
    # not rewind it — the next sync would re-read everything since.
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP(aktivitaeten=[aktivitaet("2026-07-01T00:00:00+02:00")])
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"


def test_a_failed_stage_does_not_lose_its_window_to_a_successful_one(
    tmp_path,
) -> None:
    """The watermark is per *stream*, and this is why.

    The stages fail independently — that is the point of isolating them — so a
    single shared mark would let a stage that succeeded advance past the window
    a stage that *failed* still needs. A run where activities land and
    protocols are blocked by the WAF would move the mark to today, and
    tomorrow's sync would never ask for those protocols again: the sitting is
    lost, silently and permanently.
    """

    class BlockedProtocols(StubDIP):
        def iter_plenarprotokolle(self, *args, **kwargs):
            raise RuntimeError("the WAF is blocking us")

    dip = BlockedProtocols(aktivitaeten=[aktivitaet("2026-07-25T09:00:00+02:00")])
    state = SyncState(
        watermarks={
            f"21:{STREAM_ACTIVITIES}": "2026-07-01T00:00:00+02:00",
            f"21:{STREAM_PROTOCOLS}": "2026-07-01T00:00:00+02:00",
        }
    )
    pipeline, _loader = build(dip=dip, state=state, tmp_path=tmp_path)

    report = sync(21, pipeline=pipeline)

    assert not report.ok
    # Activities advanced on evidence they actually saw…
    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"
    # …and the blocked stream kept its window, so tomorrow re-reads it.
    assert pipeline.state.watermark(21, STREAM_PROTOCOLS) == "2026-07-01T00:00:00+02:00"


def test_each_stream_asks_for_its_own_window(tmp_path) -> None:
    # A stream that is behind must not be dragged forward by one that is ahead.
    state = SyncState(
        watermarks={
            f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00",
            f"21:{STREAM_MOTIONS}": "2026-07-01T00:00:00+02:00",
        }
    )
    dip = StubDIP()
    pipeline, _loader = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    # `StubDIP` records activities then Vorgänge, in stage order.
    activities_window, motions_window = dip.since[0], dip.since[1]
    assert activities_window.startswith("2026-07-25")
    assert motions_window.startswith("2026-06-30"), "an hour of overlap before 07-01"


def test_an_explicit_since_overrides_every_stream(tmp_path) -> None:
    # The hand re-read after an incident: one window, applied to everything.
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _loader = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, since="2026-01-01T00:00:00+01:00", pipeline=pipeline)

    assert set(dip.since) == {"2026-01-01T00:00:00+01:00"}


def test_a_backfill_ignores_a_watermark_left_by_an_earlier_attempt(tmp_path) -> None:
    """A backfill means the whole period, not the part a dead run missed.

    The failure this guards is silent and unrecoverable by any later run: a
    backfill blocked by the WAF leaves a watermark at whatever it *had* read,
    and `aktualisiert` order is not `datum` order — so resuming from that mark
    fetches the records amended since, never the ones not yet seen.
    """
    # WP21 because the Stammdaten excerpt only has mandates for that period —
    # a period with no roster skips every dependent stage, so the assertion
    # below would hold vacuously.
    state = SyncState(
        watermarks={
            f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00",
            f"21:{STREAM_MOTIONS}": "2026-07-25T09:00:00+02:00",
            f"21:{STREAM_PROTOCOLS}": "2026-07-25T09:00:00+02:00",
        }
    )
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    backfill(21, pipeline=pipeline)

    assert dip.since, "the fetching stages must have run at all"
    assert all(window is None for window in dip.since), (
        "every stream must re-fetch the period whole, not resume from a partial run"
    )


def test_a_backfill_still_honours_an_explicit_since(tmp_path) -> None:
    # `full` overrides the *stored* mark, not a human naming a window.
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)
    pipeline.full = True

    assert pipeline._window(STREAM_ACTIVITIES, "2026-01-01T00:00:00+01:00") == (
        "2026-01-01T00:00:00+01:00"
    )


def test_a_sync_still_resumes_from_its_watermark(tmp_path) -> None:
    """The counterpart of the two above: `full` is a backfill's property alone.

    A daily sync that started fetching from scratch would re-read the whole
    period against a WAF that IP-blocks on volume (§2.6).
    """
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert dip.since, "the fetching stages must have run at all"
    assert dip.since[0] is not None


def test_a_host_with_no_watermark_does_a_full_fetch(tmp_path) -> None:
    """Rather than starting from now, which would leave the deployment
    permanently missing whatever happened before it was first run."""
    dip = StubDIP()
    pipeline, _ = build(dip=dip, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert dip.since[0] is None


def test_an_unparseable_watermark_widens_the_window_rather_than_failing(
    tmp_path,
) -> None:
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "not a timestamp"})

    assert state.since(21, STREAM_ACTIVITIES) is None


# --- state persistence ----------------------------------------------------


def test_state_survives_a_round_trip(tmp_path) -> None:
    path = tmp_path / "state.json"
    state = SyncState(stammdaten_version="1777449783")
    state.advance(21, STREAM_ACTIVITIES, datetime.fromisoformat("2026-07-25T09:00:00+02:00"))
    state.record_protocol_hash("5806", "ba467dc286934a3ad18328e6b9c3f65c")
    state.record_ballot(21, "21/90/8")
    state.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Glaser", vorname="Stefan", wahlperiode=21)
    )
    save_state(path, state)

    loaded = load_state(path)

    assert loaded.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"
    assert loaded.protocol_hash("5806") == "ba467dc286934a3ad18328e6b9c3f65c"
    assert loaded.ingested_ballots(21) == ["21/90/8"]
    assert len(loaded.quarantine) == 1


def test_a_corrupt_state_file_costs_a_wider_window_not_the_run(tmp_path) -> None:
    """Refusing to run until an operator repairs a cache file would take the
    pipeline down for something that repairs itself."""
    path = tmp_path / "state.json"
    path.write_text("{ this is not json", encoding="utf-8")

    state = load_state(path)

    assert state.watermark(21, STREAM_ACTIVITIES) is None


def test_a_missing_state_file_is_the_normal_first_run(tmp_path) -> None:
    assert load_state(tmp_path / "absent.json").watermark(21, STREAM_ACTIVITIES) is None


def test_a_dry_run_writes_no_state(tmp_path) -> None:
    # A dry run must not move the watermark: the records it "wrote" are not in
    # the deployment, so a real sync afterwards has to fetch them again.
    path = tmp_path / "state.json"
    pipeline, _ = build(
        dip=StubDIP(aktivitaeten=[aktivitaet("2026-07-25T09:00:00+02:00")]),
        tmp_path=tmp_path,
    )

    sync(21, pipeline=pipeline)

    assert not path.exists()


# --- reporting ------------------------------------------------------------


def test_the_report_names_a_failed_stage_rather_than_omitting_it() -> None:
    report = RunReport(21, "sync")
    report.stage("roster").error = None
    report.stage("votes").error = "the listing timed out"

    assert not report.ok
    assert "votes: FAILED" in report.summary()


def test_the_quarantine_count_reaches_the_summary(tmp_path) -> None:
    # §7.3's staleness, made visible: a growing count is the signal that the
    # Stammdaten snapshot is behind reality.
    state = SyncState()
    state.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Glaser", vorname="Stefan", wahlperiode=21)
    )
    pipeline, _ = build(state=state, tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    assert report.quarantined >= 1
    assert "quarantine" in report.summary()


# --- period-specific gaps -------------------------------------------------


def test_a_period_before_the_xml_boundary_reports_why_it_has_no_speeches(
    tmp_path,
) -> None:
    """§5.2: XML exists from WP18 onward; earlier periods are PDF-only.

    Saying so beats an empty stage, which reads as a sitting-free parliament.
    """
    pipeline, _ = build(tmp_path=tmp_path)
    pipeline.wahlperiode = 17
    report = RunReport(17, "backfill")
    pipeline.load_roster(report)
    pipeline.load_speeches(report, since=None)

    (stage,) = [s for s in report.stages if s.name == "speeches"]
    assert any("WP18" in note for note in stage.notes)


def test_an_older_period_says_committee_data_was_never_published(tmp_path) -> None:
    """§6.4: absent data, not an idle chamber — and the difference has to reach
    the reader or every past MP looks like they sat on nothing."""
    pipeline, _ = build(tmp_path=tmp_path)
    pipeline.wahlperiode = 8
    report = RunReport(8, "backfill")
    pipeline.load_roster(report)
    pipeline.load_committees(report)

    (stage,) = [s for s in report.stages if s.name == "committees"]
    assert any("§6.4" in note for note in stage.notes)


# --- the ballot listing ----------------------------------------------------


def _link(title: str, when: str | None) -> VoteSheetLink:
    return VoteSheetLink(
        title=title,
        pdf_url=f"https://example.invalid/{title}.pdf",
        xlsx_url=f"https://example.invalid/{title}.xlsx",
        date=parse_german_date(when),
    )


def test_a_ballot_dated_outside_the_period_is_not_downloaded(tmp_path) -> None:
    """The listing is every ballot since 1949 and carries no period filter.

    Without a date check each backfill downloads the whole listing — hundreds
    of ~200 KB sheets — to keep the handful that match, against a WAF that
    counts bytes as well as requests (§2.6).
    """
    votes = StubVotes(
        [
            _link("during-wp21", "01.06.2026"),
            _link("before-wp21", "01.06.2019"),
        ]
    )
    pipeline, _ = build(votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    pipeline.load_votes(report, incremental=False)

    assert votes.fetched == ["during-wp21"]
    (stage,) = [s for s in report.stages if s.name == "votes"]
    assert any("outside WP21" in note for note in stage.notes)


def test_an_undated_ballot_is_downloaded_rather_than_assumed_out_of_period(
    tmp_path,
) -> None:
    """The pre-2012 tail of the listing prints no date at all (§4.1).

    Excluding those would discard ballots on a missing field, and the sheets
    are the only source that records absences (§4.2) — so an unknown date must
    cost a download, not a row. The sheet's own `Wahlperiode` column decides.
    """
    votes = StubVotes([_link("undated", None)])
    pipeline, _ = build(votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    pipeline.load_votes(report, incremental=False)

    assert votes.fetched == ["undated"]


def test_an_open_period_does_not_exclude_a_recent_ballot(tmp_path) -> None:
    # WP21 has not ended, so its window has no upper bound — a ballot dated
    # after the dump was published is still this period's.
    votes = StubVotes([_link("tomorrow", "31.12.2028")])
    pipeline, _ = build(votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    pipeline.load_votes(report, incremental=False)

    assert votes.fetched == ["tomorrow"]


# --- scoring a backfilled period -------------------------------------------


def test_every_month_of_a_closed_period_is_enumerated() -> None:
    """A backfilled period's months are all historical, so the nightly sweep —
    which recomputes the current month only — never reaches any of them."""
    months = months_in(dt.date(2021, 10, 26), dt.date(2025, 3, 25))

    assert months[0] == "2021-10"
    assert months[-1] == "2025-03"
    assert len(months) == 42
    assert "2022-01" in months, "the year boundary is not a gap"


def test_months_are_zero_padded() -> None:
    """`activityScores.monthWindow` rejects anything else, and is right to:
    `"2021-6"` builds bounds that sort above every real date in the year, so
    the month scores zero and nothing anywhere errors."""
    assert months_in(dt.date(2021, 6, 1), dt.date(2021, 6, 30)) == ["2021-06"]


def test_an_open_period_enumerates_no_months() -> None:
    # The current period's end is unknown, and guessing one would write score
    # rows for months that have not happened.
    assert months_in(dt.date(2025, 3, 25), None) == []
    assert months_in(None, None) == []


def test_scoring_a_period_walks_each_month_and_the_total() -> None:
    """`recomputeScores` writes the period total on every call, so a per-month
    pass keeps the total consistent with the months it just rewrote."""

    class CountingLoader:
        def __init__(self) -> None:
            self.months: list[str | None] = []

        def recompute_scores(self, wahlperiode, *, month=None, **kwargs):
            self.months.append(month)
            return 1

        def close(self) -> None:
            pass

    loader = CountingLoader()
    recompute_scores(20, months=["2021-10", "2021-11"], loader=loader)

    assert loader.months == ["2021-10", "2021-11"]


def test_scoring_with_no_months_still_recomputes_the_total() -> None:
    # The existing behaviour, unchanged: `scores --wp N` with no month.
    class CountingLoader:
        def __init__(self) -> None:
            self.months: list[str | None] = []

        def recompute_scores(self, wahlperiode, *, month=None, **kwargs):
            self.months.append(month)
            return 1

        def close(self) -> None:
            pass

    loader = CountingLoader()
    recompute_scores(21, loader=loader)

    assert loader.months == [None]


# --- committee referrals (GAP-030) ---------------------------------------


def positionen() -> list[Vorgangsposition]:
    """The recorded `/vorgangsposition` page, which carries real referrals."""
    return [
        Vorgangsposition.model_validate(doc)
        for doc in fixture_json("dip", "vorgangsposition_page.json")["documents"]
    ]


def test_committee_referrals_are_posted_to_their_own_route() -> None:
    """`Ueberweisung` was modelled and fetched and never written (GAP-030).

    The route is separate from `committee-memberships` on purpose: a referral
    names a committee and a document and no member, so it is a different claim
    about a different subject. Asserting the *route* is what pins that down —
    the two tables must not converge.
    """
    dip = StubDIP(positionen=positionen())
    pipeline, loader = build(dip=dip)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    posted = loader.posted("committee-referrals")
    assert posted, "referrals reached the deployment"
    assert "committee-memberships" not in {path for path, _ in loader.payloads}
    referrals = [row for payload in posted for row in payload["referrals"]]
    assert len(referrals) == sum(len(p.ueberweisung) for p in positionen())


def test_a_referral_row_carries_the_period_it_was_queried_for() -> None:
    # DIP publishes no `wahlperiode` on `/vorgangsposition`, so the period comes
    # from the query. Without this every row would be written with null in a
    # required column — see the transform test of the same name.
    dip = StubDIP(positionen=positionen())
    pipeline, loader = build(dip=dip)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    rows = [row for payload in loader.posted("committee-referrals") for row in payload["referrals"]]
    assert {row["wahlperiode"] for row in rows} == {21}


def test_the_referral_stage_advances_its_own_watermark() -> None:
    """One mark per stream (§11.2), for the reason `state.py` gives.

    A shared mark lets a stage that succeeded advance past the window a failed
    stage still needs — and this is the only stage that filters
    `/vorgangsposition` on `f.aktualisiert.start`.
    """
    dip = StubDIP(positionen=positionen())
    pipeline, _ = build(dip=dip)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    assert pipeline.state.watermark(21, STREAM_REFERRALS) is not None
    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) is None


def test_the_referral_stage_says_a_referral_is_not_membership() -> None:
    # The note is the whole guard against the misreading: a period with
    # referrals and no committee rows must not look like recovered membership.
    dip = StubDIP(positionen=positionen())
    pipeline, _ = build(dip=dip)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    stage = next(s for s in report.stages if s.name == "committee-referrals")
    assert any("not committee membership" in note for note in stage.notes)


# --- vote explanations (GAP-018) -----------------------------------------


def para31() -> list[Aktivitaet]:
    """Recorded §31 declarations, re-pointed at the fixture roster."""
    records = [
        Aktivitaet.model_validate(doc)
        for doc in fixture_json("dip", "aktivitaet_para31_page.json")["documents"]
    ]
    for record in records:
        record.person_id = "1013"
    return records


def link_bilger(pipeline: Pipeline, report: RunReport) -> None:
    """Populate the DIP crosswalk for the one MP the declarations point at.

    Through `link_dip_persons` rather than by writing the crosswalk directly, so
    these tests break if the §7.2 matching does — the same construction
    `linked_resolver` uses in test_pipeline_transform.py. `StubDIP.iter_personen`
    is empty by design, and a declaration whose person does not resolve is
    correctly skipped, so without this the assertions would pass vacuously.
    """
    from bundestrack.models.dip import Person

    resolver = pipeline.load_roster(report)
    linked = resolver.link_dip_persons(
        [
            Person.model_validate(
                {
                    "id": "1013",
                    "vorname": "Steffen",
                    "nachname": "Bilger",
                    "typ": "Person",
                    "titel": "Steffen Bilger, MdB",
                    "aktualisiert": "2026-07-24T12:03:00+02:00",
                    "wahlperiode": [21],
                    "funktion": ["MdB"],
                }
            )
        ]
    )
    assert linked.linked == 1, "the fixture roster should match the DIP person"


def test_vote_explanations_ride_the_activity_stream() -> None:
    """§31 declarations *are* activities, so they cost no extra fetch.

    A second pass over `/aktivitaet` would be the same ~806 pages through the
    WAF for records the activity stage has already read (§2.6).
    """
    dip = StubDIP(aktivitaeten=para31())
    pipeline, loader = build(dip=dip)
    report = RunReport(21, "sync")
    link_bilger(pipeline, report)

    pipeline.load_activities(report, since=None)

    posted = loader.posted("vote-explanations")
    assert posted, "the declarations reached the deployment"
    rows = [row for payload in posted for row in payload["explanations"]]
    assert all("§ 31" in row["aktivitaetsart"] for row in rows)
    # One fetch, not two: the stage read the stream once.
    assert len(dip.since) == 1


def test_an_explanation_carries_its_provenance_to_the_deployment() -> None:
    # The link into the protocol PDF is the only route to the member's actual
    # words, and the Vorgang id is the only join to the ballot.
    dip = StubDIP(aktivitaeten=para31())
    pipeline, loader = build(dip=dip)
    report = RunReport(21, "sync")
    link_bilger(pipeline, report)

    pipeline.load_activities(report, since=None)

    rows = [
        row for payload in loader.posted("vote-explanations") for row in payload["explanations"]
    ]
    assert rows
    assert all(row["sourceUrl"].startswith("https://dserver.bundestag.de/") for row in rows)
    assert all(row["dipVorgangId"] for row in rows)


def test_a_substantial_activity_stream_with_zero_declarations_warns(
    monkeypatch,
) -> None:
    """L2: this drift is what GAP-018 was written against — a rename to
    `aktivitaetsart` (§5.1 has already caught one) or a silent regression in
    `is_vote_explanation` would make `voteExplanations` stop growing while the
    activity stream kept going. Every fixture in the tree currently matches
    the predicate, so a regression there passes CI green.

    The alarm fires when the activity stream is large enough that zero
    declarations is not a plausible quiet slice. `EXPLANATION_DRIFT_THRESHOLD`
    is set well above incremental-sync volumes and well below a period-scale
    run's — 2 000 was calibrated against §4.5's 2–3 % base rate.

    Mutation-style: the predicate is inverted, so every real declaration in
    the fixture is skipped and the drift warning must fire. The alternative —
    building a fixture of 2 000 activities carrying no §31 — is a fixture that
    grows with the constant, and this way the constant is what the test
    reads.
    """
    from bundestrack.pipeline import sync as sync_module

    monkeypatch.setattr(sync_module, "EXPLANATION_DRIFT_THRESHOLD", 3)
    monkeypatch.setattr(
        Aktivitaet,
        "is_vote_explanation",
        property(lambda self: False),
    )

    pipeline, _ = build(
        dip=StubDIP(
            aktivitaeten=[
                aktivitaet("2026-07-10T00:00:00+02:00"),
                aktivitaet("2026-07-11T00:00:00+02:00"),
                aktivitaet("2026-07-12T00:00:00+02:00"),
                aktivitaet("2026-07-13T00:00:00+02:00"),
            ]
        )
    )
    report = RunReport(21, "sync")
    link_bilger(pipeline, report)

    pipeline.load_activities(report, since=None)

    stage = next(s for s in report.stages if s.name == "activities")
    assert any("0 §31 declarations" in note for note in stage.notes), (
        "the drift check must fire when the stream is above threshold and "
        "zero declarations landed — this is what would catch a rename"
    )


def test_a_small_activity_stream_with_zero_declarations_does_not_warn() -> None:
    """The alarm must not fire on the incremental-sync base case.

    An overnight sync that pulls 40 new activities with none of them a §31
    declaration is not drift — it is Tuesday. The threshold exists precisely
    so this case does not page an operator every night.
    """
    pipeline, _ = build(
        dip=StubDIP(
            aktivitaeten=[
                aktivitaet("2026-07-10T00:00:00+02:00"),
                aktivitaet("2026-07-11T00:00:00+02:00"),
            ]
        )
    )
    report = RunReport(21, "sync")
    link_bilger(pipeline, report)

    pipeline.load_activities(report, since=None)

    stage = next(s for s in report.stages if s.name == "activities")
    assert not any("0 §31 declarations" in note for note in stage.notes)


def test_a_run_with_no_declarations_posts_none() -> None:
    # Most sittings have none (21/88 carried zero), so the empty case is the
    # common one and must not write a placeholder.
    pipeline, loader = build(dip=StubDIP(aktivitaeten=[aktivitaet("2026-07-10T00:00:00+02:00")]))
    report = RunReport(21, "sync")
    link_bilger(pipeline, report)

    pipeline.load_activities(report, since=None)

    assert loader.posted("vote-explanations") == []


# --- roster reconciliation (GAP-029) -------------------------------------


def test_the_mandate_endpoint_is_actually_called_now() -> None:
    """`get_mandates` was built, tested and never called (GAP-029).

    This is the assertion that it stopped being dead code — the same class of
    bug as `ef687e5`, caught the same way.
    """
    aw = StubAbgeordnetenwatch()
    pipeline, _ = build(abgeordnetenwatch=aw)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    assert aw.mandates_requested == [21]


def test_a_member_missing_from_the_roster_is_named_in_the_stage_notes() -> None:
    """The point of the whole reconciliation: surface the gap *now*.

    Before this ran, the same fact surfaced weeks later as a vote row that
    failed to resolve, with nothing saying why.
    """
    aw = StubAbgeordnetenwatch(
        politicians=[{"id": 900, "ext_id_bundestagsverwaltung": "11009999"}],
        mandates=[
            {
                "id": 1,
                "label": "Katrin Zschau (Bundestag 2025 - 2029)",
                "politician": {"id": 900},
                "start_date": "2026-07-20",
                "info": "Katrin Zschau ist am 20.07.2026 für Frank Junge nachgerückt.",
                "electoral_data": {"mandate_won": "moved_up"},
            }
        ],
    )
    pipeline, _ = build(abgeordnetenwatch=aw)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    notes = "\n".join(next(s for s in report.stages if s.name == "enrichment").notes)
    assert "Katrin Zschau" in notes
    assert "2026-07-20" in notes
    assert "Frank Junge" in notes


def test_reconciliation_posts_no_mp_of_its_own() -> None:
    """Read-only, and specifically never a writer.

    MdB-Stammdaten is the roster (§6.1). A member abgeordnetenwatch names and
    the dump does not is a *report*, not a row: writing one would put a
    community source's claim about who sits in the Bundestag into a table the
    rest of the site treats as official.
    """
    aw = StubAbgeordnetenwatch(
        politicians=[{"id": 900, "ext_id_bundestagsverwaltung": "11009999"}],
        mandates=[
            {
                "id": 1,
                "label": "Nobody Here (Bundestag 2025 - 2029)",
                "politician": {"id": 900},
                "start_date": "2026-07-20",
                "electoral_data": {"mandate_won": "moved_up"},
            }
        ],
    )
    pipeline, loader = build(abgeordnetenwatch=aw)
    report = RunReport(21, "sync")
    resolver = pipeline.load_roster(report)
    before = set(resolver.internal_ids())

    pipeline.load_enrichment(report)

    posted = {row["internalId"] for payload in loader.posted("mps") for row in payload["mps"]}
    assert posted <= before
    assert "bt-11009999" not in posted


def test_a_period_abgeordnetenwatch_does_not_cover_is_a_note_not_a_failure() -> None:
    """Its coverage starts at WP16; Bundestrack backfills to WP14 (§4.3).

    So a historical backfill hits this on every run, and it must not fail the
    enrichment stage — the portraits and contact blocks in the same stage are
    unaffected by a source that does not reach back that far.
    """
    from bundestrack.api.abgeordnetenwatch import LEGISLATURE_IDS

    class RaisingAW(StubAbgeordnetenwatch):
        def get_mandates(self, wahlperiode=21):
            raise ValueError(f"No abgeordnetenwatch legislature id for Wahlperiode {wahlperiode}")

    assert 14 not in LEGISLATURE_IDS
    pipeline, _ = build(abgeordnetenwatch=RaisingAW())
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    stage = next(s for s in report.stages if s.name == "enrichment")
    assert stage.ok
    assert any("No abgeordnetenwatch mandate list" in note for note in stage.notes)


def test_the_referral_pass_also_indexes_ballots_for_the_vote_stage() -> None:
    """One walk of `/vorgangsposition`, two facts taken from it.

    Every named vote is a `Vorgangsposition` too, so the steps the referral
    stage already reads carry the ballot → Vorgang link as well. A second sweep
    of the same 23 800–82 900 records through the WAF would buy nothing (§2.6),
    and without the link a ballot page cannot reach the §31 declarations filed
    on it — the sheet carries no id of any kind (§4.1, §7).
    """
    named = Vorgangsposition.model_validate(
        {
            "id": "696800",
            "vorgangsposition": "Beratung",
            "zuordnung": "BT",
            "gang": True,
            "fortsetzung": False,
            "nachtrag": False,
            "vorgangstyp": "Gesetzgebung",
            "typ": "Vorgangsposition",
            "titel": "Sportfördergesetz",
            "dokumentart": "Plenarprotokoll",
            "vorgang_id": "333135",
            "datum": "2026-07-10",
            "aktualisiert": "2026-07-20T10:47:41+02:00",
            "fundstelle": {
                "id": "5806",
                "dokumentnummer": "21/90",
                "dokumentart": "Plenarprotokoll",
                "datum": "2026-07-10",
                "herausgeber": "BT",
            },
            "beschlussfassung": [
                {
                    "beschlusstenor": "Annahme der Vorlage",
                    "abstimmungsart": "Namentliche Abstimmung",
                    "abstimm_ergebnis_bemerkung": "519:43:0",
                }
            ],
        }
    )
    pipeline, _ = build(dip=StubDIP(positionen=[named]))
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    # Keyed by sitting and tally, because the two sources share no identifier.
    assert pipeline._ballot_vorgaenge == {(90, 519, 43, 0): "333135"}
    stage = next(s for s in report.stages if s.name == "committee-referrals")
    assert any("named-vote steps indexed" in note for note in stage.notes)


# --- M1: cross-batch collisions in the ballot → Vorgang join --------------


def _named_step(*, id: str, vorgang_id: str, tally: str = "58:462:80") -> Vorgangsposition:
    """A `Vorgangsposition` shaped exactly like the ones DIP returns for a
    named vote — one per test, so the batching is what the assertion turns on
    rather than a per-batch fixture."""
    return Vorgangsposition.model_validate(
        {
            "id": id,
            "vorgangsposition": "Beratung",
            "zuordnung": "BT",
            "gang": True,
            "fortsetzung": False,
            "nachtrag": False,
            "vorgangstyp": "Gesetzgebung",
            "typ": "Vorgangsposition",
            "titel": f"Stub bill {id}",
            "dokumentart": "Plenarprotokoll",
            "vorgang_id": vorgang_id,
            "datum": "2026-07-10",
            "aktualisiert": "2026-07-20T10:47:41+02:00",
            "fundstelle": {
                "id": "5806",
                "dokumentnummer": "21/90",
                "dokumentart": "Plenarprotokoll",
                "datum": "2026-07-10",
                "herausgeber": "BT",
            },
            "beschlussfassung": [
                {
                    "beschlusstenor": "Ablehnung der Vorlage",
                    "abstimmungsart": "Namentliche Abstimmung",
                    "abstimm_ergebnis_bemerkung": tally,
                }
            ],
        }
    )


def test_a_ballot_key_two_procedures_claim_across_batches_is_dropped(monkeypatch) -> None:
    """M1: `_ballot_vorgaenge` must drop cross-batch collisions, not overwrite.

    `ballot_vorgang_index` already drops intra-batch collisions (verified in
    test_pipeline_transform.py::test_a_key_two_procedures_claim_is_dropped_rather_than_guessed).
    The one this asserts is the *cross*-batch one, which the intra-batch check
    cannot see: WP19 is ~166 batches of 500, and if two named votes with the
    same `(sitting, tally)` sit in different batches the naive `.update()`
    silently sets the map to whichever landed last.

    The batch size is monkeypatched down to 1 rather than fed one giant
    iterable, because the whole point of this regression is that each batch
    goes through its own call to `ballot_vorgang_index` and the merge is what
    needs to remember what the previous ones saw.
    """
    import bundestrack.pipeline.sync as sync_module

    monkeypatch.setattr(sync_module, "STREAM_BATCH", 1)

    first = _named_step(id="A", vorgang_id="V1", tally="58:462:80")
    second = _named_step(id="B", vorgang_id="V2", tally="58:462:80")

    pipeline, _ = build(dip=StubDIP(positionen=[first, second]))
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    key = (90, 58, 462, 80)
    assert key not in pipeline._ballot_vorgaenge, (
        "a cross-batch collision must drop the key; overwriting would attach "
        "a member's §31 declaration to a vote they did not cast it on"
    )
    assert key in pipeline._ambiguous_ballot_keys, (
        "the run-scoped ambiguity set must remember the collision so a later "
        "batch cannot silently re-add the same key"
    )


def test_a_later_batch_matching_an_already_ambiguous_key_stays_dropped(monkeypatch) -> None:
    """The ambiguity is sticky: once two procedures have claimed a key, a
    third arrival for the same key cannot rescue it — the *first* two are
    still incompatible, and there is no way from three claimants to a
    non-guess. Ordered so this batches as (V1), (V2), (V1) again — the third
    batch's `.update` on a fresh intra-batch map would put V1 back if the run
    scope forgot."""
    import bundestrack.pipeline.sync as sync_module

    monkeypatch.setattr(sync_module, "STREAM_BATCH", 1)

    pipeline, _ = build(
        dip=StubDIP(
            positionen=[
                _named_step(id="A", vorgang_id="V1"),
                _named_step(id="B", vorgang_id="V2"),
                _named_step(id="C", vorgang_id="V1"),
            ]
        )
    )
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_committee_referrals(report, since=None)

    assert (90, 58, 462, 80) not in pipeline._ballot_vorgaenge


# --- M2: a failed referrals stage must not blank existing links -----------


def _real_wp21_sheet_link() -> VoteSheetLink:
    """The 21/90/8 sheet's real link, matching the XLSX fixture we serve."""
    return VoteSheetLink(
        title="21. Wahlperiode: Namentliche Abstimmung Nr. 8, Sitzung 90",
        pdf_url="https://example.invalid/21_90_8.pdf",
        xlsx_url="https://example.invalid/21_90_8.xlsx",
        date=dt.date(2026, 7, 10),
    )


class RealVoteSheetStub(StubVotes):
    """A votes stub that parses the real 21/90/8 fixture on demand.

    The rest of the ballot tests raise on `fetch_sheet` because they only care
    about *which* sheets were paid for; the M2 regression is about what the
    payload for a *fetched* sheet contains, so this one has to answer with a
    real `VoteSheet`.
    """

    def fetch_sheet(self, link: VoteSheetLink):
        from bundestrack.api.votes import parse_sheet

        self.fetched.append(link.title)
        return parse_sheet(
            fixture_bytes("votes", "vote_21_90_8_excerpt.xlsx"),
            source_url=link.xlsx_url,
            title=link.title,
            sheet_date=link.date,
        )


def test_load_votes_after_a_failed_referrals_stage_does_not_erase_dip_vorgang_id(
    tmp_path,
) -> None:
    """M2: an operator re-runs `pixi run pipeline backfill --wp N` on
    already-populated data. The referrals stage errors — a WAF challenge, a
    DIP 5xx — and the `_guard` wrapper records it and lets the run continue.
    `load_votes` then walks every ballot and re-upserts it.

    Before the fix, `_ballot_vorgaenge.get(key)` returned `None` for every
    ballot (the map was still empty from `__init__`), the payload carried
    `dipVorgangId: null`, and Convex `patch` erased every previously-resolved
    link — silently, because `getExplanationCoverage` counts declarations and
    is unchanged by an unlinked ballot.

    The fix is in `vote_sheet_payload`, which now *omits* the key when the
    caller passes `None` — so `db.patch` does not touch the field and the
    stored value survives.
    """

    class ExplodingDIP(StubDIP):
        def iter_vorgangspositionen(self, *args, **kwargs):
            raise BundestagAPIError("stub: WAF challenge on /vorgangsposition")

    votes = RealVoteSheetStub([_real_wp21_sheet_link()])
    pipeline, loader = build(dip=ExplodingDIP(), votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)

    # The stage fails; `_guard` records the error and the run continues, which
    # is exactly the operational path this test covers.
    import contextlib

    with contextlib.suppress(BundestagAPIError):
        pipeline.load_committee_referrals(report, since=None)

    assert pipeline._ballot_vorgaenge == {}, (
        "the referrals stage must have contributed nothing — otherwise this "
        "test is asserting the wrong invariant"
    )
    pipeline.load_votes(report, incremental=False)

    (payload,) = [payload for path, payload in loader.payloads if path == "vote-sheets"]
    assert "dipVorgangId" not in payload, (
        "omitting the key preserves whatever the row already stored; sending "
        "null would erase every previously-resolved link on this ballot"
    )


class VorgangBackfillLoader(RecordingLoader):
    """A loader with a scriptable `missing_vote_vorgang` response, so the L3
    orchestration test can run without touching Convex.

    The real path talks to a live deployment through
    `voteSheetsMissingVorgang`; the pipeline logic under test here is the
    client-side join, the paging, and the counter aggregation — all of which
    are between the two ends and cannot be exercised through a dry run.
    """

    def __init__(self, missing_pages: list[dict]) -> None:
        super().__init__()
        self._missing = list(missing_pages)
        self.patch_calls: list[tuple[int, list[dict]]] = []

    def missing_vote_vorgang(self, wahlperiode, cursor=None, *, limit=200):
        if self._missing:
            return self._missing.pop(0)
        return {"sheets": [], "nextCursor": None, "done": True}

    def patch_vote_vorgang(self, wahlperiode, patches):
        self.patch_calls.append((wahlperiode, list(patches)))
        return {"patched": len(patches), "unchanged": 0, "conflicts": 0, "unknown": 0}


def test_backfill_vote_vorgang_joins_the_referral_map_to_unresolved_sheets(
    tmp_path,
) -> None:
    """L3: the pipeline builds the ballot → Vorgang map from `/vorgangsposition`,
    reads the ballots Convex still has no procedure for, joins them by
    `(sitting, tally)`, and patches only the ones that resolve.

    Unresolved sheets whose key is not in the map (a real divergence — a
    ballot DIP files under a different sitting or tally) stay unresolved
    rather than being guessed at: the L3 route is the same read model that
    the M2 fix protects on write, and it *cannot* invent a procedure it did
    not observe.
    """
    from bundestrack.models.dip import Vorgangsposition
    from bundestrack.pipeline.sync import backfill_vote_vorgang

    resolved = Vorgangsposition.model_validate(
        {
            "id": "696800",
            "vorgangsposition": "Beratung",
            "zuordnung": "BT",
            "gang": True,
            "fortsetzung": False,
            "nachtrag": False,
            "vorgangstyp": "Gesetzgebung",
            "typ": "Vorgangsposition",
            "titel": "Sportfördergesetz",
            "dokumentart": "Plenarprotokoll",
            "vorgang_id": "333135",
            "datum": "2026-07-10",
            "aktualisiert": "2026-07-20T10:47:41+02:00",
            "fundstelle": {
                "id": "5806",
                "dokumentnummer": "21/90",
                "dokumentart": "Plenarprotokoll",
                "datum": "2026-07-10",
                "herausgeber": "BT",
            },
            "beschlussfassung": [
                {
                    "beschlusstenor": "Annahme",
                    "abstimmungsart": "Namentliche Abstimmung",
                    "abstimm_ergebnis_bemerkung": "519:43:0",
                }
            ],
        }
    )
    loader = VorgangBackfillLoader(
        [
            {
                "sheets": [
                    # Resolved by the referral walk above.
                    {
                        "sitzungnr": 90,
                        "abstimmnr": 8,
                        "yesCount": 519,
                        "noCount": 43,
                        "abstainCount": 0,
                    },
                    # No matching step — DIP filed this under a different
                    # sitting or tally, so it stays unresolved.
                    {
                        "sitzungnr": 90,
                        "abstimmnr": 1,
                        "yesCount": 100,
                        "noCount": 200,
                        "abstainCount": 300,
                    },
                ],
                "nextCursor": None,
                "done": True,
            },
        ]
    )
    settings = Settings(
        _env_file=None,
        BUNDESTAG_API_KEY="test-key",
        CONVEX_URL="https://example.convex.cloud",
        PIPELINE_API_KEY="test-key",
        BUNDESTRACK_STATE_PATH=str(tmp_path / "state.json"),
    )
    pipeline_run = Pipeline(
        21,
        settings=settings,
        dry_run=True,
        dip=StubDIP(positionen=[resolved]),
        stammdaten=StubStammdaten(),
        protocols=StubClient(),
        votes=StubVotes(),
        profiles=StubProfiles(),
        abgeordnetenwatch=StubAbgeordnetenwatch(),
        loader=loader,
        state=SyncState(),
    )

    totals = backfill_vote_vorgang(21, settings=settings, pipeline=pipeline_run)

    assert totals["sheets_scanned"] == 2
    assert totals["patches_sent"] == 1, "only the resolved sheet is patched"
    # Only one page of patches — grouped by page, not by sheet.
    assert len(loader.patch_calls) == 1
    (_, patches) = loader.patch_calls[0]
    assert patches == [{"sitzungnr": 90, "abstimmnr": 8, "dipVorgangId": "333135"}]


def test_backfill_vote_vorgang_does_nothing_when_the_referral_walk_is_empty(
    tmp_path,
) -> None:
    """The route is deliberately a no-op when there is nothing to attach.

    An empty referral map means either the source published nothing new (fine)
    or the referral stage errored (bad) — and either way, sending patches with
    no source data would be exactly the M2 failure mode (erasing existing
    links or, here, guessing new ones). So this stops early and reports zero.
    """
    from bundestrack.pipeline.sync import backfill_vote_vorgang

    loader = VorgangBackfillLoader([])
    settings = Settings(
        _env_file=None,
        BUNDESTAG_API_KEY="test-key",
        CONVEX_URL="https://example.convex.cloud",
        PIPELINE_API_KEY="test-key",
        BUNDESTRACK_STATE_PATH=str(tmp_path / "state.json"),
    )
    pipeline_run = Pipeline(
        21,
        settings=settings,
        dry_run=True,
        dip=StubDIP(positionen=[]),
        stammdaten=StubStammdaten(),
        protocols=StubClient(),
        votes=StubVotes(),
        profiles=StubProfiles(),
        abgeordnetenwatch=StubAbgeordnetenwatch(),
        loader=loader,
        state=SyncState(),
    )

    totals = backfill_vote_vorgang(21, settings=settings, pipeline=pipeline_run)

    assert totals["sheets_scanned"] == 0
    assert totals["patches_sent"] == 0
    assert loader.patch_calls == []


def test_backfill_vote_vorgang_reads_the_full_period_not_the_daily_sync_window(
    tmp_path,
) -> None:
    """NEW-H1: a maintenance backfill must not window on the daily sync's
    referral watermark.

    The whole point of this route is to catch ballots whose referring
    `Vorgangsposition` surfaced *before* the daily sync's `STREAM_REFERRALS`
    watermark — those referrals are, by construction, older than the
    watermark, so a windowed fetch (`updated_since=<watermark>`) filters out
    the exact records the route was written to catch.

    Before the fix, `backfill_vote_vorgang` built the `Pipeline` without
    `full=True`; `_window(STREAM_REFERRALS, None)` then returned the
    stored-watermark-minus-OVERLAP for any non-empty state. The CLI reported
    success (`scanned N, sent 0`) while patching nothing. Verified here by
    seeding a real STREAM_REFERRALS watermark and asserting the DIP client
    received `updated_since=None`.

    Also asserts the watermark is **unchanged** after the run: this route
    re-reads the whole period, and advancing the daily sync's own mark past
    what it has actually processed would risk shrinking a future sync's
    window across the OVERLAP gap.
    """
    from bundestrack.pipeline.sync import backfill_vote_vorgang

    dip = StubDIP(positionen=[])
    loader = VorgangBackfillLoader([])
    settings = Settings(
        _env_file=None,
        BUNDESTAG_API_KEY="test-key",
        CONVEX_URL="https://example.convex.cloud",
        PIPELINE_API_KEY="test-key",
        BUNDESTRACK_STATE_PATH=str(tmp_path / "state.json"),
    )
    state = SyncState()
    # A real, plausible watermark — three days behind the newest referral the
    # source would return. The prior bug computed the window from this, and
    # `iter_vorgangspositionen` would only see records with
    # `aktualisiert >= watermark - OVERLAP` — the class the route exists to
    # catch is precisely everything before.
    stored_mark = "2026-07-25T12:00:00+00:00"
    state.watermarks["21:vorgangsposition"] = stored_mark

    pipeline_run = Pipeline(
        21,
        settings=settings,
        dry_run=True,
        dip=dip,
        stammdaten=StubStammdaten(),
        protocols=StubClient(),
        votes=StubVotes(),
        profiles=StubProfiles(),
        abgeordnetenwatch=StubAbgeordnetenwatch(),
        loader=loader,
        state=state,
    )

    backfill_vote_vorgang(21, settings=settings, pipeline=pipeline_run)

    # The referral walk saw the full period, not a windowed slice.
    assert dip.referral_since == [None], (
        f"expected updated_since=None on the referral walk, got {dip.referral_since}. "
        "A windowed fetch here filters out the exact class of record this "
        "maintenance route was written to catch."
    )
    # The watermark the daily sync depends on is restored to what it was.
    assert state.watermarks.get("21:vorgangsposition") == stored_mark, (
        "the maintenance route must not advance the daily sync's referral "
        "watermark — the two runs have different responsibilities and only "
        "the daily sync's advance means 'this is where I got to'"
    )


def test_backfill_vote_vorgang_preserves_the_watermark_even_when_referrals_arrive(
    tmp_path,
) -> None:
    """Companion to the test above — same guarantee, non-empty referral stream.

    The `restore_watermark` call must fire on the happy path too, not only
    when the referral walk returns nothing. Otherwise a `backfill_vote_vorgang`
    on a period that has current referrals would advance the mark to the
    newest record's timestamp — the exact side effect the fix exists to
    prevent.
    """
    from bundestrack.models.dip import Vorgangsposition
    from bundestrack.pipeline.sync import backfill_vote_vorgang

    fresh = Vorgangsposition.model_validate(
        {
            "id": "1",
            "vorgangsposition": "Beratung",
            "zuordnung": "BT",
            "gang": True,
            "fortsetzung": False,
            "nachtrag": False,
            "vorgangstyp": "Gesetzgebung",
            "typ": "Vorgangsposition",
            "titel": "Fresh referral",
            "dokumentart": "Plenarprotokoll",
            "vorgang_id": "V1",
            "datum": "2026-07-28",
            # Newer than the stored watermark below — a monotonic `advance`
            # would happily move the mark to this timestamp; the restore
            # is what stops it.
            "aktualisiert": "2026-07-28T09:00:00+00:00",
            "fundstelle": {
                "id": "5806",
                "dokumentnummer": "21/91",
                "dokumentart": "Plenarprotokoll",
                "datum": "2026-07-28",
                "herausgeber": "BT",
            },
            "ueberweisung": [
                {
                    "ausschuss": "Ausschuss für Sport",
                    "ausschuss_kuerzel": "AfS",
                    "federfuehrung": True,
                }
            ],
        }
    )
    settings = Settings(
        _env_file=None,
        BUNDESTAG_API_KEY="test-key",
        CONVEX_URL="https://example.convex.cloud",
        PIPELINE_API_KEY="test-key",
        BUNDESTRACK_STATE_PATH=str(tmp_path / "state.json"),
    )
    state = SyncState()
    stored_mark = "2026-07-25T12:00:00+00:00"
    state.watermarks["21:vorgangsposition"] = stored_mark

    pipeline_run = Pipeline(
        21,
        settings=settings,
        dry_run=True,
        dip=StubDIP(positionen=[fresh]),
        stammdaten=StubStammdaten(),
        protocols=StubClient(),
        votes=StubVotes(),
        profiles=StubProfiles(),
        abgeordnetenwatch=StubAbgeordnetenwatch(),
        loader=VorgangBackfillLoader([]),
        state=state,
    )

    backfill_vote_vorgang(21, settings=settings, pipeline=pipeline_run)

    assert state.watermarks.get("21:vorgangsposition") == stored_mark


def test_load_votes_with_a_populated_map_carries_the_resolved_procedure(tmp_path) -> None:
    """The happy path, kept as a companion to the M2 test above so a fix that
    accidentally omits the key *always* — even when resolved — fails here."""
    from bundestrack.pipeline.transform import ballot_key

    votes = RealVoteSheetStub([_real_wp21_sheet_link()])
    pipeline, loader = build(dip=StubDIP(), votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    # A resolved link, as if the referrals stage had run and found this
    # ballot's procedure. The key comes from the same `ballot_key` helper the
    # production code uses, so the two sides cannot silently diverge.
    sheet = votes.fetch_sheet(_real_wp21_sheet_link())
    votes.fetched.clear()
    pipeline._ballot_vorgaenge[ballot_key(sheet)] = "333135"

    pipeline.load_votes(report, incremental=False)

    (payload,) = [payload for path, payload in loader.payloads if path == "vote-sheets"]
    assert payload["dipVorgangId"] == "333135"
