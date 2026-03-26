"""Tests for ingest.py: pipeline orchestration, status transitions, idempotency."""

from __future__ import annotations

import pytest

from gbos_pipeline.db import (
    get_meeting_by_id,
    insert_meeting,
    insert_person,
    insert_segment,
    update_meeting_status,
    upsert_municipality,
)


class TestStatusTransitions:
    """Test that ingest_meeting updates statuses correctly via mocked stages."""

    def _make_meeting(self, conn, status: str) -> int:
        muni_id = upsert_municipality(conn, name="Test", short_name="test")
        mid = insert_meeting(
            conn,
            municipality_id=muni_id,
            youtube_id=f"vid_{status}",
            title=f"Test {status}",
            status=status,
            audio_path="data/audio/test.wav",
        )
        return mid

    def test_error_status_set_on_failure(self, tmp_db):
        """If a stage raises, status should be set to 'error'."""
        from gbos_pipeline.ingest import ingest_meeting

        mid = self._make_meeting(tmp_db, "downloaded")

        # ingest_meeting will fail because there's no real audio file
        with pytest.raises(Exception):
            ingest_meeting(tmp_db, mid)

        meeting = get_meeting_by_id(tmp_db, mid)
        assert meeting["status"] == "error"
        assert meeting["error_message"] is not None

    def test_missing_meeting_raises(self, tmp_db):
        from gbos_pipeline.ingest import ingest_meeting

        with pytest.raises(ValueError, match="not found"):
            ingest_meeting(tmp_db, 9999)


class TestIngestPending:
    def test_returns_empty_when_no_pending(self, tmp_db):
        from gbos_pipeline.ingest import ingest_pending

        result = ingest_pending(tmp_db)
        assert result == []

    def test_processes_correct_statuses(self, tmp_db):
        """Only meetings in specified statuses should be processed."""
        from gbos_pipeline.ingest import ingest_pending

        muni_id = upsert_municipality(tmp_db, name="Test", short_name="test")
        # 'embedded' meeting — should NOT be processed
        mid_done = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="done_vid",
            title="Done",
            status="embedded",
        )
        # 'downloaded' meeting — should be attempted
        mid_todo = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="todo_vid",
            title="Todo",
            status="downloaded",
            audio_path="data/audio/todo_vid.wav",
        )

        # The download will fail (no real file), but it should attempt the todo meeting
        ingest_pending(tmp_db)  # errors are caught internally

        # The done meeting should remain 'embedded'
        done = get_meeting_by_id(tmp_db, mid_done)
        assert done["status"] == "embedded"


class TestIdempotency:
    def test_no_duplicate_segments_on_retry(self, tmp_db):
        """Running ingest on an already-diarized meeting should not duplicate segments."""
        muni_id = upsert_municipality(tmp_db, name="Test", short_name="test")
        mid = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="idem_vid",
            title="Idempotency Test",
            status="diarized",
        )
        pid = insert_person(tmp_db, name="Speaker A", voice_embedding=[0.1] * 256)
        insert_segment(
            tmp_db,
            meeting_id=mid,
            text="The meeting is called to order.",
            start_time=0.0,
            end_time=3.0,
            person_id=pid,
        )

        seg_count_before = tmp_db.execute(
            "SELECT COUNT(*) FROM segments WHERE meeting_id = ?", (mid,)
        ).fetchone()[0]
        assert seg_count_before == 1

        # Attempting to ingest a 'diarized' meeting should only run the embed stage
        # (which won't duplicate segments)
        from gbos_pipeline.ingest import ingest_meeting

        with pytest.raises(Exception):
            # Will fail at embed (no real model), but shouldn't add segments
            ingest_meeting(tmp_db, mid)

        seg_count_after = tmp_db.execute(
            "SELECT COUNT(*) FROM segments WHERE meeting_id = ?", (mid,)
        ).fetchone()[0]
        assert seg_count_after == seg_count_before
