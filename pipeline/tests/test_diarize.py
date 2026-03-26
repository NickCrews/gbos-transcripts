"""Tests for diarize_audio.py: fixture-based parsing (no live model)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gbos_pipeline.diarize_audio import (
    DiarizationResult,
    SpeakerTurn,
    diarization_from_dict,
    diarization_to_dict,
    load_diarization,
    save_diarization,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestDiarizationSerialisation:
    def test_round_trip_from_fixture(self):
        with open(FIXTURES_DIR / "sample_diarization.json") as f:
            raw = json.load(f)
        result = diarization_from_dict(raw)
        assert len(result.turns) == 4
        assert result.turns[0].speaker == "SPEAKER_00"
        assert result.turns[0].start == 0.0
        assert result.turns[0].end == 5.2
        assert "SPEAKER_00" in result.embeddings
        assert "SPEAKER_01" in result.embeddings
        assert len(result.embeddings["SPEAKER_00"]) == 256
        assert len(result.embeddings["SPEAKER_01"]) == 256

    def test_to_dict_and_back(self):
        turns = [SpeakerTurn(speaker="SPEAKER_00", start=0.0, end=2.0)]
        embs = {"SPEAKER_00": [0.1] * 256}
        result = DiarizationResult(turns=turns, embeddings=embs)

        d = diarization_to_dict(result)
        restored = diarization_from_dict(d)

        assert restored.turns[0].speaker == "SPEAKER_00"
        assert restored.embeddings["SPEAKER_00"] == [0.1] * 256

    def test_save_and_load(self, tmp_path):
        with open(FIXTURES_DIR / "sample_diarization.json") as f:
            raw = json.load(f)
        result = diarization_from_dict(raw)

        out = tmp_path / "test_diarization.json"
        save_diarization(result, out)
        loaded = load_diarization(out)

        assert len(loaded.turns) == len(result.turns)
        assert set(loaded.embeddings.keys()) == set(result.embeddings.keys())


class TestDiarizationContent:
    def test_fixture_turn_count(self, sample_diarization):
        assert len(sample_diarization.turns) == 4

    def test_fixture_speaker_count(self, sample_diarization):
        speakers = {t.speaker for t in sample_diarization.turns}
        assert len(speakers) == 2

    def test_fixture_embeddings_dim(self, sample_diarization):
        for speaker, emb in sample_diarization.embeddings.items():
            assert len(emb) == 256, f"{speaker} embedding has wrong dim"

    def test_fixture_turns_ordered(self, sample_diarization):
        starts = [t.start for t in sample_diarization.turns]
        assert starts == sorted(starts)
