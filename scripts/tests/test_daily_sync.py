"""The daily-sync wrapper: target pin, non-overlap, bounded runtime, status.

Hermetic: `pixi` is a stub script on PATH that records how it was called and
exits with whatever the test asks for, and every path the wrapper writes is a
temp dir. Nothing here reaches a network or a deployment.

Collected by the pipeline suite (`pipeline/pyproject.toml` testpaths), so
`pixi run test` runs it.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "daily-sync.sh"
TARGET = "whimsical-bandicoot-307"


@pytest.fixture
def host(tmp_path: Path) -> dict[str, Path]:
    """A fake checkout with a pipeline/.env, plus a stub pixi on PATH."""
    repo = tmp_path / "repo"
    (repo / "pipeline").mkdir(parents=True)
    (repo / "pipeline" / ".env").write_text(
        f"CONVEX_URL=https://{TARGET}.convex.cloud\nPIPELINE_API_KEY=secret-not-logged\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "pixi-calls"
    pixi = bin_dir / "pixi"
    # `pixi run … python -c …` is the wrapper's target preflight: run it for
    # real, with this interpreter and the shipped `bundestrack.config`, so the
    # pin under test is the pipeline's own. `pixi run … pipeline sync` is the
    # sync itself, which is stubbed.
    pixi.write_text(
        "#!/usr/bin/env bash\n"
        'if [ "${@: -2:1}" = "-c" ]; then\n'
        f'  exec "{sys.executable}" -c "${{@: -1}}"\n'
        "fi\n"
        f'echo "$PYTHONPATH|$*" >> "{calls}"\n'
        'if [ -n "${STUB_SLEEP:-}" ]; then sleep "$STUB_SLEEP"; fi\n'
        'echo "stub pipeline output"\n'
        'exit "${STUB_EXIT:-0}"\n'
    )
    pixi.chmod(0o755)
    return {"repo": repo, "bin": bin_dir, "calls": calls, "logs": tmp_path / "logs"}


def run(host: dict[str, Path], **env: str) -> subprocess.CompletedProcess[str]:
    environment = {
        "PATH": f"{host['bin']}:/usr/bin:/bin",
        "HOME": str(host["repo"].parent),
        "BUNDESTRACK_REPO_ROOT": str(host["repo"]),
        "BUNDESTRACK_LOG_DIR": str(host["logs"]),
        "BUNDESTRACK_LOCK_FILE": str(host["repo"] / ".daily-sync.lock"),
        # A pattern no real process matches, so a developer's own running
        # pipeline cannot make these tests skip. One test overrides it.
        "BUNDESTRACK_WRITER_PATTERN": "no-such-process-[x]yz",
        **env,
    }
    return subprocess.run(
        ["bash", str(SCRIPT)],
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )


def status(host: dict[str, Path]) -> dict:
    return json.loads((host["logs"] / "daily-sync.status.json").read_text())


def test_a_successful_run_records_last_success_and_runs_the_shipped_code(host) -> None:
    result = run(host)

    assert result.returncode == 0, result.stderr
    recorded = status(host)
    assert recorded["last_success"]["exit_code"] == 0
    assert recorded["consecutive_failures"] == 0
    assert "last_failure" not in recorded
    pythonpath, args = host["calls"].read_text().strip().split("|")
    assert pythonpath.startswith(str(SCRIPT.parents[1] / "pipeline" / "src"))
    assert args == f"run --frozen --manifest-path {host['repo']}/pixi.toml pipeline sync"
    log = (host["logs"] / "daily-sync.log").read_text()
    assert f"target={TARGET}.convex.site" in log, "the log names the host writes go to"
    assert "stub pipeline output" in log
    assert "secret-not-logged" not in log


def test_a_failed_stage_is_a_recorded_failure_and_keeps_the_last_success(host) -> None:
    run(host)
    result = run(host, STUB_EXIT="1")

    assert result.returncode == 1
    recorded = status(host)
    assert recorded["last_failure"]["exit_code"] == 1
    assert recorded["last_success"]["exit_code"] == 0, "a failure must not erase it"
    assert recorded["consecutive_failures"] == 1


def test_the_wrong_deployment_is_refused_before_anything_runs(host) -> None:
    (host["repo"] / "pipeline" / ".env").write_text(
        "CONVEX_URL=https://intent-goshawk-405.convex.cloud\n"
    )

    result = run(host)

    assert result.returncode == 78
    assert not host["calls"].exists(), "pixi must not have been invoked"
    assert status(host)["last_attempt"]["outcome"] == "config-error"


def test_the_environment_target_wins_over_the_env_file_and_is_checked_too(host) -> None:
    result = run(host, CONVEX_URL="https://festive-monitor-280.convex.cloud")

    assert result.returncode == 78
    assert not host["calls"].exists()


def test_a_wrong_write_host_is_refused_even_when_the_read_host_is_right(host) -> None:
    """Writes go to CONVEX_HTTP_URL when it is set (scheduler review B1)."""
    (host["repo"] / "pipeline" / ".env").write_text(
        f"CONVEX_URL=https://{TARGET}.convex.cloud\n"
        "CONVEX_HTTP_URL=https://intent-goshawk-405.convex.site\n"
    )

    result = run(host)

    assert result.returncode == 78
    assert not host["calls"].exists()
    assert "intent-goshawk-405" in (host["logs"] / "daily-sync.log").read_text()


def test_a_wrong_write_host_in_the_environment_is_refused(host) -> None:
    result = run(host, CONVEX_HTTP_URL="https://intent-goshawk-405.convex.site")

    assert result.returncode == 78
    assert not host["calls"].exists()


def test_a_lowercase_env_key_naming_another_deployment_is_refused(host) -> None:
    """pydantic-settings reads `.env` keys case-insensitively; a shell grep for
    the uppercase name would not see this one, the pipeline's own check does."""
    (host["repo"] / "pipeline" / ".env").write_text(
        f"CONVEX_URL=https://{TARGET}.convex.cloud\n"
        "convex_http_url=https://intent-goshawk-405.convex.site\n"
    )

    result = run(host)

    assert result.returncode == 78
    assert not host["calls"].exists()


def test_a_matching_write_host_is_accepted(host) -> None:
    (host["repo"] / "pipeline" / ".env").write_text(
        f"CONVEX_URL=https://{TARGET}.convex.cloud\nCONVEX_HTTP_URL=https://{TARGET}.convex.site\n"
    )

    assert run(host).returncode == 0


def test_the_pin_reaches_the_pipeline_process(host) -> None:
    """The wrapper's preflight is a courtesy; the pin that guards each write is
    the pipeline's, so the variable must reach the sync's environment."""
    probe = host["bin"] / "pixi"
    probe.write_text(
        probe.read_text().replace(
            'echo "stub pipeline output"',
            f'echo "pin=$BUNDESTRACK_EXPECTED_DEPLOYMENT" >> "{host["calls"]}"',
        )
    )

    assert run(host).returncode == 0
    assert f"pin={TARGET}" in host["calls"].read_text()


def test_a_held_lock_skips_the_tick_without_running(host) -> None:
    lock = host["repo"] / ".daily-sync.lock"
    holder = subprocess.Popen(["flock", str(lock), "sleep", "30"])
    try:
        # Wait until the holder actually has it.
        for _ in range(50):
            probe = subprocess.run(["flock", "-n", str(lock), "true"])
            if probe.returncode != 0:
                break
            subprocess.run(["sleep", "0.1"])
        result = run(host)
    finally:
        holder.kill()
        holder.wait()

    assert result.returncode == 75
    assert not host["calls"].exists()
    assert status(host)["last_attempt"]["outcome"] == "skipped"
    assert "consecutive_failures" not in status(host), "a skip is not a failure"


def test_an_unlocked_writer_process_skips_the_tick(host) -> None:
    sleeper = subprocess.Popen(["bash", "-c", "exec -a fake-run-enrichment.py sleep 30"])
    try:
        result = run(host, BUNDESTRACK_WRITER_PATTERN="fake-run-enrichment\\.py")
    finally:
        sleeper.kill()
        sleeper.wait()

    assert result.returncode == 75
    assert not host["calls"].exists()


def _default_writer_pattern() -> str:
    text = SCRIPT.read_text()
    marker = 'WRITER_PATTERN="${BUNDESTRACK_WRITER_PATTERN:-'
    start = text.index(marker) + len(marker)
    return text[start : text.index('}"', start)]


def _is_writer(command_line: str) -> bool:
    """Whether the shipped pattern classes `command_line` as a pipeline writer.

    Offline on purpose: `grep -E` speaks the same POSIX ERE `pgrep -f` matches
    against `/proc/<pid>/cmdline`, so the classification is tested without
    reading the host's process table. A test that called `pgrep` would pass or
    fail depending on whether a real sync happened to be running — which, on
    the production host, it legitimately may be.
    """
    result = subprocess.run(
        ["grep", "-Eq", _default_writer_pattern()], input=command_line + "\n", text=True
    )
    return result.returncode == 0


#: Real command lines of every production writer. The pixi env's interpreter is
#: an absolute path; `historical-backfill.sh` runs `"$PYTHON" -m bundestrack.cli`.
WRITERS = [
    "/opt/data/workspace/Bundestrack/.pixi/envs/default/bin/python -m bundestrack.cli sync",
    "python -m bundestrack.cli backfill --wp 20",
    "python3 -u -m bundestrack.cli init",
    "python -m bundestrack.cli -v sync",
    "python -m bundestrack.cli -v backfill --wp 19",
    "python -m bundestrack.cli --verbose --dry-run sync",
    "python -m bundestrack.cli backfill-vote-vorgang --wp 21",
    # The console script, as the kernel records it: shebang interpreter first.
    "/opt/data/workspace/Bundestrack/.pixi/envs/default/bin/python3.13 "
    "/opt/data/workspace/Bundestrack/.pixi/envs/default/bin/bundestrack -v sync",
    "python3 scripts/run-enrichment.py",
    "/usr/bin/python3.12 /opt/data/workspace/Bundestrack/scripts/score-period.py --wp 19",
]

#: Processes whose command lines mention a writer without being one.
BYSTANDERS = [
    "bash -c sleep 30; echo python -m bundestrack.cli sync run-enrichment.py",
    "vim scripts/run-enrichment.py",
    "grep -E bundestrack.cli sync daily-sync.log",
    "python -m bundestrack.cli status",
    "python -m bundestrack.cli scores --wp 21",
    "tail -f /opt/data/workspace/Bundestrack/.logs/daily-sync.log",
]


@pytest.mark.parametrize("command_line", WRITERS)
def test_every_production_writer_form_is_detected(command_line: str) -> None:
    assert _is_writer(command_line)


@pytest.mark.parametrize("command_line", BYSTANDERS)
def test_a_command_that_merely_mentions_a_writer_is_not_one(command_line: str) -> None:
    assert not _is_writer(command_line)


def test_a_run_past_its_bound_is_stopped_and_recorded_as_a_timeout(host) -> None:
    result = run(host, STUB_SLEEP="20", BUNDESTRACK_SYNC_TIMEOUT="1s")

    assert result.returncode == 124
    recorded = status(host)
    assert recorded["last_attempt"]["outcome"] == "timeout"
    assert recorded["consecutive_failures"] == 1


def test_a_missing_env_file_is_a_config_error(host, tmp_path) -> None:
    result = run(host, BUNDESTRACK_ENV_FILE=str(tmp_path / "absent.env"))

    assert result.returncode == 78
    assert not host["calls"].exists()
