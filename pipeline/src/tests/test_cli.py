"""The CLI surface: commands exist, and a misconfigured run fails readably."""

from __future__ import annotations

from datetime import datetime

import pytest
from click.testing import CliRunner

from bundestrack.cli import cli
from bundestrack.config import get_settings
from bundestrack.pipeline import sync as pipeline
from bundestrack.pipeline.join import QuarantinedName
from bundestrack.pipeline.state import STREAM_ACTIVITIES, SyncState, save_state
from bundestrack.pipeline.sync import RunReport


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


@pytest.fixture(autouse=True)
def _clear_environment(monkeypatch: pytest.MonkeyPatch):
    """Run each test against a blank, uncached environment.

    Two separate hazards:

    - Without `delenv`, the suite would pass or fail depending on whether the
      developer happens to have a DIP key exported.
    - Without `cache_clear`, it would depend on test *order*: `get_settings` is
      `lru_cache`d, so the first test to call it fixes the configuration for
      every test after it. Cleared on the way out as well, so a cached blank
      environment does not leak into another module's tests.
    """
    for name in (
        "CONVEX_URL",
        "CONVEX_HTTP_URL",
        "BUNDESTAG_API_KEY",
        "BUNDESTAG_API_BASE_URL",
        "PIPELINE_API_KEY",
        "BUNDESTRACK_STATE_PATH",
    ):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_help_lists_every_command(runner: CliRunner) -> None:
    result = runner.invoke(cli, ["--help"])

    assert result.exit_code == 0
    for command in ("init", "sync", "backfill", "scores", "status"):
        assert command in result.output


def test_status_reports_config_without_requiring_it(runner: CliRunner) -> None:
    # The point of `status` is to answer "is this host configured?", so it has
    # to run *on an unconfigured host* rather than exit non-zero.
    result = runner.invoke(cli, ["status"])

    assert result.exit_code == 0
    assert "(unset)" in result.output


def test_sync_without_an_api_key_says_which_variable_is_missing(runner: CliRunner) -> None:
    result = runner.invoke(cli, ["sync"])

    assert result.exit_code != 0
    assert "BUNDESTAG_API_KEY" in result.output


def test_backfill_requires_an_electoral_period(runner: CliRunner) -> None:
    result = runner.invoke(cli, ["backfill"])

    assert result.exit_code != 0
    assert "--wp" in result.output


def test_sync_without_an_ingestion_key_says_which_variable_is_missing(
    runner: CliRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both keys are checked before the fetch, not at the first write.

    The ingestion API denies on an unset key rather than allowing
    (webapp/convex/http.ts), and a WP21 init is hours of sequential fetching
    (§2.6) — so discovering a missing key at the first POST means paying for
    the whole fetch and writing none of it.
    """
    monkeypatch.setenv("BUNDESTAG_API_KEY", "test-key")
    monkeypatch.setenv("CONVEX_URL", "https://example.convex.cloud")
    # The autouse fixture cleared the cache before this test *started*, i.e.
    # before these variables existed. Clear again so the CLI reads them.
    get_settings.cache_clear()

    for argv in (["init"], ["sync"], ["backfill", "--wp", "20"]):
        result = runner.invoke(cli, argv)

        assert result.exit_code != 0, argv
        assert "PIPELINE_API_KEY" in result.output, argv


def test_a_dry_run_needs_no_convex_configuration_at_all(
    runner: CliRunner, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """`--dry-run` fetches and transforms but writes nothing.

    So it must run on a host with no deployment configured — that is what makes
    a transform change reviewable without one. Stubbed at the pipeline boundary
    because the point here is the CLI's wiring, not the stages.
    """
    monkeypatch.setenv("BUNDESTAG_API_KEY", "test-key")
    monkeypatch.setenv("BUNDESTRACK_STATE_PATH", str(tmp_path / "state.json"))
    get_settings.cache_clear()

    calls: list[tuple[int, bool]] = []

    def fake_init(wahlperiode: int, **kwargs: object) -> RunReport:
        calls.append((wahlperiode, bool(kwargs.get("dry_run"))))
        return RunReport(wahlperiode, "init")

    monkeypatch.setattr(pipeline, "init", fake_init)
    result = runner.invoke(cli, ["--dry-run", "init"])

    assert result.exit_code == 0, result.output
    assert calls == [(pipeline.CURRENT_WAHLPERIODE, True)]


def test_a_failed_stage_exits_non_zero_even_though_others_committed(
    runner: CliRunner, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """A cron that sees success because *most* of it worked is how a broken
    source stays broken for a week. The stages that succeeded keep their
    writes — every one is an upsert — but the run reports failure."""
    monkeypatch.setenv("BUNDESTAG_API_KEY", "test-key")
    monkeypatch.setenv("BUNDESTRACK_STATE_PATH", str(tmp_path / "state.json"))
    get_settings.cache_clear()

    def fake_sync(wahlperiode: int, **kwargs: object) -> RunReport:
        report = RunReport(wahlperiode, "sync")
        report.stage("roster").result = None
        report.stage("votes").error = "the listing timed out"
        return report

    monkeypatch.setattr(pipeline, "sync", fake_sync)
    result = runner.invoke(cli, ["--dry-run", "sync"])

    assert result.exit_code != 0
    assert "votes: FAILED" in result.output
    assert "the listing timed out" in result.output


def test_status_reports_the_watermark_and_the_quarantine(
    runner: CliRunner, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """The two numbers that say whether the pipeline is keeping up.

    A quarantine count is §7.3's staleness made visible: the Stammdaten dump
    lags reality, and unresolved names are held for a later sync rather than
    dropped, so a growing count is the signal that the snapshot is behind.
    """
    state_path = tmp_path / "state.json"
    state = SyncState(stammdaten_version="1777449783")
    state.advance(
        pipeline.CURRENT_WAHLPERIODE,
        STREAM_ACTIVITIES,
        datetime.fromisoformat("2026-07-20T10:47:41+02:00"),
    )
    state.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Glaser", vorname="Stefan", wahlperiode=21)
    )
    save_state(state_path, state)

    monkeypatch.setenv("BUNDESTRACK_STATE_PATH", str(state_path))
    get_settings.cache_clear()
    result = runner.invoke(cli, ["status"])

    assert result.exit_code == 0
    assert "2026-07-20T10:47:41+02:00" in result.output
    assert STREAM_ACTIVITIES in result.output
    assert "1777449783" in result.output
    assert "1 unresolved names" in result.output
