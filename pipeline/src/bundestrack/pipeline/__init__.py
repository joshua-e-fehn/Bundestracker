"""Orchestration: fetch → transform → load.

The stages the CLI commands call. Each stage is resumable and idempotent —
a sync that dies halfway can be re-run without duplicating records, because
ingestion upserts on the DIP record id.
"""
