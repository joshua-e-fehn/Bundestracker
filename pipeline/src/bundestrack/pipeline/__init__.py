"""Orchestration: fetch → transform → load.

The stages the CLI commands call. Each stage is resumable and idempotent —
a sync that dies halfway can be re-run without duplicating records, because
ingestion upserts on the DIP record id.

Four modules, split by what goes wrong in each:

- `join` — the identity layer. Three incompatible MP id spaces and two sources
  with no id at all (docs/api-research.md §7), reconciled onto one internal
  Bundestrack id. Unresolved names are quarantined and retried, never dropped.
- `transform` — pure model → payload functions. No network and no clock, so
  the findings they encode are testable against recorded fixtures.
- `load` — the Convex HTTP ingestion client: batching, retries, dry runs.
- `sync` — the order the joins allow, and what to do when one stage fails.

`state` is what one run tells the next: the `aktualisiert` watermark (§11.2),
the quarantine (§7.3), and the hashes that let an unchanged protocol be
skipped (§5.1).

The four entry points are reached through the module — `sync.init(21)`,
`sync.sync(21)`, `sync.backfill(20)`, `sync.recompute_scores(21)` — and are
deliberately *not* lifted into this namespace. `sync` the function would
shadow `sync` the module, so `bundestrack.pipeline.sync` would mean one thing
or the other depending on import order, and the loser would fail with an
`AttributeError` far from the cause.
"""

from bundestrack.pipeline import join, load, state, sync, transform
from bundestrack.pipeline.join import (
    DIPLinkReport,
    MPResolver,
    Quarantine,
    QuarantinedName,
    internal_id,
    stammdaten_id_of,
)
from bundestrack.pipeline.load import (
    BatchResult,
    ConvexAuthError,
    ConvexError,
    ConvexLoader,
    chunked,
)
from bundestrack.pipeline.state import SyncState, load_state, save_state
from bundestrack.pipeline.sync import (
    CURRENT_WAHLPERIODE,
    Pipeline,
    RunReport,
    StageReport,
)

__all__ = [
    "CURRENT_WAHLPERIODE",
    "BatchResult",
    "ConvexAuthError",
    "ConvexError",
    "ConvexLoader",
    "DIPLinkReport",
    "MPResolver",
    "Pipeline",
    "Quarantine",
    "QuarantinedName",
    "RunReport",
    "StageReport",
    "SyncState",
    "chunked",
    "internal_id",
    "join",
    "load",
    "load_state",
    "save_state",
    "stammdaten_id_of",
    "state",
    "sync",
    "transform",
]
