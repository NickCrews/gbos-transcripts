"""Shared pytest fixtures for the GBOS pipeline test suite."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from gbos_pipeline.db import create_schema, open_db
from gbos_pipeline.diarize_audio import DiarizationResult, diarization_from_dict
from gbos_pipeline.transcribe import TranscriptResult, transcript_from_dict

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_db(tmp_path) -> sqlite3.Connection:
    """In-memory SQLite database with the full schema."""
    conn = open_db(":memory:")
    create_schema(conn)
    return conn


@pytest.fixture
def tmp_db_file(tmp_path) -> sqlite3.Connection:
    """On-disk SQLite database with the full schema (for tests that need a file path)."""
    db_path = tmp_path / "test.db"
    conn = open_db(db_path)
    create_schema(conn)
    return conn


@pytest.fixture
def sample_transcript() -> TranscriptResult:
    """Pre-recorded Parakeet transcript fixture."""
    with open(FIXTURES_DIR / "sample_transcript.json") as f:
        data = json.load(f)
    return transcript_from_dict(data)


@pytest.fixture
def sample_diarization() -> DiarizationResult:
    """Pre-recorded diarization fixture."""
    with open(FIXTURES_DIR / "sample_diarization.json") as f:
        data = json.load(f)
    return diarization_from_dict(data)


@pytest.fixture
def seed_municipality(tmp_db) -> int:
    """Insert GBOS municipality, return id."""
    from gbos_pipeline.db import upsert_municipality

    return upsert_municipality(
        tmp_db,
        name="Girdwood Board of Supervisors",
        short_name="gbos",
        state="AK",
        youtube_channel_url="https://www.youtube.com/@GirdwoodBOS/videos",
    )


@pytest.fixture
def seed_meeting(tmp_db, seed_municipality) -> int:
    """Insert a sample meeting row, return id."""
    from gbos_pipeline.db import insert_meeting

    mid = insert_meeting(
        tmp_db,
        municipality_id=seed_municipality,
        youtube_id="test_vid_001",
        title="GBOS Regular Meeting January 21, 2025",
        meeting_date="2025-01-21",
        meeting_type="regular",
        duration_secs=900.0,
        audio_path="data/audio/test_vid_001.wav",
        status="downloaded",
    )
    assert mid is not None
    return mid
