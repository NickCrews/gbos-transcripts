"""Tests for embed.py: text embedding insertion and vec_segments sync."""

from __future__ import annotations

import pytest

from gbos_pipeline.db import (
    get_segments_missing_embeddings,
    insert_segment,
    insert_segment_embedding,
)
from gbos_pipeline.embed import embed_texts


class TestInsertSegmentEmbedding:
    def test_insert_and_retrieve(self, tmp_db, seed_meeting):
        sid = insert_segment(
            tmp_db,
            meeting_id=seed_meeting,
            text="Hello board.",
            start_time=0.0,
            end_time=1.5,
        )
        emb = [0.1] * 384
        insert_segment_embedding(tmp_db, sid, emb)

        row = tmp_db.execute(
            "SELECT segment_id FROM vec_segments WHERE segment_id = ?", (sid,)
        ).fetchone()
        assert row is not None

    def test_idempotent_upsert(self, tmp_db, seed_meeting):
        sid = insert_segment(
            tmp_db,
            meeting_id=seed_meeting,
            text="Hello again.",
            start_time=1.5,
            end_time=3.0,
        )
        emb1 = [0.1] * 384
        emb2 = [0.5] * 384
        insert_segment_embedding(tmp_db, sid, emb1)
        insert_segment_embedding(tmp_db, sid, emb2)

        count = tmp_db.execute(
            "SELECT COUNT(*) FROM vec_segments WHERE segment_id = ?", (sid,)
        ).fetchone()[0]
        assert count == 1


class TestGetSegmentsMissingEmbeddings:
    def test_segments_without_embeddings_returned(self, tmp_db, seed_meeting):
        sid1 = insert_segment(
            tmp_db, meeting_id=seed_meeting, text="Seg A", start_time=0.0, end_time=1.0
        )
        sid2 = insert_segment(
            tmp_db, meeting_id=seed_meeting, text="Seg B", start_time=1.0, end_time=2.0
        )
        # Embed only sid1
        insert_segment_embedding(tmp_db, sid1, [0.1] * 384)

        missing = get_segments_missing_embeddings(tmp_db, seed_meeting)
        assert len(missing) == 1
        assert missing[0]["id"] == sid2

    def test_all_embedded_returns_empty(self, tmp_db, seed_meeting):
        sid = insert_segment(
            tmp_db, meeting_id=seed_meeting, text="Seg", start_time=0.0, end_time=1.0
        )
        insert_segment_embedding(tmp_db, sid, [0.1] * 384)
        missing = get_segments_missing_embeddings(tmp_db, seed_meeting)
        assert len(missing) == 0


class TestEmbedTexts:
    """Smoke test for embed_texts (requires sentence-transformers installed)."""

    @pytest.mark.integration
    def test_embed_returns_correct_dim(self):
        texts = ["Hello world", "This is a test sentence."]
        embeddings = embed_texts(texts)
        assert len(embeddings) == 2
        assert len(embeddings[0]) == 384
        assert len(embeddings[1]) == 384
