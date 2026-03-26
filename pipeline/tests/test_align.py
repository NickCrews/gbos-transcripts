"""Tests for align.py: timestamp merging logic (pure logic, no live models)."""

from __future__ import annotations

import pytest

from gbos_pipeline.align import AlignedSegment, _overlap, align, assign_speaker
from gbos_pipeline.diarize_audio import DiarizationResult, SpeakerTurn
from gbos_pipeline.transcribe import TranscriptResult, TranscriptSentence, TranscriptWord


def make_sentence(text: str, start: float, end: float) -> TranscriptSentence:
    return TranscriptSentence(text=text, start=start, end=end, words=[])


def make_turn(speaker: str, start: float, end: float) -> SpeakerTurn:
    return SpeakerTurn(speaker=speaker, start=start, end=end)


class TestOverlap:
    def test_full_overlap(self):
        assert _overlap(0, 10, 0, 10) == 10.0

    def test_partial_overlap(self):
        assert _overlap(0, 5, 3, 8) == 2.0

    def test_no_overlap(self):
        assert _overlap(0, 3, 5, 8) == 0.0

    def test_adjacent(self):
        assert _overlap(0, 5, 5, 10) == 0.0

    def test_contained(self):
        assert _overlap(2, 4, 0, 10) == 2.0


class TestAssignSpeaker:
    def test_single_speaker_full_overlap(self):
        sent = make_sentence("Hello", 1.0, 3.0)
        turns = [make_turn("SPEAKER_00", 0.0, 5.0)]
        assert assign_speaker(sent, turns) == "SPEAKER_00"

    def test_best_overlap_wins(self):
        sent = make_sentence("Hello", 3.0, 5.0)
        turns = [
            make_turn("SPEAKER_00", 0.0, 4.0),   # overlap = 1s
            make_turn("SPEAKER_01", 4.0, 10.0),  # overlap = 1s
        ]
        # Both overlap by 1s; first one wins (tie goes to first in list)
        result = assign_speaker(sent, turns)
        assert result in ("SPEAKER_00", "SPEAKER_01")

    def test_no_overlap_returns_none(self):
        sent = make_sentence("Hello", 10.0, 12.0)
        turns = [make_turn("SPEAKER_00", 0.0, 5.0)]
        assert assign_speaker(sent, turns) is None

    def test_majority_speaker(self):
        sent = make_sentence("Hello world", 2.0, 8.0)
        turns = [
            make_turn("SPEAKER_00", 0.0, 3.0),   # overlap 1s (2-3)
            make_turn("SPEAKER_01", 3.0, 10.0),  # overlap 5s (3-8)
        ]
        assert assign_speaker(sent, turns) == "SPEAKER_01"


class TestAlign:
    def test_simple_single_speaker(self):
        transcript = TranscriptResult(
            sentences=[
                make_sentence("The meeting will come to order.", 1.0, 3.2),
                make_sentence("Please call roll.", 3.5, 5.0),
            ]
        )
        diarization = DiarizationResult(
            turns=[make_turn("SPEAKER_00", 0.0, 6.0)],
            embeddings={"SPEAKER_00": [0.1] * 256},
        )
        speaker_to_person = {"SPEAKER_00": 1}

        segments = align(transcript, diarization, speaker_to_person)
        assert len(segments) == 2
        assert all(s.speaker_label == "SPEAKER_00" for s in segments)
        assert all(s.person_id == 1 for s in segments)

    def test_multi_speaker(self, sample_transcript, sample_diarization):
        speaker_to_person = {"SPEAKER_00": 1, "SPEAKER_01": 2}
        segments = align(sample_transcript, sample_diarization, speaker_to_person)

        assert len(segments) == 5
        # First two sentences (0-5.2s) → SPEAKER_00
        assert segments[0].speaker_label == "SPEAKER_00"
        assert segments[1].speaker_label == "SPEAKER_00"
        # Third sentence (6-8.5s) → SPEAKER_01
        assert segments[2].speaker_label == "SPEAKER_01"

    def test_unknown_speaker_gets_none_person(self):
        transcript = TranscriptResult(
            sentences=[make_sentence("Test", 0.5, 1.5)]
        )
        diarization = DiarizationResult(
            turns=[make_turn("SPEAKER_99", 0.0, 2.0)],
            embeddings={"SPEAKER_99": [0.1] * 256},
        )
        # SPEAKER_99 not in mapping
        segments = align(transcript, diarization, {})
        assert segments[0].person_id is None
        assert segments[0].speaker_label == "SPEAKER_99"

    def test_gap_between_turns(self):
        """Sentence that falls in a gap between turns gets no speaker."""
        transcript = TranscriptResult(
            sentences=[make_sentence("In the gap", 6.0, 7.0)]
        )
        diarization = DiarizationResult(
            turns=[
                make_turn("SPEAKER_00", 0.0, 5.0),
                make_turn("SPEAKER_01", 8.0, 10.0),
            ],
            embeddings={},
        )
        segments = align(transcript, diarization, {})
        assert segments[0].speaker_label is None
        assert segments[0].person_id is None

    def test_timestamps_preserved(self):
        transcript = TranscriptResult(
            sentences=[make_sentence("Hello.", 2.5, 4.0)]
        )
        diarization = DiarizationResult(turns=[], embeddings={})
        segments = align(transcript, diarization, {})
        assert segments[0].start_time == 2.5
        assert segments[0].end_time == 4.0
