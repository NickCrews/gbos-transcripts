"""
Shared test fixtures for the GBOS pipeline test suite.

Key fixtures
------------
fresh_db        — Creates a temporary Postgres database, applies all Drizzle
                  migrations, yields the connection URL, then drops the DB on
                  teardown.  Each test gets a fully isolated database.

db_snapshot     — Asserts that a DB URL's current state matches a committed
                  snapshot directory.  Works like syrupy: run with
                  ``pytest --snapshot-update`` to (re)generate snapshots.
"""
from __future__ import annotations

import uuid
from pathlib import Path

import psycopg
import pytest

_ADMIN_URL = "postgres://postgres:postgres@localhost:5432/postgres"
_MIGRATION = (
    Path(__file__).parent.parent.parent
    / "web/src/db/migrations/20260415183009_init/migration.sql"
)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--snapshot-update",
        action="store_true",
        default=False,
        help="Overwrite snapshot files with the current DB state.",
    )


@pytest.fixture
def fresh_db() -> str:  # yields a connection URL
    """
    Fresh, fully-migrated Postgres database per test.

    The database is created before the test and dropped unconditionally
    on teardown, regardless of test outcome.
    """
    name = f"gbos_test_{uuid.uuid4().hex[:8]}"

    with psycopg.connect(_ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')

    db_url = f"postgres://postgres:postgres@localhost:5432/{name}"

    # Apply Drizzle migrations.  The SQL file contains Drizzle-specific
    # "-->statement-breakpoint" markers that must be stripped before execution.
    migration_sql = _MIGRATION.read_text()
    with psycopg.connect(db_url) as conn:
        for stmt in migration_sql.split("--> statement-breakpoint"):
            stmt = stmt.strip()
            if stmt:
                conn.execute(stmt)
        conn.commit()

    yield db_url

    with psycopg.connect(_ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}"')


@pytest.fixture
def db_snapshot(request: pytest.FixtureRequest, pytestconfig: pytest.Config):
    """
    Snapshot assertion fixture for DB state.

    Usage::

        assert fresh_db == db_snapshot   # compare against committed snapshot

    Snapshots are stored under ``tests/snapshots/<module>/<test_name>/``.

    Pass ``--snapshot-update`` to (re)generate snapshot files.
    """
    update = pytestconfig.getoption("--snapshot-update")
    snapshot_dir = (
        Path(request.fspath).parent
        / "snapshots"
        / Path(request.fspath).stem
        / request.node.name
    )

    class _Snapshot:
        def __eq__(self, db_url: str) -> bool:  # noqa: ANN001
            from gbos_pipeline.db.snapshot import capture, diff as snap_diff, read, write

            with psycopg.connect(db_url) as conn:
                if update:
                    write(snapshot_dir, conn)
                    print(f"\n  [snapshot] updated → {snapshot_dir}")
                    return True
                actual = capture(conn)

            if not snapshot_dir.exists():
                raise AssertionError(
                    f"No snapshot found at {snapshot_dir!r}.\n"
                    "Run:  pytest --snapshot-update"
                )

            expected = read(snapshot_dir)
            delta = snap_diff(actual, expected)
            if delta:
                raise AssertionError(
                    f"DB state differs from snapshot at {snapshot_dir!r}:\n\n{delta}"
                )
            return True

        def __repr__(self) -> str:
            return f"<DBSnapshot {snapshot_dir}>"

    return _Snapshot()
