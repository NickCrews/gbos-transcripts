"""Pipeline orchestrator: runs all stages for a single meeting.

Stages (each idempotent):
1. download   → status: downloaded
2. transcribe → status: transcribed
3. diarize    → (internal, no status change yet)
4. identify   → (internal)
5. align      → status: diarized
6. embed      → status: embedded
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def ingest_meeting(conn: sqlite3.Connection, meeting_id: int) -> None:
    """Run all pipeline stages for a meeting, skipping already-completed stages."""
    from .db import get_meeting_by_id, update_meeting_status
    from .transcribe import run_transcribe
    from .diarize_audio import run_diarize
    from .identify import identify_speakers
    from .align import run_align
    from .embed import run_embed

    meeting = get_meeting_by_id(conn, meeting_id)
    if meeting is None:
        raise ValueError(f"Meeting {meeting_id} not found")

    status = meeting["status"]

    try:
        # Stage 2: Transcribe
        if status in ("downloaded",):
            print(f"  [transcribe] meeting {meeting_id}")
            transcript = run_transcribe(conn, meeting_id)
            status = "transcribed"
        elif status in ("transcribed", "diarized", "embedded"):
            # Load existing transcript for later stages if needed
            from .transcribe import load_transcript
            from .config import TRANSCRIPTS_DIR
            transcript_path = TRANSCRIPTS_DIR / f"{meeting['youtube_id']}.json"
            if transcript_path.exists():
                transcript = load_transcript(transcript_path)
            else:
                transcript = run_transcribe(conn, meeting_id)
                status = "transcribed"

        # Stage 3+4+5: Diarize → Identify → Align
        if status == "transcribed":
            print(f"  [diarize]    meeting {meeting_id}")
            diarization = run_diarize(conn, meeting_id)

            print(f"  [identify]   meeting {meeting_id}")
            speaker_to_person = identify_speakers(conn, diarization.embeddings)

            print(f"  [align]      meeting {meeting_id}")
            run_align(conn, meeting_id, transcript, diarization, speaker_to_person)
            status = "diarized"

        # Stage 6: Embed
        if status == "diarized":
            print(f"  [embed]      meeting {meeting_id}")
            n = run_embed(conn, meeting_id)
            print(f"  [embed]      {n} segments embedded")
            status = "embedded"

    except Exception as exc:
        update_meeting_status(
            conn, meeting_id, "error", error_message=str(exc)
        )
        raise


def ingest_pending(
    conn: sqlite3.Connection,
    *,
    statuses: list[str] | None = None,
    limit: int | None = None,
) -> list[int]:
    """Process all meetings in a given set of statuses.

    Default statuses: downloaded, transcribed, diarized (i.e. not yet embedded).
    Returns list of processed meeting IDs.
    """
    if statuses is None:
        statuses = ["downloaded", "transcribed", "diarized"]

    placeholders = ",".join("?" * len(statuses))
    rows = conn.execute(
        f"SELECT id FROM meetings WHERE status IN ({placeholders}) ORDER BY meeting_date",
        statuses,
    ).fetchall()

    processed: list[int] = []
    for i, row in enumerate(rows):
        if limit is not None and i >= limit:
            break
        meeting_id = row["id"]
        print(f"Processing meeting {meeting_id}...")
        try:
            ingest_meeting(conn, meeting_id)
            processed.append(meeting_id)
        except Exception as exc:
            print(f"  ERROR: {exc}")

    return processed
