"""
Snapshot framework verification tests.

These tests confirm that the db_snapshot fixture / seed / capture / diff
utilities work correctly end-to-end.  They do NOT test any pipeline logic.

Workflow
--------
First run (no snapshots yet):
    pytest --snapshot-update        # creates snapshots/test_snapshot/<test>/
    pytest                          # all tests pass

Any time the schema or fixture data changes, re-run with --snapshot-update,
review the diff in git, and commit the updated snapshots.
"""
from __future__ import annotations

from pathlib import Path

import psycopg

FIXTURES = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Snapshot-based tests (require --snapshot-update on first run)
# ---------------------------------------------------------------------------


def test_empty_db(fresh_db, db_snapshot):
    """A freshly migrated, empty database matches the snapshot."""
    assert fresh_db == db_snapshot


def test_seeded_municipality(fresh_db, db_snapshot):
    """After seeding the one_municipality fixture the DB matches the snapshot."""
    from gbos_pipeline.db.snapshot import seed

    with psycopg.connect(fresh_db) as conn:
        seed(conn, FIXTURES / "one_municipality")

    assert fresh_db == db_snapshot


def test_insert_meeting(fresh_db, db_snapshot):
    """Inserting a meeting row is captured in the snapshot."""
    from gbos_pipeline.db.snapshot import seed

    with psycopg.connect(fresh_db) as conn:
        seed(conn, FIXTURES / "one_municipality")
        conn.execute(
            """
            INSERT INTO meetings
                (municipality_id, youtube_id, title, description, start_time)
            VALUES
                (1, 'dQw4w9WgXcQ', 'Regular Meeting Jan 2024',
                 'Monthly board meeting', '2024-01-15 18:00:00')
            """
        )
        conn.commit()

    assert fresh_db == db_snapshot


# ---------------------------------------------------------------------------
# Roundtrip tests — no snapshot files needed, assertions are self-contained
# ---------------------------------------------------------------------------


def test_empty_seed_roundtrip(fresh_db):
    """
    Seeding from the empty fixture then capturing should reproduce the
    fixture CSVs exactly (header-only files, no data rows).
    """
    from gbos_pipeline.db.snapshot import capture, diff, read, seed

    with psycopg.connect(fresh_db) as conn:
        seed(conn, FIXTURES / "empty")
        actual = capture(conn)

    expected = read(FIXTURES / "empty")
    delta = diff(actual, expected)
    assert not delta, f"Seed/capture roundtrip failed:\n{delta}"


def test_municipality_seed_roundtrip(fresh_db):
    """
    Seeding from the one_municipality fixture then capturing should
    reproduce the fixture CSVs exactly (one municipality row, rest empty).
    """
    from gbos_pipeline.db.snapshot import capture, diff, read, seed

    with psycopg.connect(fresh_db) as conn:
        seed(conn, FIXTURES / "one_municipality")
        actual = capture(conn)

    expected = read(FIXTURES / "one_municipality")
    delta = diff(actual, expected)
    assert not delta, f"Seed/capture roundtrip failed:\n{delta}"
