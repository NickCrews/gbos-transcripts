"""CLI for managing people and roles in the database.

Usage:
    uv run python -m gbos_pipeline.manage_people list
    uv run python -m gbos_pipeline.manage_people name 3 "Mike Edgington"
    uv run python -m gbos_pipeline.manage_people merge 3 7
    uv run python -m gbos_pipeline.manage_people role 3 gbos board_member --start 2023-01
    uv run python -m gbos_pipeline.manage_people show 3
"""

from __future__ import annotations

import argparse
import sys

from .config import DB_PATH
from .db import open_and_init, upsert_role
from .identify import merge_people


def cmd_list(conn, args) -> None:  # noqa: ARG001
    rows = conn.execute(
        """
        SELECT p.id, p.name, p.voice_sample_count,
               COUNT(DISTINCT s.meeting_id) AS meeting_count,
               COUNT(s.id) AS segment_count
        FROM people p
        LEFT JOIN segments s ON s.person_id = p.id
        GROUP BY p.id
        ORDER BY meeting_count DESC, p.id
        """
    ).fetchall()

    if not rows:
        print("No people in database.")
        return

    print(f"{'ID':>4}  {'Name':<30}  {'Samples':>7}  {'Meetings':>8}  {'Segments':>8}")
    print("-" * 65)
    for row in rows:
        print(
            f"{row['id']:>4}  {row['name']:<30}  {row['voice_sample_count']:>7}"
            f"  {row['meeting_count']:>8}  {row['segment_count']:>8}"
        )


def cmd_show(conn, args) -> None:
    person_id = args.person_id
    row = conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()
    if not row:
        print(f"Person {person_id} not found.")
        return

    print(f"ID:      {row['id']}")
    print(f"Name:    {row['name']}")
    print(f"Samples: {row['voice_sample_count']}")
    print(f"Created: {row['created_at']}")
    print(f"Updated: {row['updated_at']}")

    roles = conn.execute(
        """
        SELECT r.role, r.title, m.short_name, r.start_date, r.end_date
        FROM roles r JOIN municipalities m ON m.id = r.municipality_id
        WHERE r.person_id = ?
        ORDER BY r.start_date
        """,
        (person_id,),
    ).fetchall()

    if roles:
        print("\nRoles:")
        for r in roles:
            end = r["end_date"] or "present"
            print(f"  [{r['short_name']}] {r['role']} / {r['title'] or ''} ({r['start_date']} – {end})")

    segs = conn.execute(
        """
        SELECT COUNT(*) AS n, COUNT(DISTINCT meeting_id) AS m,
               SUM(duration_secs) AS total_secs
        FROM segments WHERE person_id = ?
        """,
        (person_id,),
    ).fetchone()
    print(f"\nSegments: {segs['n']}  Meetings: {segs['m']}  Total speech: {segs['total_secs'] or 0:.0f}s")


def cmd_name(conn, args) -> None:
    person_id = args.person_id
    new_name = args.name
    conn.execute(
        "UPDATE people SET name = ?, updated_at = datetime('now') WHERE id = ?",
        (new_name, person_id),
    )
    conn.commit()
    print(f"Person {person_id} renamed to '{new_name}'.")


def cmd_merge(conn, args) -> None:
    keep_id = args.keep_id
    merge_id = args.merge_id
    merge_people(conn, keep_id, merge_id)
    print(f"Merged person {merge_id} into {keep_id}.")


def cmd_role(conn, args) -> None:
    person_id = args.person_id
    short_name = args.municipality
    role = args.role
    start_date = args.start
    end_date = args.end

    muni = conn.execute(
        "SELECT id FROM municipalities WHERE short_name = ?", (short_name,)
    ).fetchone()
    if not muni:
        print(f"Municipality '{short_name}' not found. Run update first.")
        sys.exit(1)

    upsert_role(
        conn,
        person_id=person_id,
        municipality_id=muni["id"],
        role=role,
        start_date=start_date,
        end_date=end_date,
    )
    print(f"Added role '{role}' for person {person_id} in {short_name}.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage people and roles")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List all people")

    p_show = sub.add_parser("show", help="Show details for a person")
    p_show.add_argument("person_id", type=int)

    p_name = sub.add_parser("name", help="Set a person's name")
    p_name.add_argument("person_id", type=int)
    p_name.add_argument("name", type=str)

    p_merge = sub.add_parser("merge", help="Merge one person into another")
    p_merge.add_argument("keep_id", type=int, help="Person to keep")
    p_merge.add_argument("merge_id", type=int, help="Person to merge (will be deleted)")

    p_role = sub.add_parser("role", help="Add a role for a person")
    p_role.add_argument("person_id", type=int)
    p_role.add_argument("municipality", type=str)
    p_role.add_argument("role", type=str)
    p_role.add_argument("--start", default=None)
    p_role.add_argument("--end", default=None)

    args = parser.parse_args(argv)

    conn = open_and_init(DB_PATH)

    dispatch = {
        "list": cmd_list,
        "show": cmd_show,
        "name": cmd_name,
        "merge": cmd_merge,
        "role": cmd_role,
    }
    dispatch[args.command](conn, args)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
