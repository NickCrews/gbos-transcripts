"""Merge Parakeet transcript segments with diarization speaker turns.

Pipeline stage 4: Assign each transcript sentence to the speaker who talked
the most during that time window (majority-overlap rule).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from .diarize_audio import DiarizationResult, SpeakerTurn
from .transcribe import TranscriptResult, TranscriptSentence


@dataclass
class AlignedSegment:
    text: str
    start_time: float
    end_time: float
    speaker_label: str | None
    person_id: int | None
    confidence: float | None


# ---------------------------------------------------------------------------
# Core alignment logic
# ---------------------------------------------------------------------------

def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    """Return the duration of overlap between two intervals."""
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def assign_speaker(
    sentence: TranscriptSentence,
    turns: list[SpeakerTurn],
) -> str | None:
    """Return the speaker label with the most overlap with this sentence."""
    best_speaker: str | None = None
    best_overlap = 0.0

    for turn in turns:
        ov = _overlap(sentence.start, sentence.end, turn.start, turn.end)
        if ov > best_overlap:
            best_overlap = ov
            best_speaker = turn.speaker

    return best_speaker if best_overlap > 0 else None


def align(
    transcript: TranscriptResult,
    diarization: DiarizationResult,
    speaker_to_person: dict[str, int],
) -> list[AlignedSegment]:
    """Produce a list of AlignedSegments by merging transcript + diarization.

    Args:
        transcript: Parakeet output (sentences with timestamps).
        diarization: Diarization output (speaker turns).
        speaker_to_person: Mapping from speaker label → person_id.

    Returns:
        List of AlignedSegment, one per transcript sentence.
    """
    segments: list[AlignedSegment] = []

    for sent in transcript.sentences:
        speaker_label = assign_speaker(sent, diarization.turns)
        person_id = speaker_to_person.get(speaker_label) if speaker_label else None

        segments.append(
            AlignedSegment(
                text=sent.text.strip(),
                start_time=sent.start,
                end_time=sent.end,
                speaker_label=speaker_label,
                person_id=person_id,
                confidence=None,
            )
        )

    return segments


# ---------------------------------------------------------------------------
# Pipeline stage runner
# ---------------------------------------------------------------------------

def run_align(
    conn: sqlite3.Connection,
    meeting_id: int,
    transcript: TranscriptResult,
    diarization: DiarizationResult,
    speaker_to_person: dict[str, int],
) -> list[int]:
    """Insert aligned segments into the database. Returns list of segment IDs."""
    from .db import insert_segment, update_meeting_status

    aligned = align(transcript, diarization, speaker_to_person)

    segment_ids: list[int] = []
    for seg in aligned:
        if not seg.text:
            continue
        sid = insert_segment(
            conn,
            meeting_id=meeting_id,
            text=seg.text,
            start_time=seg.start_time,
            end_time=seg.end_time,
            person_id=seg.person_id,
            speaker_label=seg.speaker_label,
            confidence=seg.confidence,
        )
        segment_ids.append(sid)

    update_meeting_status(conn, meeting_id, "diarized")
    return segment_ids
