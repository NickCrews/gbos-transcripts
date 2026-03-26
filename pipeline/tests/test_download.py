"""Tests for download.py: title parsing and DB deduplication logic."""

from __future__ import annotations

import pytest

from gbos_pipeline.download import parse_meeting_date, parse_meeting_type
from gbos_pipeline.db import insert_meeting, upsert_municipality


class TestParseMeetingDate:
    def test_long_month_name(self):
        assert parse_meeting_date("GBOS Regular Meeting January 21, 2025") == "2025-01-21"

    def test_short_month_name(self):
        assert parse_meeting_date("GBOS Meeting Jan 5, 2024") == "2024-01-05"

    def test_iso_format(self):
        assert parse_meeting_date("Meeting 2023-03-15 regular") == "2023-03-15"

    def test_slash_format(self):
        assert parse_meeting_date("GBOS 03/15/2023") == "2023-03-15"

    def test_no_date(self):
        assert parse_meeting_date("No date here at all") is None

    def test_december(self):
        assert parse_meeting_date("December 10, 2022 Work Session") == "2022-12-10"

    def test_single_digit_day(self):
        assert parse_meeting_date("February 5, 2025") == "2025-02-05"


class TestParseMeetingType:
    def test_regular(self):
        assert parse_meeting_type("GBOS Regular Meeting January 21, 2025") == "regular"

    def test_work_session(self):
        assert parse_meeting_type("Work Session March 2024") == "work_session"

    def test_special(self):
        assert parse_meeting_type("Special Meeting July 4, 2023") == "special"

    def test_special_session(self):
        assert parse_meeting_type("GBOS Special Session") == "special"

    def test_quarterly(self):
        assert parse_meeting_type("Quarterly Review Q1 2024") == "quarterly"

    def test_joint(self):
        assert parse_meeting_type("Joint Meeting with Planning Commission") == "joint"

    def test_unknown(self):
        assert parse_meeting_type("GBOS Board Videos") is None

    def test_case_insensitive(self):
        assert parse_meeting_type("WORK SESSION") == "work_session"


class TestDeduplication:
    def test_duplicate_youtube_id_skipped(self, tmp_db):
        """Inserting the same youtube_id twice should not create a duplicate row."""
        muni_id = upsert_municipality(tmp_db, name="Test", short_name="test")
        id1 = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="abc123",
            title="Meeting 1",
        )
        id2 = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="abc123",
            title="Meeting 1 duplicate",
        )
        # Both calls return the same id
        assert id1 == id2
        count = tmp_db.execute(
            "SELECT COUNT(*) FROM meetings WHERE youtube_id = 'abc123'"
        ).fetchone()[0]
        assert count == 1

    def test_different_youtube_id_inserted(self, tmp_db):
        muni_id = upsert_municipality(tmp_db, name="Test", short_name="test")
        id1 = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="vid001",
            title="Meeting A",
        )
        id2 = insert_meeting(
            tmp_db,
            municipality_id=muni_id,
            youtube_id="vid002",
            title="Meeting B",
        )
        assert id1 != id2
