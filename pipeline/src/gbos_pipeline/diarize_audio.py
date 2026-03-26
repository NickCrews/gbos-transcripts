"""Diarization via the `diarize` library.

Pipeline stage 3a: WAV → speaker turns + per-speaker 256-dim voice embeddings.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .config import TRANSCRIPTS_DIR
from .db import get_meeting_by_id


@dataclass
class SpeakerTurn:
    speaker: str       # e.g. "SPEAKER_00"
    start: float       # seconds from start
    end: float         # seconds from start


@dataclass
class DiarizationResult:
    turns: list[SpeakerTurn]
    # speaker_label → 256-dim embedding (mean over their segments)
    embeddings: dict[str, list[float]]


# ---------------------------------------------------------------------------
# diarize integration
# ---------------------------------------------------------------------------

def diarize_audio(audio_path: Path) -> DiarizationResult:
    """Run speaker diarization on an audio file.

    Uses the `diarize` library (Apache 2.0, WeSpeaker ResNet34-LM embeddings).
    Returns speaker turns and per-speaker voice embeddings.
    """
    from diarize import diarize  # type: ignore[import]

    result = diarize(str(audio_path))

    turns: list[SpeakerTurn] = []
    for seg in result.segments:
        turns.append(SpeakerTurn(speaker=seg.speaker, start=seg.start, end=seg.end))

    # Aggregate per-speaker embeddings (mean pooling)
    speaker_embeddings: dict[str, list[list[float]]] = {}
    for seg in result.segments:
        emb = getattr(seg, "embedding", None)
        if emb is not None:
            emb_list = emb.tolist() if hasattr(emb, "tolist") else list(emb)
            speaker_embeddings.setdefault(seg.speaker, []).append(emb_list)

    avg_embeddings: dict[str, list[float]] = {}
    for speaker, embs in speaker_embeddings.items():
        n = len(embs)
        dim = len(embs[0])
        avg = [sum(embs[i][d] for i in range(n)) / n for d in range(dim)]
        avg_embeddings[speaker] = avg

    return DiarizationResult(turns=turns, embeddings=avg_embeddings)


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def diarization_to_dict(result: DiarizationResult) -> dict[str, Any]:
    return {
        "turns": [asdict(t) for t in result.turns],
        "embeddings": result.embeddings,
    }


def diarization_from_dict(data: dict[str, Any]) -> DiarizationResult:
    turns = [SpeakerTurn(**t) for t in data.get("turns", [])]
    embeddings = data.get("embeddings", {})
    return DiarizationResult(turns=turns, embeddings=embeddings)


def save_diarization(result: DiarizationResult, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(diarization_to_dict(result), f, indent=2)


def load_diarization(path: Path) -> DiarizationResult:
    with open(path) as f:
        data = json.load(f)
    return diarization_from_dict(data)


# ---------------------------------------------------------------------------
# Pipeline stage runner
# ---------------------------------------------------------------------------

def run_diarize(conn: sqlite3.Connection, meeting_id: int) -> DiarizationResult:
    """Diarize audio for a meeting (idempotent: loads JSON cache if present)."""
    meeting = get_meeting_by_id(conn, meeting_id)
    if meeting is None:
        raise ValueError(f"Meeting {meeting_id} not found")

    cache_path = TRANSCRIPTS_DIR / f"{meeting['youtube_id']}_diarization.json"

    if cache_path.exists():
        return load_diarization(cache_path)

    if not meeting["audio_path"]:
        raise ValueError(f"Meeting {meeting_id} has no audio_path")

    repo_root = Path(__file__).parent.parent.parent.parent
    audio_path = repo_root / meeting["audio_path"]

    result = diarize_audio(audio_path)
    save_diarization(result, cache_path)
    return result
