"""
DB snapshot utilities — DuckDB EXPORT-compatible format.

Each snapshot/fixture is a directory containing one CSV per table
({table}.csv), with a header row.

Generated columns (GENERATED ALWAYS) and `created_at` are excluded from
captures and comparisons, making snapshots deterministic across test runs.

Typical use in tests:

    from gbos_pipeline.db.snapshot import seed, capture, read, diff

    seed(conn, Path("tests/fixtures/one_municipality"))
    actual = capture(conn)
    assert not diff(actual, read(snapshot_dir))
"""

from __future__ import annotations

import csv
import difflib
import io
from pathlib import Path
from typing import TYPE_CHECKING

from psycopg import sql

if TYPE_CHECKING:
    import psycopg

# Insertion / capture order respects FK dependencies (parents before children).
TABLES = ["municipalities", "people", "meetings", "segments"]


def _capture_columns(conn: psycopg.Connection, table: str) -> list[str]:
    """Return columns to include in snapshots: non-generated, non-created_at."""
    rows = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = %s
          AND is_generated = 'NEVER'
          AND column_name != 'created_at'
        ORDER BY ordinal_position
        """,
        [table],
    ).fetchall()
    return [r[0] for r in rows]


def capture(conn: psycopg.Connection) -> dict[str, str]:
    """Return {table: csv_text} for every table, rows sorted by id."""
    result: dict[str, str] = {}
    for table in TABLES:
        cols = _capture_columns(conn, table)
        col_list = sql.SQL(", ").join(sql.Identifier(c) for c in cols)
        buf = io.StringIO()
        with conn.cursor() as cur:
            with cur.copy(
                t"COPY (SELECT {col_list:q} FROM {table:i} ORDER BY id) TO STDOUT CSV HEADER"
            ) as copy:
                for chunk in copy:
                    buf.write(bytes(chunk).decode())
        result[table] = buf.getvalue()
    return result


def write(directory: Path, conn: psycopg.Connection) -> None:
    """Capture DB state and write it to *directory* as CSVs."""
    directory.mkdir(parents=True, exist_ok=True)
    csv_data = capture(conn)

    for table, csv_text in csv_data.items():
        (directory / f"{table}.csv").write_text(csv_text)


def read(directory: Path) -> dict[str, str]:
    """Read snapshot/fixture from *directory*, returning {table: csv_text}."""
    result: dict[str, str] = {}
    for table in TABLES:
        path = directory / f"{table}.csv"
        result[table] = path.read_text() if path.exists() else ""
    return result


def seed(conn: psycopg.Connection, directory: Path) -> None:
    """
    Truncate all tables and reload from CSVs in *directory*.

    Sequences are reset after loading so that subsequent auto-assigned IDs
    don't collide with the explicit IDs present in the fixture CSVs.
    """
    conn.execute(
        "TRUNCATE municipalities, people, meetings, segments RESTART IDENTITY CASCADE"
    )

    for table in TABLES:
        path = directory / f"{table}.csv"
        if not path.exists():
            continue
        csv_text = path.read_text()
        if not csv_text.strip():
            continue

        # Parse column names from the CSV header.
        header_line = csv_text.split("\n")[0]
        cols = next(csv.reader([header_line]))
        if not cols:
            continue
        col_list = sql.SQL(", ").join(sql.Identifier(c) for c in cols)

        with conn.cursor() as cur:
            with cur.copy(
                t"COPY {table:i} ({col_list:q}) FROM STDIN CSV HEADER"
            ) as copy:
                copy.write(csv_text.encode())

        # Advance the sequence past the highest inserted ID so future
        # auto-assigned inserts don't collide.
        conn.execute(
            t"""
            SELECT setval(
                pg_get_serial_sequence({table:l}, 'id'),
                COALESCE((SELECT MAX(id) FROM {table:i}), 0) + 1,
                false
            )
            """
        )

    conn.commit()


def diff(actual: dict[str, str], expected: dict[str, str]) -> str:
    """
    Return a unified diff between *expected* and *actual* CSV data.
    Returns an empty string when the two states are identical.
    """
    parts: list[str] = []
    for table in TABLES:
        a = actual.get(table, "")
        e = expected.get(table, "")
        if a != e:
            parts.extend(
                difflib.unified_diff(
                    e.splitlines(keepends=True),
                    a.splitlines(keepends=True),
                    fromfile=f"expected/{table}.csv",
                    tofile=f"actual/{table}.csv",
                )
            )
    return "".join(parts)
