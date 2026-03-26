"""Tests for transcribe.py: fixture-based parsing (no live model)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from gbos_pipeline.transcribe import (
    TranscriptResult,
    TranscriptSentence,
    TranscriptWord,
    load_transcript,
    save_transcript,
    transcript_from_dict,
    transcript_to_dict,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestTranscriptSerialisation:
    def test_round_trip_from_fixture(self):
        with open(FIXTURES_DIR / "sample_transcript.json") as f:
            raw = json.load(f)
        result = transcript_from_dict(raw)
        assert len(result.sentences) == 5
        assert result.sentences[0].text == "The meeting will come to order."
        assert result.sentences[0].start == 1.0
        assert result.sentences[0].end == 3.2
        assert len(result.sentences[0].words) == 6

    def test_to_dict_and_back(self):
        words = [TranscriptWord(text="Hello", start=0.0, end=0.5)]
        sent = TranscriptSentence(text="Hello world.", start=0.0, end=1.0, words=words)
        result = TranscriptResult(sentences=[sent])

        d = transcript_to_dict(result)
        restored = transcript_from_dict(d)

        assert restored.sentences[0].text == "Hello world."
        assert restored.sentences[0].words[0].text == "Hello"

    def test_save_and_load(self, tmp_path):
        with open(FIXTURES_DIR / "sample_transcript.json") as f:
            raw = json.load(f)
        result = transcript_from_dict(raw)

        out = tmp_path / "test_transcript.json"
        save_transcript(result, out)
        loaded = load_transcript(out)

        assert len(loaded.sentences) == len(result.sentences)
        for s1, s2 in zip(result.sentences, loaded.sentences):
            assert s1.text == s2.text
            assert s1.start == s2.start
            assert s1.end == s2.end


class TestTranscriptContent:
    def test_fixture_sentence_count(self, sample_transcript):
        assert len(sample_transcript.sentences) == 5

    def test_fixture_first_sentence(self, sample_transcript):
        s = sample_transcript.sentences[0]
        assert "come to order" in s.text
        assert s.start < s.end

    def test_fixture_all_sentences_have_timestamps(self, sample_transcript):
        for s in sample_transcript.sentences:
            assert s.start >= 0
            assert s.end > s.start
