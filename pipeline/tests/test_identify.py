"""Tests for identify.py: voice embedding matching logic."""

from __future__ import annotations

import pytest

from gbos_pipeline.db import (
    decode_embedding,
    encode_embedding,
    find_matching_person,
    insert_person,
    update_person_embedding,
)
from gbos_pipeline.identify import identify_speakers, merge_people


def make_embedding(value: float, dim: int = 256) -> list[float]:
    """Create an embedding with alternating signs based on value.

    value=0.0 → [+1, -1, +1, -1, ...] (0-degree direction)
    value=1.0 → [+1, +1, +1, +1, ...] (orthogonal)
    This ensures different values produce very different cosine distances.
    """
    if value < 0.5:
        # Alternating: very different from a uniform vector
        return [1.0 if i % 2 == 0 else -1.0 for i in range(dim)]
    else:
        # All positive: cosine distance ~= sqrt(2)/2 ≈ 0.7 from alternating
        return [1.0] * dim


class TestFindMatchingPerson:
    def test_no_people_returns_none(self, tmp_db):
        emb = make_embedding(0.5)
        assert find_matching_person(tmp_db, emb) is None

    def test_exact_match_found(self, tmp_db):
        emb = make_embedding(0.5)
        pid = insert_person(tmp_db, name="Alice", voice_embedding=emb)
        # Same embedding should match
        result = find_matching_person(tmp_db, emb, threshold=0.4)
        assert result == pid

    def test_distant_embedding_no_match(self, tmp_db):
        # Insert a person with all-0.1 embedding
        emb_alice = make_embedding(0.1)
        insert_person(tmp_db, name="Alice", voice_embedding=emb_alice)
        # Query with very different embedding (all-0.9)
        emb_other = make_embedding(0.9)
        result = find_matching_person(tmp_db, emb_other, threshold=0.4)
        assert result is None


class TestIdentifySpeakers:
    def test_new_speakers_create_people(self, tmp_db):
        embeddings = {
            "SPEAKER_00": make_embedding(0.1),
            "SPEAKER_01": make_embedding(0.9),
        }
        mapping = identify_speakers(tmp_db, embeddings)
        assert len(mapping) == 2
        assert "SPEAKER_00" in mapping
        assert "SPEAKER_01" in mapping
        # Both should have been created
        count = tmp_db.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        assert count == 2

    def test_known_speaker_reuses_person_id(self, tmp_db):
        emb = make_embedding(0.5)
        pid = insert_person(tmp_db, name="Bob", voice_embedding=emb)

        # A very similar embedding should match
        similar_emb = make_embedding(0.5)  # identical
        mapping = identify_speakers(tmp_db, {"SPEAKER_00": similar_emb}, threshold=0.4)
        assert mapping["SPEAKER_00"] == pid

        # No new person should have been created
        count = tmp_db.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        assert count == 1

    def test_unknown_speakers_named_sequentially(self, tmp_db):
        embeddings = {
            "SPEAKER_00": make_embedding(0.1),
            "SPEAKER_01": make_embedding(0.9),
        }
        identify_speakers(tmp_db, embeddings)
        names = {
            row[0]
            for row in tmp_db.execute("SELECT name FROM people").fetchall()
        }
        assert "Unknown Speaker 1" in names
        assert "Unknown Speaker 2" in names

    def test_embedding_updated_after_match(self, tmp_db):
        emb = [1.0] * 256
        pid = insert_person(tmp_db, name="Carol", voice_embedding=emb)

        # Second meeting: slightly different embedding
        emb2 = [0.9] * 256
        identify_speakers(tmp_db, {"SPEAKER_00": emb2}, threshold=0.4)

        row = tmp_db.execute(
            "SELECT voice_embedding, voice_sample_count FROM people WHERE id = ?", (pid,)
        ).fetchone()
        assert row["voice_sample_count"] == 2
        # Embedding should now be average of emb and emb2
        decoded = decode_embedding(row["voice_embedding"])
        assert abs(decoded[0] - 0.95) < 1e-5


class TestUpdatePersonEmbedding:
    def test_running_average(self, tmp_db):
        emb1 = [1.0] * 256
        pid = insert_person(tmp_db, name="Dave", voice_embedding=emb1)

        emb2 = [0.0] * 256
        update_person_embedding(tmp_db, pid, emb2)

        row = tmp_db.execute(
            "SELECT voice_embedding, voice_sample_count FROM people WHERE id = ?", (pid,)
        ).fetchone()
        assert row["voice_sample_count"] == 2
        decoded = decode_embedding(row["voice_embedding"])
        assert abs(decoded[0] - 0.5) < 1e-5


class TestMergePeople:
    def test_merge_reassigns_segments(self, tmp_db, seed_meeting):
        from gbos_pipeline.db import insert_segment

        pid1 = insert_person(tmp_db, name="Eve", voice_embedding=make_embedding(0.1))
        pid2 = insert_person(tmp_db, name="Eve Duplicate", voice_embedding=make_embedding(0.11))

        insert_segment(
            tmp_db,
            meeting_id=seed_meeting,
            text="Hello from Eve",
            start_time=0.0,
            end_time=2.0,
            person_id=pid2,
        )

        merge_people(tmp_db, pid1, pid2)

        # pid2 should be deleted
        row = tmp_db.execute("SELECT id FROM people WHERE id = ?", (pid2,)).fetchone()
        assert row is None

        # Segment should now belong to pid1
        seg = tmp_db.execute(
            "SELECT person_id FROM segments WHERE person_id = ?", (pid1,)
        ).fetchone()
        assert seg is not None

    def test_merge_updates_embedding(self, tmp_db):
        emb1 = [1.0] * 256
        emb2 = [0.0] * 256
        pid1 = insert_person(tmp_db, name="Frank", voice_embedding=emb1)
        pid2 = insert_person(tmp_db, name="Frank Dup", voice_embedding=emb2)

        merge_people(tmp_db, pid1, pid2)

        row = tmp_db.execute(
            "SELECT voice_embedding, voice_sample_count FROM people WHERE id = ?", (pid1,)
        ).fetchone()
        decoded = decode_embedding(row["voice_embedding"])
        # Should be average of [1.0]*256 and [0.0]*256 = [0.5]*256
        assert abs(decoded[0] - 0.5) < 1e-5
