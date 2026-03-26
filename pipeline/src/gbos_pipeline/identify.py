"""Cross-meeting speaker identification via voice embeddings.

Pipeline stage 3b: Match per-meeting speaker embeddings against the `people` table.
Creates new people rows for unrecognized voices; updates aggregate embeddings for matches.
"""

from __future__ import annotations

import sqlite3

from .config import VOICE_MATCH_DISTANCE_THRESHOLD
from .db import (
    find_matching_person,
    insert_person,
    update_person_embedding,
)


def identify_speakers(
    conn: sqlite3.Connection,
    speaker_embeddings: dict[str, list[float]],
    threshold: float = VOICE_MATCH_DISTANCE_THRESHOLD,
) -> dict[str, int]:
    """Match a dict of {speaker_label: embedding} to people in the database.

    For each speaker:
    - If voice matches an existing person (cosine distance < threshold): link and
      update their aggregate embedding.
    - Otherwise: create a new person row ("Unknown Speaker N").

    Returns {speaker_label: person_id}.
    """
    mapping: dict[str, int] = {}

    # Count existing unknown speakers for naming new ones
    unknown_count: int = conn.execute(
        "SELECT COUNT(*) FROM people WHERE name LIKE 'Unknown Speaker%'"
    ).fetchone()[0]

    for speaker_label, embedding in speaker_embeddings.items():
        person_id = find_matching_person(conn, embedding, threshold)

        if person_id is not None:
            # Known person — update their aggregate embedding
            update_person_embedding(conn, person_id, embedding)
        else:
            # New person — create with a placeholder name
            unknown_count += 1
            name = f"Unknown Speaker {unknown_count}"
            person_id = insert_person(conn, name=name, voice_embedding=embedding)

        mapping[speaker_label] = person_id

    return mapping


def merge_people(
    conn: sqlite3.Connection,
    keep_id: int,
    merge_id: int,
) -> None:
    """Merge person `merge_id` into `keep_id`.

    Re-assigns all segments and roles from merge_id to keep_id,
    updates the aggregate voice embedding, then deletes merge_id.
    """
    # Re-assign segments
    conn.execute(
        "UPDATE segments SET person_id = ? WHERE person_id = ?",
        (keep_id, merge_id),
    )
    # Re-assign roles
    conn.execute(
        "UPDATE roles SET person_id = ? WHERE person_id = ?",
        (keep_id, merge_id),
    )

    # Recompute aggregate embedding from all segments... but we only store one
    # embedding per person. Use a weighted average of both existing embeddings.
    from .db import decode_embedding, encode_embedding

    keep_row = conn.execute(
        "SELECT voice_embedding, voice_sample_count FROM people WHERE id = ?",
        (keep_id,),
    ).fetchone()
    merge_row = conn.execute(
        "SELECT voice_embedding, voice_sample_count FROM people WHERE id = ?",
        (merge_id,),
    ).fetchone()

    if keep_row["voice_embedding"] and merge_row["voice_embedding"]:
        keep_emb = decode_embedding(keep_row["voice_embedding"])
        keep_n = keep_row["voice_sample_count"] or 1
        merge_emb = decode_embedding(merge_row["voice_embedding"])
        merge_n = merge_row["voice_sample_count"] or 1
        total = keep_n + merge_n
        merged_emb = [
            (k * keep_n + m * merge_n) / total
            for k, m in zip(keep_emb, merge_emb)
        ]
        blob = encode_embedding(merged_emb)
        conn.execute(
            "UPDATE people SET voice_embedding = ?, voice_sample_count = ?, updated_at = datetime('now') WHERE id = ?",
            (blob, total, keep_id),
        )
        # Upsert vec_people
        conn.execute("DELETE FROM vec_people WHERE person_id = ?", (keep_id,))
        conn.execute(
            "INSERT INTO vec_people (person_id, voice_embedding) VALUES (?, ?)",
            (keep_id, encode_embedding(merged_emb)),
        )

    # Remove merged person
    conn.execute("DELETE FROM vec_people WHERE person_id = ?", (merge_id,))
    conn.execute("DELETE FROM people WHERE id = ?", (merge_id,))
    conn.commit()
