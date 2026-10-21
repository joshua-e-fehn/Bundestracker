"""The daily-sync wrapper: target pin, non-overlap, bounded runtime, status.

Hermetic: `pixi` is a stub script on PATH that records how it was called and
exits with whatever the test asks for, and every path the wrapper writes is a
temp dir. Nothing here reaches a network or a deployment.

Run with the pipeline suite: `pytest ../scripts/tests` from `pipeline/`.
"""

from __future__ import annotations

import json
import subprocess
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
    pixi.write_text(
        "#!/usr/bin/env bash\n"
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
    assert args == f"run --manifest-path {host['repo']}/pixi.toml pipeline sync"
    log = (host["logs"] / "daily-sync.log").read_text()
    assert f"target={TARGET}.convex.cloud" in log
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
    sleeper = subprocess.Popen(
        ["bash", "-c", "exec -a fake-run-enrichment.py sleep 30"]
    )
    try:
        result = run(host, BUNDESTRACK_WRITER_PATTERN="fake-run-enrichment\\.py")
    finally:
        sleeper.kill()
        sleeper.wait()

    assert result.returncode == 75
    assert not host["calls"].exists()


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
