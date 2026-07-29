"""Command-line entry point for the Bundestrack pipeline.

Four commands, matching the four times data moves:

    init                 first full fetch of the current electoral period
    sync                 daily incremental fetch (what the cron runs)
    backfill --wp 20     one named electoral period, start to finish
    scores               recompute activity scores now, without waiting

Every command is a thin shell here: argument parsing and reporting only. The
fetching lives in `bundestrack.api`, the transforms in `bundestrack.models` and
`bundestrack.pipeline.transform`, and the orchestration in
`bundestrack.pipeline.sync`.

    python -m bundestrack.cli sync
    pixi run pipeline sync

Exit codes matter to the cron that runs this: a run in which any stage failed
exits non-zero, even though the other stages committed their work. The
alternative — reporting success because *most* of it worked — is how a source
stays broken for a week.
"""

from __future__ import annotations

import logging
import sys

import click

from bundestrack import __version__
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.config import ConfigError, get_settings
from bundestrack.pipeline import sync as pipeline
from bundestrack.pipeline.state import load_state

logger = logging.getLogger("bundestrack")

# The Wahlperiode Bundestrack tracks by default; `backfill` takes an explicit
# `--wp` for the historical ones. Defined in the pipeline, not here, so the
# orchestration and the CLI cannot disagree about which period is current.
CURRENT_ELECTORAL_PERIOD = pipeline.CURRENT_WAHLPERIODE


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
    """Full initial backfill of the current electoral period.

    Hours, sequentially: WP21 is 80 537 activities over ~806 pages plus 90
    protocols and every named ballot, and the Enodia WAF IP-blocks a pipeline
    that hurries (docs/api-research.md §2.6).
    """
    _run(
        ctx,
        "init",
        electoral_period=CURRENT_ELECTORAL_PERIOD,
        run=lambda **kwargs: pipeline.init(CURRENT_ELECTORAL_PERIOD, **kwargs),
    )


@cli.command()
@click.option(
    "--since",
    metavar="DATE",
    help="ISO date to fetch changes from. Defaults to the last recorded sync.",
)
@click.pass_context
def sync(ctx: click.Context, since: str | None) -> None:
    """Daily incremental sync. This is what the system cron runs."""
    _run(
        ctx,
        "sync",
        electoral_period=CURRENT_ELECTORAL_PERIOD,
        since=since,
        run=lambda **kwargs: pipeline.sync(CURRENT_ELECTORAL_PERIOD, since=since, **kwargs),
    )


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
    """Backfill one named electoral period.

    Older periods return less, for structural reasons the run reports rather
    than hides: no committee data before the current period (§6.4), no protocol
    XML before WP18 (§5.2), no vote sheets before roughly WP17 (§4.1).
    """
    _run(
        ctx,
        "backfill",
        electoral_period=electoral_period,
        run=lambda **kwargs: pipeline.backfill(electoral_period, **kwargs),
    )


@cli.command("backfill-vote-vorgang")
@click.option(
    "--wp",
    "electoral_period",
    type=int,
    default=CURRENT_ELECTORAL_PERIOD,
    show_default=True,
    metavar="N",
    help="Wahlperiode whose late Vorgang links to patch.",
)
@click.pass_context
def backfill_vote_vorgang(ctx: click.Context, electoral_period: int) -> None:
    """Patch late ballot → Vorgang links without re-ingesting the ballots.

    Bounded and idempotent: it walks the referrals for the period once, then
    pages through voteSheets missing a procedure and patches only those the
    referral walk resolved. Never writes null, never re-attributes a ballot's
    existing procedure — a `conflicts` count above 0 is a signal the operator
    reads, not something this run acts on.

    Cheaper than `--full` backfill on a populated period, and safe on prod:
    the alternative would run `load_votes` from scratch, which is the M2
    failure mode. Run this after ingest reports 0 declarations on a ballot
    that should have some — the missing link is almost always the reason.
    """
    settings = ctx.obj["settings"]
    dry_run = ctx.obj["dry_run"]
    try:
        if not dry_run:
            settings.require_convex_http_url()
            settings.require_pipeline_api_key()
        totals = pipeline.backfill_vote_vorgang(
            electoral_period, settings=settings, dry_run=dry_run
        )
    except ConfigError as error:
        raise click.ClickException(str(error)) from error
    click.echo(
        f"WP{electoral_period}: scanned {totals['sheets_scanned']} unresolved sheets, "
        f"sent {totals['patches_sent']} patches "
        f"({totals['patched']} patched, {totals['unchanged']} already correct, "
        f"{totals['conflicts']} conflicts, {totals['unknown']} unknown)."
    )
    if totals["conflicts"]:
        # A row that already carried a *different* Vorgang than the referral
        # walk now names is a real disagreement, and this route deliberately
        # does not silently rewrite it. Loud so an operator investigates.
        click.echo(
            f"⚠ {totals['conflicts']} ballot(s) already carry a different Vorgang. "
            "Investigate before rerunning; a re-attribution needs a deliberate migration.",
            err=True,
        )


@cli.command()
@click.option(
    "--wp",
    "electoral_period",
    type=int,
    default=CURRENT_ELECTORAL_PERIOD,
    show_default=True,
    metavar="N",
    help="Wahlperiode to rescore.",
)
@click.option(
    "--month",
    metavar="YYYY-MM",
    help="Also recompute this month. Omit to recompute period totals only.",
)
@click.option(
    "--all-months",
    is_flag=True,
    help="Recompute every month of the period. What a backfill needs.",
)
@click.pass_context
def scores(
    ctx: click.Context, electoral_period: int, month: str | None, all_months: bool
) -> None:
    """Recompute activity scores now, rather than at the nightly cron.

    The scoring runs in Convex over rows already stored, so this triggers and
    paginates it rather than computing anything here. Worth running after a
    backfill: the cron recomputes the current month plus the period total, so a
    backfill's older months would otherwise stay at zero.

    `--all-months` is the form a backfill wants. Every month of a historical
    period is one the nightly sweep will never revisit, and the profile trend
    graphs read those monthly rows — a period scored on its total alone renders
    as a flat "not computed" line for its whole span.
    """
    settings = ctx.obj["settings"]
    dry_run = ctx.obj["dry_run"]
    if month and all_months:
        raise click.UsageError("--month and --all-months are mutually exclusive.")
    try:
        if not dry_run:
            settings.require_convex_http_url()
            settings.require_pipeline_api_key()
        months = _period_months(electoral_period) if all_months else None
        if all_months and not months:
            # An open or unknown span. Refused rather than silently falling back
            # to the period total, which would look like it had done the work.
            raise click.ClickException(
                f"WP{electoral_period} has no closed date range in the Stammdaten dump, so "
                "its months cannot be enumerated. It is either the current period — whose "
                "months the nightly cron reaches anyway — or one the dump does not cover. "
                "Use --month to name one."
            )
        scored = pipeline.recompute_scores(
            electoral_period, month=month, months=months, settings=settings, dry_run=dry_run
        )
    except ConfigError as error:
        raise click.ClickException(str(error)) from error
    span = f" across {len(months)} months" if months else ""
    click.echo(f"Recomputed {scored} scores for WP{electoral_period}{span}.")


def _period_months(electoral_period: int) -> list[str]:
    """Every `YYYY-MM` a period spans, from the roster's own mandate dates.

    Costs one ~950 KB download of a dump the backfill just fetched anyway. The
    alternative — a hardcoded table of election dates — is a second source of
    truth for something this dump already states, and one that a period nobody
    has met yet would not be in.
    """
    client = StammdatenClient()
    try:
        dump = client.fetch()
    finally:
        client.close()
    return pipeline.months_in(*dump.wahlperiode_window(electoral_period))


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
    click.echo(f"  Convex HTTP:   {_convex_http_url(settings)}")
    click.echo(f"  DIP base URL:  {settings.bundestag_api_base_url}")
    click.echo(f"  DIP API key:   {'set' if settings.bundestag_api_key else '(unset)'}")
    click.echo(f"  Pipeline key:  {'set' if settings.pipeline_api_key else '(unset)'}")
    click.echo(f"  Electoral period: {CURRENT_ELECTORAL_PERIOD}")

    state = load_state(settings.state_path)
    click.echo(f"  State file:    {settings.state_path}")
    click.echo(f"    Last run:    {state.last_run or '(never)'}")
    # Per stream, because they diverge on purpose: a stage that failed keeps
    # its own window, and one mark lagging the others is exactly the thing an
    # operator needs to see rather than an average that hides it.
    marks = state.stream_watermarks(CURRENT_ELECTORAL_PERIOD)
    click.echo(f"    Watermarks:  {'(none)' if not marks else ''}")
    for stream, mark in marks.items():
        click.echo(f"      {stream}: {mark}")
    click.echo(f"    Stammdaten:  {state.stammdaten_version or '(unknown)'}")
    # §7.3's retry list. Surfaced here because it is the one number that says
    # whether the roster snapshot is keeping up with reality.
    click.echo(f"    Quarantine:  {len(state.quarantine)} unresolved names")


def _convex_http_url(settings: object) -> str:
    """The ingestion URL as `status` should show it — resolved, or why not."""
    try:
        return settings.require_convex_http_url()  # type: ignore[attr-defined]
    except ConfigError:
        return "(unset)"


def _run(
    ctx: click.Context,
    stage: str,
    *,
    electoral_period: int,
    run: object,
    since: str | None = None,
) -> None:
    """Shared body of the three data commands.

    They differ only in which records they ask for, so the config check, the
    reporting and the exit code live here once.
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
            # Both, before a fetch that costs hours: the ingestion API denies
            # on an unset key rather than allowing (webapp/convex/http.ts), so
            # the alternative is discovering it as a 401 at the first write.
            settings.require_convex_http_url()
            settings.require_pipeline_api_key()
    except ConfigError as error:
        raise click.ClickException(str(error)) from error

    report = run(settings=settings, dry_run=dry_run)  # type: ignore[operator]
    click.echo(report.summary())
    if not report.ok:
        # Non-zero even though the stages that succeeded committed their work.
        # A cron that sees success because most of it worked is how a broken
        # source stays broken.
        raise click.ClickException(
            "One or more stages failed — see the report above. Their records are "
            "re-fetched on the next run; every write is an upsert."
        )


def main() -> None:
    """Console-script entry point (`bundestrack`, `python -m bundestrack.cli`)."""
    cli(obj={})


if __name__ == "__main__":
    main()
