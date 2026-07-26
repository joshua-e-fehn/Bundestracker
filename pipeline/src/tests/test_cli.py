"""The CLI surface: commands exist, and a misconfigured run fails readably."""

from __future__ import annotations

import pytest
from click.testing import CliRunner

from bundestrack.cli import cli
from bundestrack.config import get_settings


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
    for name in ("CONVEX_URL", "BUNDESTAG_API_KEY", "BUNDESTAG_API_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_help_lists_every_command(runner: CliRunner) -> None:
    result = runner.invoke(cli, ["--help"])

    assert result.exit_code == 0
    for command in ("init", "sync", "backfill", "status"):
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


def test_data_commands_report_that_the_stages_are_not_wired_up(
    runner: CliRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    # With config satisfied, the commands get as far as the fetch and stop
    # there — this is the scaffold's honest failure, and the test pins it so
    # that implementing the stages has to delete it deliberately.
    monkeypatch.setenv("BUNDESTAG_API_KEY", "test-key")
    monkeypatch.setenv("CONVEX_URL", "https://example.convex.cloud")
    # The autouse fixture cleared the cache before this test *started*, i.e.
    # before these two variables existed. Clear again so the CLI reads them.
    get_settings.cache_clear()

    for argv in (["init"], ["sync"], ["backfill", "--wp", "20"]):
        result = runner.invoke(cli, argv)

        assert result.exit_code != 0, argv
        assert "not wired up yet" in result.output, argv
