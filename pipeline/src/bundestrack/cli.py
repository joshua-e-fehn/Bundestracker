"""Command-line entry point for the Bundestrack pipeline.

Three commands, matching the three times data moves:

    init                 first full fetch of the current electoral period
    sync                 daily incremental fetch (what the cron runs)
    backfill --wp 20     one named electoral period, start to finish

Every command is a thin shell here: argument parsing and reporting only. The
fetching lives in `bundestrack.api`, the transforms in `bundestrack.models`,
and the orchestration in `bundestrack.pipeline` — those packages are scaffolds
today, which is why each command below reports its plan and exits.

    python -m bundestrack.cli sync
    pixi run pipeline sync
"""

from __future__ import annotations

import logging
import sys

import click

from bundestrack import __version__
from bundestrack.config import ConfigError, get_settings

logger = logging.getLogger("bundestrack")

# The 20th Wahlperiode is the one Bundestrack tracks by default; `backfill`
# takes an explicit `--wp` for the historical ones.
CURRENT_ELECTORAL_PERIOD = 21

NOT_IMPLEMENTED_HINT = (
    "The fetch/transform/load stages are not wired up yet — this is the "
    "scaffold. See bundestrack/pipeline/ for where they land."
)


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, prog_name="bundestrack")
@click.option("-v", "--verbose", is_flag=True, help="Debug-level logging.")
@click.option(
    "--dry-run",
    is_flag=True,
    help="Fetch and transform, but write nothing to Convex.",
)
@click.pass_context
def cli(ctx: click.Context, verbose: bool, dry_run: bool) -> None:
    """Bundestrack — Bundestag activity data pipeline."""
    _configure_logging(verbose)
    ctx.ensure_object(dict)
    ctx.obj["dry_run"] = dry_run
    ctx.obj["settings"] = get_settings()


@cli.command()
@click.pass_context
def init(ctx: click.Context) -> None:
    """Full initial backfill of the current electoral period."""
    _run(ctx, "init", electoral_period=CURRENT_ELECTORAL_PERIOD)


@cli.command()
@click.option(
    "--since",
    metavar="DATE",
    help="ISO date to fetch changes from. Defaults to the last recorded sync.",
)
@click.pass_context
def sync(ctx: click.Context, since: str | None) -> None:
    """Daily incremental sync. This is what the system cron runs."""
    _run(ctx, "sync", electoral_period=CURRENT_ELECTORAL_PERIOD, since=since)


@cli.command()
@click.option(
    "--wp",
    "electoral_period",
    type=int,
    required=True,
    metavar="N",
    help="Wahlperiode to backfill, e.g. 20.",
)
@click.pass_context
def backfill(ctx: click.Context, electoral_period: int) -> None:
    """Backfill one named electoral period."""
    _run(ctx, "backfill", electoral_period=electoral_period)


@cli.command()
@click.pass_context
def status(ctx: click.Context) -> None:
    """Print the resolved configuration and exit.

    Written for the cron host: it answers "is this box configured?" without
    making a single API call or writing anything.
    """
    settings = ctx.obj["settings"]
    click.echo(f"bundestrack {__version__}")
    click.echo(f"  Convex URL:    {settings.convex_url or '(unset)'}")
    click.echo(f"  DIP base URL:  {settings.bundestag_api_base_url}")
    click.echo(f"  DIP API key:   {'set' if settings.bundestag_api_key else '(unset)'}")
    click.echo(f"  Electoral period: {CURRENT_ELECTORAL_PERIOD}")


def _run(
    ctx: click.Context,
    stage: str,
    *,
    electoral_period: int,
    since: str | None = None,
) -> None:
    """Shared body of the three data commands.

    They differ only in which records they ask for, so the config check, the
    logging and the not-yet-implemented exit live here once.
    """
    settings = ctx.obj["settings"]
    dry_run = ctx.obj["dry_run"]

    logger.info(
        "%s: electoral period %s%s%s",
        stage,
        electoral_period,
        f", since {since}" if since else "",
        " (dry run)" if dry_run else "",
    )

    try:
        settings.require_api_key()
        if not dry_run:
            settings.require_convex_url()
    except ConfigError as error:
        raise click.ClickException(str(error)) from error

    raise click.ClickException(NOT_IMPLEMENTED_HINT)


def main() -> None:
    """Console-script entry point (`bundestrack`, `python -m bundestrack.cli`)."""
    cli(obj={})


if __name__ == "__main__":
    main()
